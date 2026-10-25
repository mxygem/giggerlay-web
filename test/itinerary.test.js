import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePage, mergePages, parseTypedAddresses } from '../src/itinerary.js';
import { formatStreet } from '../src/street.js';
import { reviewIssues } from '../src/review.js';

const PITCH = 0.07;
const L = (text, midY, minX = 0.2) => ({ text, midY, minX, height: 0.015 });

// One Flex list row block. pin: number | string | null (unread) | 'merged:N'.
function block(y, { pin, street, city = 'GROSSE POINTE WOODS', pkgs = 1, extra } = {}) {
  const out = [];
  if (typeof pin === 'string' && pin.startsWith('merged:')) out.push(L(`${pin.slice(7)} ${street}`, y, 0.05));
  else {
    if (pin != null) out.push(L(String(pin), y + 0.002, 0.05));
    out.push(L(street, y));
  }
  out.push(L(city, y + 0.02));
  if (extra) out.push(L(extra, y + 0.04));
  else out.push(L(`Deliver ${pkgs} package${pkgs === 1 ? '' : 's'}`, y + 0.04));
  return out;
}
// Page from rows [{pin, street, ...}] starting at y0.
function page(rows, { y0 = 0.15, header = true } = {}) {
  const lines = header ? [L('# H-24.1B • Scheduled 3:00 - 8:00 AM', 0.05, 0.05)] : [];
  rows.forEach((r, i) => lines.push(...block(y0 + i * PITCH, r)));
  return lines.sort((a, b) => a.midY - b.midY);
}
const fmt = (s) => formatStreet(s.address);
const nums = (r) => r.stops.map((s) => s.number);

const PICKUP = { pin: 1, street: '14000 MERRIMAN RD', city: 'LIVONIA', extra: 'Pick up' };

test('header + pickup stop 1 + several stops', () => {
  const r = parsePage(page([
    PICKUP,
    { pin: 2, street: '1001 ANITA AVE' },
    { pin: 3, street: '1003 ANITA AVE' },
    { pin: 4, street: '20 MORNINGSIDE DR', pkgs: 2 },
  ]));
  assert.equal(r.header, '# H-24.1B • Scheduled 3:00 - 8:00 AM');
  assert.deepEqual(nums(r), [2, 3, 4]);
  assert.equal(fmt(r.stops[0]), '1001 ANITA AVE');
  assert.equal(r.stops[2].packages, 2);
  assert.equal(r.stops[0].packages, 1);
  assert.equal(r.pickups.length, 1);
  assert.equal(r.pickups[0].number, 1);
  assert.equal(r.pickups[0].address.number, '14000');
});

test('header is never a stop', () => {
  const r = parsePage([L('# H-24.1B • Scheduled 3:00 - 8:00 AM', 0.05, 0.05), L('12 Scheduled 3:00 ST', 0.1)]);
  assert.equal(r.stops.length, 0);
});

test('merged pin + street "9 1007 ANITA AVE"', () => {
  const r = parsePage(page([{ pin: 'merged:9', street: '1007 ANITA AVE' }, { pin: 'merged:10', street: '1011 ANITA AVE' }]));
  assert.deepEqual(nums(r), [9, 10]);
  assert.equal(fmt(r.stops[0]), '1007 ANITA AVE');
});

test('separate pin lines and "12)" pin', () => {
  const r = parsePage(page([{ pin: '11', street: '5 KERBY RD' }, { pin: '12)', street: '7 KERBY RD' }, { pin: '.13', street: '9 KERBY RD' }]));
  assert.deepEqual(nums(r), [11, 12, 13]);
  assert.equal(fmt(r.stops[1]), '7 KERBY RD');
});

test('pin must be left of street and on the same row', () => {
  // Pin too far down (0.05) and a 0 pin are ignored.
  const r = parsePage([L('7', 0.25, 0.05), L('100 MAIN ST', 0.2), L('0', 0.4, 0.05), L('102 MAIN ST', 0.4)]);
  assert.deepEqual(nums(r), [null, null]);
});

test('missing pin filled from both sides', () => {
  const r = parsePage(page([
    { pin: 8, street: '100 OAK ST' },
    { pin: null, street: '102 OAK ST' },
    { pin: null, street: '104 OAK ST' },
    { pin: 11, street: '106 OAK ST' },
  ]));
  assert.deepEqual(nums(r), [8, 9, 10, 11]);
  assert.equal(r.stops[1].pinFilled, true);
  assert.equal(r.stops[0].pinFilled, undefined);
});

test('filled pin keeps its own address, not a neighbor\'s', () => {
  const r = parsePage(page([
    { pin: 9, street: '1007 ANITA AVE' },
    { pin: null, street: '1015 ANITA AVE' },
    { pin: 11, street: '1023 ANITA AVE' },
  ]));
  const by = Object.fromEntries(r.stops.map((s) => [s.number, fmt(s)]));
  assert.deepEqual(by, { 9: '1007 ANITA AVE', 10: '1015 ANITA AVE', 11: '1023 ANITA AVE' });
  // Merged with a page that read 10 directly, 10 still has its own street.
  const m = mergePages([r, parsePage(page([{ pin: 10, street: '1015 ANITA AVE' }, { pin: 11, street: '1023 ANITA AVE' }]))]);
  assert.equal(fmt(m.stops.find((s) => s.number === 10)), '1015 ANITA AVE');
  assert.equal(fmt(m.stops.find((s) => s.number === 9)), '1007 ANITA AVE');
});

test('one side only fills a single row', () => {
  const r = parsePage(page([
    { pin: 3, street: '1 ELM ST' },
    { pin: 4, street: '3 ELM ST' },
    { pin: null, street: '5 ELM ST' },
    { pin: null, street: '7 ELM ST' },
  ]));
  assert.deepEqual(nums(r), [3, 4, 5, null]);
});

test('missing pin NOT filled when sides disagree', () => {
  // Pitch is one row per number: above says 8, below says 10 - 1 = 9.
  const r = parsePage(page([
    { pin: 5, street: '1 ELM ST' },
    { pin: 6, street: '3 ELM ST' },
    { pin: 7, street: '5 ELM ST' },
    { pin: null, street: '7 ELM ST' },
    { pin: 10, street: '9 ELM ST' },
  ]));
  assert.equal(r.stops[3].number, null);
});

test('missing pin NOT filled when gap is not a whole number of rows', () => {
  const lines = [
    ...block(0.1, { pin: 5, street: '1 ELM ST' }),
    ...block(0.17, { pin: 6, street: '3 ELM ST' }),
    ...block(0.275, { pin: null, street: '5 ELM ST' }), // 1.5 rows below 6
  ].sort((a, b) => a.midY - b.midY);
  assert.equal(parsePage(lines).stops[2].number, null);
});

test('stop 14 "Deliver 3 packages"', () => {
  const r = parsePage(page([{ pin: 13, street: '10 LAKE SHORE RD' }, { pin: 14, street: '12 LAKE SHORE RD', pkgs: 3 }, { pin: 15, street: '14 LAKE SHORE RD' }]));
  assert.equal(r.stops[1].packages, 3);
  assert.equal(r.stops[2].packages, 1);
});

test('"Return" and "Pickup" rows are pickups', () => {
  const r = parsePage(page([
    { pin: 5, street: '1 ELM ST' },
    { pin: 6, street: '3 ELM ST', extra: 'Return 1 package' },
    { pin: 7, street: '5 ELM ST', extra: 'Pickup' },
  ]));
  assert.deepEqual(nums(r), [5]);
  assert.deepEqual(r.pickups.map((p) => p.number), [6, 7]);
});

test('ordinal name is a stop; non-word name is not', () => {
  const r = parsePage(page([{ pin: 2, street: '100 21ST ST' }, { pin: 3, street: '102 B12 ST' }]));
  assert.deepEqual(nums(r), [2]);
});

test('pickup number/street dropped across pages', () => {
  const a = parsePage(page([PICKUP, { pin: 2, street: '1001 ANITA AVE' }]));
  // Another page misses the "Pick up" marker for stop 1, and an unnumbered reading of its street.
  const b = parsePage(page([{ pin: 1, street: '14000 MERRIMAN RD' }, { pin: 2, street: '1001 ANITA AVE' }, { pin: 3, street: '1003 ANITA AVE' }]));
  const c = parsePage(page([{ pin: null, street: '14000 MERRIMAN RD' }], { header: false }));
  const m = mergePages([a, b, c]);
  assert.deepEqual(m.stops.map((s) => s.number), [2, 3]);
  assert.equal(m.header, '# H-24.1B • Scheduled 3:00 - 8:00 AM');
});

test('voting across overlapping pages fixes one misread', () => {
  const p1 = parsePage(page([{ pin: 4, street: '200 VERNIER RD' }, { pin: 5, street: '210 VERNIER RD' }]));
  const p2 = parsePage(page([{ pin: 4, street: '208 VERNIER RD' }, { pin: 5, street: '210 VERNIER RD' }]));
  const p3 = parsePage(page([{ pin: 4, street: '200 VERNIER RD' }]));
  const m = mergePages([p1, p2, p3]);
  assert.equal(fmt(m.stops[0]), '200 VERNIER RD');
  assert.equal(m.stops[0].guessed, false);
});

test('vote tie goes to the reading with a unit, then the earliest', () => {
  const p1 = parsePage(page([{ pin: 4, street: '200 VERNIER RD' }]));
  const p2 = parsePage(page([{ pin: 4, street: '200 VERNIER RD APT 3' }]));
  assert.equal(fmt(mergePages([p1, p2]).stops[0]), '200 VERNIER RD APT 3');
  const q1 = parsePage(page([{ pin: 4, street: '200 VERNIER RD' }]));
  const q2 = parsePage(page([{ pin: 4, street: '900 KERBY RD' }]));
  assert.equal(fmt(mergePages([q1, q2]).stops[0]), '200 VERNIER RD');
});

test('packages by vote', () => {
  const p = (n) => parsePage(page([{ pin: 14, street: '12 LAKE SHORE RD', pkgs: n }]));
  assert.equal(mergePages([p(3), p(1), p(3)]).stops[0].packages, 3);
});

test('unnumbered reading matching a known stop is dropped', () => {
  const p1 = parsePage(page([{ pin: 4, street: '200 VERNIER RD' }, { pin: 5, street: '210 VERNIER RD' }]));
  const p2 = parsePage(page([{ pin: null, street: '210 VERNIER RD' }], { header: false }));
  const m = mergePages([p1, p2]);
  assert.deepEqual(m.stops.map((s) => s.number), [4, 5]);
  assert.ok(m.stops.every((s) => !s.guessed));
});

test('unnumbered unknown reading gets previous + 1, guessed', () => {
  // Single unpinned row at the bottom 2 rows down: not fillable.
  const lines = [
    ...block(0.1, { pin: 4, street: '200 VERNIER RD' }),
    ...block(0.17, { pin: 5, street: '210 VERNIER RD' }),
    ...block(0.31, { pin: null, street: '300 KERBY RD' }),
  ].sort((a, b) => a.midY - b.midY);
  const r = parsePage(lines);
  assert.equal(r.stops[2].number, null);
  const m = mergePages([r]);
  assert.deepEqual(m.stops.map((s) => [s.number, s.guessed]), [[4, false], [5, false], [6, true]]);
  assert.equal(fmt(m.stops[2]), '300 KERBY RD');
});

test('stops 21 and 22 at the same address are both kept', () => {
  const m = mergePages([parsePage(page([
    { pin: 20, street: '50 OAK ST' },
    { pin: 21, street: '60 OAK ST' },
    { pin: 22, street: '60 OAK ST' },
  ]))]);
  assert.deepEqual(m.stops.map((s) => s.number), [20, 21, 22]);
  assert.equal(fmt(m.stops[1]), fmt(m.stops[2]));
  assert.deepEqual(reviewIssues(m.stops).duplicates.map((d) => d.numbers), [[21, 22]]);
});

test('output sorted by number across pages', () => {
  const m = mergePages([
    parsePage(page([{ pin: 7, street: '1 ASH ST' }])),
    parsePage(page([{ pin: 3, street: '3 ELM ST' }])),
  ]);
  assert.deepEqual(m.stops.map((s) => s.number), [3, 7]);
});

test('parseTypedAddresses', () => {
  const r = parseTypedAddresses('1007 Anita Ave\n\n10635 E Hampton Ave Apt 3056\nhello there\n20 Oak St\n');
  assert.deepEqual(r.stops.map((s) => s.number), [1, 2, 3]);
  assert.equal(fmt(r.stops[1]), '10635 E HAMPTON AVE APT 3056');
  assert.ok(r.stops.every((s) => s.guessed === false));
  assert.deepEqual(r.errors, ["Line 4: can't read an address"]);
});

test('a misread pin that breaks the row spacing is cleared and refilled', () => {
  const r = parsePage(page([
    { pin: 7, street: '100 ANITA AVE' },
    { pin: 79, street: '200 BRYS DR' }, // OCR read "79" for 8
    { pin: 9, street: '300 ROSLYN RD' },
    { pin: 10, street: '400 OXFORD RD' },
  ], { header: false }));
  assert.deepEqual(nums(r), [7, 8, 9, 10]);
  assert.equal(r.stops[1].pinFilled, true);
  assert.equal(fmt(r.stops[1]), '200 BRYS DR');
});

test('a number read once whose street won under a better-read number is dropped', () => {
  const good = page([{ pin: 7, street: '100 ANITA AVE' }, { pin: 8, street: '200 BRYS DR' }], { header: false });
  const bad = page([{ pin: 79, street: '200 BRYS DR' }], { header: false });
  const m = mergePages([parsePage(good), parsePage(good), parsePage(bad)]);
  assert.deepEqual(nums(m), [7, 8]);
});

test('two well-read stops at one address both survive the misread-pin guard', () => {
  const p = page([{ pin: 21, street: '20225 MACK AVE APT 12' }, { pin: 22, street: '20225 MACK AVE APT 12' }], { header: false });
  assert.deepEqual(nums(mergePages([parsePage(p), parsePage(p)])), [21, 22]);
});
