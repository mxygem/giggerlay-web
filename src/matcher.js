// Match a package label (OCR lines) against the route's stops. Pure logic.
import { parseStreetDetail, isRejectedLine } from './street.js';

export const ACCEPT = 0.7;
export const AMBIGUOUS_GAP = 0.15;

// A unit alone on its line: "3056", "12B", "#12". Not "VAZ1"/"B10", not a zip.
const LONE_UNIT = /^#?\s*(\d{1,4}[A-Z]?)$/;
// A line that starts with a unit marker: "APT 12", "AP 12", "# 12", "APT12".
const MARKER_UNIT = /^(?:APT|AP|APARTMENT|UNIT|STE|SUITE|#)\s*#?\s*([0-9][0-9A-Z-]{0,6}|[A-Z])$/;

/**
 * Street candidates on a label. A street ending in a bare unit marker takes
 * the first lone unit line within the next 3 lines; a next line that starts
 * with a unit marker also gives the unit.
 * @param {import('./contracts.js').OCRLine[]} lines
 * @returns {import('./contracts.js').StreetAddress[]}
 */
export function labelAddresses(lines) {
  const texts = [...(lines ?? [])]
    .sort((a, b) => a.midY - b.midY)
    .map((l) => String(l.text ?? '').trim());
  const upper = texts.map((t) => t.toUpperCase());
  const out = [];
  texts.forEach((text, i) => {
    const d = parseStreetDetail(text); // raw case: lowercase l is OCR of 1
    if (!d) return;
    const addr = { ...d.address };
    if (!addr.unit) {
      const m = upper[i + 1]?.match(MARKER_UNIT);
      if (m) addr.unit = m[1];
      else if (d.bareUnit) {
        for (const t of upper.slice(i + 1, i + 4)) {
          const u = !isRejectedLine(t) && t.match(LONE_UNIT);
          if (u) { addr.unit = u[1]; break; }
        }
      }
    }
    out.push(addr);
  });
  return out;
}

/** Levenshtein distance. */
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Name similarity 0-1; token prefix ("GROSSE" vs "GROSSE POINTE") >= 0.85. */
export function nameSimilarity(a, b) {
  a = a.toUpperCase().trim().replace(/\s+/g, ' ');
  b = b.toUpperCase().trim().replace(/\s+/g, ' ');
  if (!a || !b) return 0;
  let sim = 1 - editDistance(a, b) / Math.max(a.length, b.length);
  const [ta, tb] = [a.split(' '), b.split(' ')];
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.every((t, k) => t === long[k])) sim = Math.max(sim, 0.85);
  return sim;
}

const digits = (n) => String(n ?? '').toUpperCase().replace(/O/g, '0').replace(/[IL|]/g, '1');

/**
 * How well a label address matches a stop's address (0 when the house number
 * differs). Can exceed 1 (unit match bonus).
 */
export function scoreAddress(found, stopAddr) {
  if (!found || !stopAddr || digits(found.number) !== digits(stopAddr.number)) return 0;
  const sim = nameSimilarity(found.name ?? '', stopAddr.name ?? '');
  if (sim < 0.6) return 0;
  let score = sim;
  if (found.direction && stopAddr.direction && found.direction !== stopAddr.direction) score -= 0.5;
  if (found.type && stopAddr.type && found.type !== stopAddr.type) score -= 0.25;
  if (found.unit && stopAddr.unit) score += found.unit === stopAddr.unit ? 0.1 : -0.3;
  return Math.max(0, score);
}

/**
 * How well a label whose house number lost its first digits fits a stop. The
 * label's number (2+ digits) must be the end of the stop's.
 */
export function cutOffScore(found, stopAddr) {
  const a = digits(found?.number), b = digits(stopAddr?.number);
  if (a.length < 2 || b.length <= a.length || !b.endsWith(a)) return 0;
  return scoreAddress({ ...found, number: b }, stopAddr);
}

/**
 * Match a label to a stop. Ambiguous when another stop (different number)
 * scores within AMBIGUOUS_GAP of the best accepted score.
 * @returns {import('./contracts.js').MatchResult}
 */
export function matchLabel(lines, stops) {
  const cands = labelAddresses(lines);
  if (!cands.length) return { kind: 'noAddress' };
  // Best score per stop number, remembering which candidate gave it.
  const perStop = new Map();
  for (const stop of stops ?? []) {
    for (const c of cands) {
      const s = scoreAddress(c, stop.address);
      const cur = perStop.get(stop.number);
      if (s > 0 && (!cur || s > cur.score)) perStop.set(stop.number, { stop, score: s, address: c });
    }
  }
  const ranked = [...perStop.values()].sort((a, b) => b.score - a.score || a.stop.number - b.stop.number);
  const best = ranked[0];
  if (!best || best.score < ACCEPT) {
    // A label photographed with its left edge cut off loses the start of the
    // house number ("828 E GABLE AVE" for 3828).
    const cut = [];
    for (const stop of stops ?? []) {
      const c = cands.find((a) => cutOffScore(a, stop.address) >= ACCEPT);
      if (c) cut.push({ stop, address: c });
    }
    if (cut.length === 1) return { kind: 'partial', stop: cut[0].stop, address: cut[0].address };
    if (cut.length > 1) {
      const s = cut.map((c) => c.stop).sort((a, b) => a.number - b.number);
      return { kind: 'ambiguous', stops: s, score: 0, address: cut[0].address };
    }
    return { kind: 'notOnRoute', address: best?.address ?? cands[0] };
  }
  const close = ranked.filter((r) => r.score >= best.score - AMBIGUOUS_GAP - 1e-9);
  if (close.length > 1) {
    return { kind: 'ambiguous', stops: close.map((r) => r.stop), score: best.score, address: best.address };
  }
  return { kind: 'stop', stop: best.stop, score: best.score, address: best.address };
}

/** Tracking id from a barcode payload: TBA + 9-15 digits, else null. */
export function trackingFromBarcode(text) {
  const m = String(text ?? '').toUpperCase().match(/(?:^|[^A-Z0-9])(TBA\d{9,15})(?![0-9])/);
  return m ? m[1] : null;
}
