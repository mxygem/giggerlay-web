// Flex Itinerary > List parsing: one page at a time, then merged across pages.
import { parseStreet, formatStreet } from './street.js';
import { scoreAddress } from './matcher.js';

const SAME = 0.85; // scoreAddress at or above this = same street
const PIN_DX = 0.03; // pin at least this far left of the street
const PIN_DY = 0.03; // pin within this vertical distance of the street
const ROW_TOL = 0.2; // fill tolerance, in rows
const LOOKAHEAD = 3; // lines under a stop that belong to it
const SAME_ROW = 0.015; // a marker this close vertically is on the stop's row

const PIN_RE = /^\W*(\d{1,3})\W*$/;
const MERGED_RE = /^\W*(\d{1,3})\W*\s+(\d+\s+\S.*)$/;
const PICKUP_RE = /\bPICK\s?UP\b|^\W*RETURN/i;
const DELIVER_RE = /\bDELIVER\s+(\d+)\s+PACKAGES?\b/i;
const WORD_RE = /^(?:[A-Z][A-Z'-]*|\d+(?:ST|ND|RD|TH))$/;

const pinOf = (text) => {
  const m = PIN_RE.exec(text.trim());
  const n = m && Number(m[1]);
  return n >= 1 ? n : null;
};

// A street usable as a stop: has a type, plain-word/ordinal name, no SCHEDULED.
function stopStreet(text) {
  if (/SCHEDULED/i.test(text)) return null;
  const a = parseStreet(text);
  if (!a || !a.type || !a.name) return null;
  return a.name.split(' ').every((t) => WORD_RE.test(t)) ? a : null;
}

// Street line, possibly with its pin merged in front ("9 1007 ANITA AVE").
function readStreetLine(text) {
  const m = MERGED_RE.exec(text.trim());
  if (m && Number(m[1]) >= 1) {
    const a = stopStreet(m[2]);
    if (a) return { address: a, pin: Number(m[1]) };
  }
  const a = stopStreet(text);
  return a ? { address: a, pin: null } : null;
}

const streetKey = (a) => `${a.number} ${a.name}`;

/**
 * Parse one page (screenshot, slice or video frame).
 * @param {import('./contracts.js').OCRLine[]} lines
 * @returns {import('./contracts.js').PageReading}
 */
export function parsePage(lines) {
  lines = [...lines].sort((a, b) => a.midY - b.midY);
  const reading = { stops: [], pickups: [] };
  const header = lines.find((l) => /SCHEDULED/i.test(l.text));
  if (header) reading.header = header.text.trim();

  // Classify lines.
  const rows = lines.map((l) => ({ l, pin: pinOf(l.text), street: readStreetLine(l.text) }));
  const pins = rows.filter((r) => r.pin);
  const used = new Set();
  const cands = []; // {row, idx, address, number, pickup, packages}
  rows.forEach((r, idx) => {
    if (!r.street) return;
    let number = r.street.pin;
    if (number == null) {
      // Closest unused pin line to the left on the same row.
      let best = null;
      for (const p of pins) {
        if (used.has(p) || p.l.minX > r.l.minX - PIN_DX) continue;
        const dy = Math.abs(p.l.midY - r.l.midY);
        if (dy <= PIN_DY && (!best || dy < best.dy)) best = { p, dy };
      }
      if (best) { used.add(best.p); number = best.p.pin; }
    }
    cands.push({ row: r, idx, address: r.street.address, number });
  });

  // Rows that belong to each stop: same row + next few lines before the next stop.
  const claimed = new Set();
  cands.forEach((c, ci) => {
    const nextIdx = ci + 1 < cands.length ? cands[ci + 1].idx : rows.length;
    const block = rows.filter((r, i) => i !== c.idx && Math.abs(r.l.midY - c.row.l.midY) <= SAME_ROW && !r.pin);
    for (let i = c.idx + 1, n = 0; i < nextIdx && n < LOOKAHEAD; i++) {
      if (rows[i].pin) continue;
      if (!block.includes(rows[i])) block.push(rows[i]);
      n++;
    }
    for (const r of block) {
      claimed.add(r);
      if (PICKUP_RE.test(r.l.text)) c.pickup = true;
      const d = DELIVER_RE.exec(r.l.text);
      if (d && c.packages == null) c.packages = Number(d[1]);
    }
    if (PICKUP_RE.test(c.row.l.text)) c.pickup = true;
  });

  // Pickup markers without a street (e.g. the station row): take a pin above.
  for (const r of rows) {
    if (claimed.has(r) || r.street || !PICKUP_RE.test(r.l.text)) continue;
    let best = null;
    for (const p of pins) {
      if (used.has(p)) continue;
      const dy = r.l.midY - p.l.midY;
      if (dy >= -PIN_DY && dy <= 0.1 && (!best || Math.abs(dy) < Math.abs(best.dy))) best = { p, dy };
    }
    if (best) { used.add(best.p); reading.pickups.push({ number: best.p.pin }); }
  }

  for (const c of cands) {
    if (c.pickup) {
      const p = { address: c.address };
      if (c.number != null) p.number = c.number;
      reading.pickups.push(p);
      continue;
    }
    const s = { number: c.number, address: c.address, midY: c.row.l.midY };
    if (c.packages != null) s.packages = c.packages;
    reading.stops.push(s);
  }
  dropOutlierPins(reading.stops);
  fillPins(reading.stops, reading.pickups);
  return reading;
}

// Clear read pins that disagree with the row spacing of the other pins on the
// page (OCR misreads like "79" for 9 or "720" for 20). Needs 3+ read pins.
function dropOutlierPins(stops) {
  const read = stops.filter((s) => s.number != null);
  if (read.length < 3) return;
  const ratios = [];
  for (let i = 0; i < read.length; i++) for (let j = i + 1; j < read.length; j++) {
    const dn = read[j].number - read[i].number;
    if (dn !== 0) ratios.push((read[j].midY - read[i].midY) / dn);
  }
  const pos = ratios.filter((r) => r > 0).sort((a, b) => a - b);
  if (!pos.length) return;
  const pitch = pos[Math.floor(pos.length / 2)];
  const bad = read.filter((a) => {
    const agree = read.filter((b) => b !== a &&
      Math.abs(a.number - b.number - (a.midY - b.midY) / pitch) <= 0.3).length;
    return agree < Math.ceil((read.length - 1) / 2);
  });
  for (const s of bad) { s.number = null; s.pinRejected = true; }
}

// Fill missing pins from the row pitch between read pins on this page.
function fillPins(stops, pickups) {
  const rejected = stops.filter((s) => s.pinRejected);
  for (const s of rejected) delete s.pinRejected;
  const read = stops.filter((s) => s.number != null);
  const ratios = [];
  for (let i = 1; i < read.length; i++) {
    const dn = read[i].number - read[i - 1].number;
    if (dn > 0) ratios.push((read[i].midY - read[i - 1].midY) / dn);
  }
  if (!ratios.length) return;
  ratios.sort((a, b) => a - b);
  const pitch = ratios[Math.floor(ratios.length / 2)];
  if (!(pitch > 0)) return;
  const taken = new Set([...read.map((s) => s.number), ...pickups.map((p) => p.number)]);
  const rowsAway = (d) => {
    const k = Math.round(d / pitch);
    return k >= 1 && Math.abs(d / pitch - k) <= ROW_TOL ? k : null;
  };
  for (const s of stops) {
    if (s.number != null) continue;
    const above = read.filter((r) => r.midY < s.midY).pop();
    const below = read.find((r) => r.midY > s.midY);
    const ka = above && rowsAway(s.midY - above.midY);
    const kb = below && rowsAway(below.midY - s.midY);
    const fa = ka ? above.number + ka : null;
    const fb = kb ? below.number - kb : null;
    let n = null;
    if (above && below) n = fa != null && fa === fb ? fa : null;
    // A rejected pin on the open side means that side isn't known to be empty.
    else if (above) n = ka === 1 && !rejected.some((o) => o.midY > s.midY) ? fa : null;
    else if (below) n = kb === 1 && !rejected.some((o) => o.midY < s.midY) ? fb : null;
    if (n != null && n >= 1 && !taken.has(n)) {
      s.number = n;
      s.pinFilled = true;
      taken.add(n);
    }
  }
}

// Most common value; ties go to the earliest seen.
function vote(values) {
  const counts = new Map();
  values.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
  let best;
  for (const v of values) if (best === undefined || counts.get(v) > counts.get(best)) best = v;
  return best;
}

// Pick the street for one stop number from its readings (in order seen).
function voteStreet(addrs) {
  const clusters = [];
  for (const a of addrs) {
    const c = clusters.find((c) => formatStreet(c[0]) === formatStreet(a) || scoreAddress(a, c[0]) >= SAME);
    c ? c.push(a) : clusters.push([a]);
  }
  // Bigger group first, then one with a unit; stable sort keeps earliest on ties.
  const rank = (x, y) => y.length - x.length || y.some((a) => a.unit) - x.some((a) => a.unit);
  const win = [...clusters].sort(rank)[0];
  const exact = [];
  for (const a of win) {
    const g = exact.find((g) => formatStreet(g[0]) === formatStreet(a));
    g ? g.push(a) : exact.push([a]);
  }
  return [...exact].sort(rank)[0][0];
}

/**
 * Merge page readings into one stop list.
 * @param {import('./contracts.js').PageReading[]} pages
 * @returns {{stops: import('./contracts.js').RouteStop[], header?: string}}
 */
export function mergePages(pages) {
  const pickNums = new Set();
  const pickStreets = new Set();
  for (const p of pages) for (const k of p.pickups || []) {
    if (k.number != null) pickNums.add(k.number);
    if (k.address) pickStreets.add(streetKey(k.address));
  }
  const isPickup = (s) => (s.number != null && pickNums.has(s.number)) || pickStreets.has(streetKey(s.address));

  // Numbered readings, voted per number.
  const byNum = new Map();
  for (const p of pages) for (const s of p.stops) {
    if (s.number == null || isPickup(s)) continue;
    if (!byNum.has(s.number)) byNum.set(s.number, []);
    byNum.get(s.number).push(s);
  }
  const known = new Map();
  for (const [n, rs] of byNum) {
    const stop = { number: n, address: voteStreet(rs.map((r) => r.address)), guessed: false };
    const pk = vote(rs.map((r) => r.packages).filter((v) => v !== undefined));
    if (pk !== undefined) stop.packages = pk;
    known.set(n, stop);
  }
  // A number read only once whose street won under a better-supported number
  // is a misread pin, not a second stop at that address.
  for (const [n, rs] of byNum) {
    if (rs.length !== 1) continue;
    const key = formatStreet(known.get(n).address);
    if ([...byNum].some(([m, o]) => m !== n && o.length > 1 && formatStreet(known.get(m).address) === key)) known.delete(n);
  }

  // Unnumbered readings: drop if known, else previous stop on the page + 1.
  const findKnown = (a) => [...known.values()].find((k) => scoreAddress(a, k.address) >= SAME);
  for (const p of pages) {
    const nums = p.stops.map((s) => (s.number != null && !isPickup(s) ? s.number : null));
    p.stops.forEach((s, i) => {
      if (s.number != null || isPickup(s)) return;
      const k = findKnown(s.address);
      if (k) { nums[i] = k.number; return; }
      const prev = nums.slice(0, i).reverse().find((n) => n != null);
      const next = prev == null ? nums.slice(i + 1).find((n) => n != null) : null;
      const n = prev != null ? prev + 1 : next != null ? next - 1 : null;
      if (n == null || n < 1 || known.has(n) || pickNums.has(n)) return;
      const stop = { number: n, address: s.address, guessed: true };
      if (s.packages !== undefined) stop.packages = s.packages;
      known.set(n, stop);
      nums[i] = n;
    });
  }

  const out = { stops: [...known.values()].sort((a, b) => a.number - b.number) };
  const header = pages.map((p) => p.header).find(Boolean);
  if (header) out.header = header;
  return out;
}

/**
 * Build a route from typed addresses, one per line, numbered from 1.
 * @param {string} text
 */
export function parseTypedAddresses(text) {
  const stops = [];
  const errors = [];
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const address = parseStreet(line.trim());
    if (address) stops.push({ number: stops.length + 1, address, guessed: false });
    else errors.push(`Line ${i + 1}: can't read an address`);
  });
  return { stops, errors };
}
