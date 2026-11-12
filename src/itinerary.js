// Flex Itinerary > List parsing: one page at a time, then merged across pages.
import { parseStreet, parseTypelessStreet, formatStreet } from './street.js';
import { scoreAddress, nameSimilarity } from './matcher.js';

const SAME = 0.85; // scoreAddress at or above this = same street
const PIN_DX = 0.03; // pin at least this far left of the street
const PIN_DY = 0.03; // pin within this vertical distance of the street
// Real Flex puts the pin on the card's first line ("Expected by"), measured
// 0.056 above the street, 0.08 on the "Next Stop" card. A pin may sit up to
// this far above its street (never across another street line).
const PIN_ABOVE = 0.12;
const ROW_TOL = 0.2; // fill tolerance, in rows
const LOOKAHEAD = 3; // lines under a stop that belong to it
const SAME_ROW = 0.015; // a marker this close vertically is on the stop's row

const PIN_RE = /^\W*(\d{1,3})\W*$/;
const MERGED_RE = /^\W*(\d{1,3})\W*\s+(\d+\s+\S.*)$/;
const PICKUP_RE = /\bPICK\s?UP\b|\bPICKED\s+UP\b|^\W*RETURN/i;
const DELIVER_RE = /\bDELIVER\s+(\d+)\s+PACKAGES?\b/i;
const WORD_RE = /^(?:[A-Z][A-Z'-]*|\d+(?:ST|ND|RD|TH))$/;

// A pin read in front of other text, e.g. "(5) O Expected by 6:00 PM".
const LEAD_PIN_RE = /^\W*\((\d{1,3})\)\s+\D/;

// A pin OCR'd onto the card's first line: "12 Expected by 6:00 AM".
const CARD_PIN_RE = /^\W*\(?(\d{1,3})\)?[.)]?\s+(?=(?:expected|next stop|picked up)\b)/i;

const pinOf = (text) => {
  const m = PIN_RE.exec(text.trim()) || LEAD_PIN_RE.exec(text.trim()) || CARD_PIN_RE.exec(text.trim());
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

// A street with no type ("1721 S. Lemon"): counts only when the card around
// it looks like a stop (checked in parsePage).
const CARD_WORDS = /^(EXPECTED|NEXT|PICK|PICKED|DELIVER|RETURN|SCHEDULED)\b/;
function typelessStreet(text) {
  if (/SCHEDULED/i.test(text)) return null;
  const a = parseTypelessStreet(text);
  return a && !CARD_WORDS.test(a.name) ? a : null;
}

// Street line, possibly with its pin merged in front ("9 1007 ANITA AVE").
function readStreetLine(text) {
  const m = MERGED_RE.exec(text.trim());
  if (m && Number(m[1]) >= 1) {
    const a = stopStreet(m[2]);
    if (a) return { address: a, pin: Number(m[1]) };
    const t = typelessStreet(m[2]);
    if (t) return { address: t, pin: Number(m[1]), typeless: true };
  }
  const a = stopStreet(text);
  if (a) return { address: a, pin: null };
  const t = typelessStreet(text);
  return t ? { address: t, pin: null, typeless: true } : null;
}

// "MESA", "Gilbert", "GROSSE POINTE WOODS".
const isCityLine = (text) => {
  const u = text.trim().toUpperCase();
  return /^[A-Z][A-Z .'-]{2,30}$/.test(u) && !/^(DELIVER|PICK|EXPECTED|NEXT|RETURN)/.test(u);
};
const UNIT_LINE = /^(APT|AP|APARTMENT|UNIT|STE|SUITE|#|BLDG|LOT|SPC|RM)\b/i;

// A typeless street is a stop only with a city line right below (after any
// unit line) and "Deliver N package" just after that.
function typelessCardOk(rows, idx) {
  const below = rows.slice(idx + 1, idx + 5).map((r) => r.l.text.trim());
  let k = 0;
  while (k < below.length && UNIT_LINE.test(below[k])) k++;
  if (!below[k] || !isCityLine(below[k])) return false;
  return below.slice(k + 1, k + 3).some((t) => DELIVER_RE.test(t));
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
  rows.forEach((r, i) => { if (r.street?.typeless && !typelessCardOk(rows, i)) r.street = null; });
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
        const up = r.l.midY - p.l.midY; // > 0 when the pin is above
        if (up > PIN_ABOVE || up < -PIN_DY) continue;
        // Never take a pin from across another street line.
        if (up > PIN_DY && rows.some((o) => o.street && o !== r && o.l.midY > p.l.midY && o.l.midY < r.l.midY)) continue;
        const dy = Math.abs(up);
        if (!best || dy < best.dy) best = { p, dy };
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
    // Real Flex shows "Picked up at 2:21 AM" on the station card's first
    // line, about 0.056 above its street.
    for (const above of rows.slice(Math.max(0, c.idx - 3), c.idx)) {
      if (above.pin || claimed.has(above) || !PICKUP_RE.test(above.l.text) || c.row.l.midY - above.l.midY > 0.065) continue;
      claimed.add(above);
      c.pickup = true;
    }
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
    if (best) { used.add(best.p); reading.pickups.push({ number: best.p.pin, midY: r.l.midY }); }
  }

  for (const c of cands) {
    if (c.pickup) {
      const p = { address: c.address, midY: c.row.l.midY };
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

// Pick the street for one stop from its readings (in order seen).
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

// One stop as seen across pages.
class Cluster {
  constructor(r) { this.readings = [r]; }
  add(r) { this.readings.push(r); this._n = this._b = undefined; }
  // Majority pin; ties go to the lower number.
  get number() {
    if (this._n === undefined) {
      const counts = new Map();
      for (const r of this.readings) if (r.number != null) counts.set(r.number, (counts.get(r.number) || 0) + 1);
      let best = null;
      for (const [n, c] of counts) if (best == null || c > counts.get(best) || (c === counts.get(best) && n < best)) best = n;
      this._n = best;
    }
    return this._n;
  }
  get best() { return this._b ??= voteStreet(this.readings.map((r) => r.address)); }
  get pages() { return new Set(this.readings.map((r) => r.page)); }
  stop(number, guessed) {
    const stop = { number, address: this.best, guessed };
    const pk = vote(this.readings.map((r) => r.packages).filter((v) => v !== undefined));
    if (pk !== undefined) stop.packages = pk;
    return stop;
  }
}

// Clearly the same stop: the same pin, or (when either has none) the same address.
function sameStop(r, c) {
  if (r.number != null && c.number != null) return r.number === c.number;
  return c.readings.some((o) => scoreAddress(o.address, r.address) >= SAME);
}

// Could be a misread of this stop, given it sits in the same place in the list:
// same house number, or a same-length number with <= 2 digits off and a
// similar name. Turns "3552 b Enid Ave" into a vote for 3332 E Enid Ave.
function lookalike(r, c) {
  if (r.number != null && c.number != null && r.number !== c.number) return false;
  const a = r.address, b = c.best;
  if (a.number === b.number) return true;
  if (a.number.length !== b.number.length) return false;
  let off = 0;
  for (let i = 0; i < a.number.length; i++) if (a.number[i] !== b.number[i]) off++;
  return off <= 2 && nameSimilarity(a.name, b.name) >= 0.6;
}

// Add one page's readings to the ordered list of stops. Readings that clearly
// match a known stop anchor the page; the others are placed between anchors,
// joining the stop in their position when they look like it.
function place(page, order) {
  const anchor = page.map(() => null);
  let last = -1;
  page.forEach((r, i) => {
    const matches = [];
    order.forEach((c, k) => { if (sameStop(r, c)) matches.push(k); });
    // Two stops can share an address: take the one after the page's last anchor.
    const k = matches.find((m) => m > last) ?? matches[0];
    if (k === undefined) return;
    anchor[i] = order[k];
    last = Math.max(last, k);
  });
  page.forEach((r, i) => anchor[i]?.add(r));

  for (let i = 0; i < page.length;) {
    if (anchor[i]) { i++; continue; }
    let j = i;
    while (j < page.length && !anchor[j]) j++;
    fill(page.slice(i, j), i > 0 ? anchor[i - 1] : null, j < page.length ? anchor[j] : null, order);
    i = j;
  }
}

function fill(run, a, b, order) {
  if (a) {
    let slot = order.indexOf(a) + 1;
    for (const r of run) {
      const end = b ? order.indexOf(b) : order.length;
      let k;
      if (slot < end && lookalike(r, order[slot])) {
        order[slot++].add(r);
      } else if (b && slot < end && (k = order.slice(slot + 1, end).findIndex((c) => lookalike(r, c))) >= 0) {
        // The rows in between weren't read on this page.
        k += slot + 1;
        order[k].add(r);
        slot = k + 1;
      } else {
        order.splice(slot++, 0, new Cluster(r));
      }
    }
  } else if (b) {
    // Top of the page: work upward from the first anchor.
    let slot = order.indexOf(b) - 1;
    for (const r of [...run].reverse()) {
      if (slot >= 0 && lookalike(r, order[slot])) order[slot--].add(r);
      else order.splice(slot + 1, 0, new Cluster(r));
    }
  } else {
    // Nothing on this page was seen before.
    for (const r of run) order.push(new Cluster(r));
  }
}

// An unpinned stop seen in under half of the 3+ pages that show both its
// neighbors is a misread that found no stop to vote for.
function dropPhantoms(order) {
  const kept = [...order];
  for (let i = 1; i < kept.length - 1;) {
    const c = kept[i];
    const prev = kept[i - 1].pages, next = kept[i + 1].pages;
    const both = [...prev].filter((p) => next.has(p)).length;
    if (c.number == null && both >= 3 && c.pages.size * 2 < both) kept.splice(i, 1);
    else i++;
  }
  return kept;
}

/**
 * Merge page readings into one stop list. Readings are lined up across pages
 * into one ordered list; each stop takes its most common street, pin and
 * package count. Numbers: the pin when read, else previous + 1 (guessed); the
 * station counts as stop 1 even when it wasn't read.
 * @param {import('./contracts.js').PageReading[]} pages
 * @returns {{stops: import('./contracts.js').RouteStop[], header?: string}}
 */
export function mergePages(pages) {
  const pickNums = new Set();
  const pickStreets = [];
  for (const p of pages) for (const k of p.pickups || []) {
    if (k.number != null) pickNums.add(k.number);
    if (k.address) pickStreets.push(k.address);
  }

  let order = [];
  pages.forEach((p, pi) => {
    const readings = [
      ...p.stops.map((s) => ({ number: s.number, address: s.address, packages: s.packages, midY: s.midY, page: pi })),
      ...(p.pickups || []).filter((k) => k.address).map((k) => ({ number: k.number ?? null, address: k.address, midY: k.midY ?? 0, page: pi, pickup: true })),
    ].sort((a, b) => a.midY - b.midY);
    place(readings, order);
  });
  order = dropPhantoms(order);

  const isPickup = (c) => c.readings.some((r) => r.pickup) ||
    (c.number != null && pickNums.has(c.number)) ||
    c.readings.some((r) => pickStreets.some((a) => scoreAddress(a, r.address) >= SAME));

  const result = new Map(); // number -> {stop, cluster}
  let previous = 1; // the station is stop 1
  order.forEach((c, i) => {
    if (isPickup(c)) { previous = c.number ?? Math.max(previous, 1); return; }
    if (c.number != null) {
      if (!result.has(c.number)) result.set(c.number, { stop: c.stop(c.number, false), c });
      previous = c.number;
      return;
    }
    previous++;
    // No room before the next numbered stop: the count is off somewhere, and
    // a wrong number is worse than none (the review shows the gap instead).
    const next = order.slice(i + 1).find((o) => !isPickup(o) && o.number != null)?.number;
    if (next != null && previous >= next) return;
    if (!result.has(previous)) result.set(previous, { stop: c.stop(previous, true), c });
  });

  // A number read once whose street won under a better-read number is a
  // misread pin, not a second stop at that address.
  for (const [n, { stop, c }] of [...result]) {
    if (stop.guessed || c.readings.length !== 1) continue;
    const key = formatStreet(stop.address);
    if ([...result].some(([m, o]) => m !== n && o.c.readings.length > 1 && formatStreet(o.stop.address) === key)) result.delete(n);
  }

  const out = { stops: [...result.values()].map((v) => v.stop).sort((a, b) => a.number - b.number) };
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
