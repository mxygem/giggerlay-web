// Behavior ported from the iOS app after Gem's real 42-stop import (10/27):
// pin on the card's first line above the street, typeless streets, SHRS,
// readings lined up across frames, cut-off house numbers on labels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePage, mergePages } from '../src/itinerary.js';
import { formatStreet, parseStreet } from '../src/street.js';
import { matchLabel } from '../src/matcher.js';
import { createLoadSession } from '../src/load/session.js';
import { reviewIssues } from '../src/review.js';

const L = (text, midY, minX = 0.2) => ({ text, midY, minX, height: 0.015 });
const ROW = 0.13; // card height on screen

// Real Flex card: pin on the "Expected by" line 0.056 above the street
// (0.08 with "Next Stop:" on top), route code, street, city, deliver line.
function card(y, { pin, street, city = 'MESA', pkgs = 1, next = false, station = false }) {
  const out = [];
  const top = y - (next ? 0.08 : 0.056);
  if (next) out.push(L('Next Stop:', top - 0.02, 0.2));
  if (pin != null) out.push(L(String(pin), top, 0.07));
  out.push(L(station ? 'Picked up at 2:21 AM' : 'Expected by 6:00 AM', top, 0.2));
  if (!station) out.push(L('# F.L03.OV', y - 0.028, 0.2));
  out.push(L(street, y), L(city, y + 0.022));
  if (!station) out.push(L(`Deliver ${pkgs} package${pkgs === 1 ? '' : 's'}`, y + 0.044));
  return out;
}
// A screen showing cards [{pin, street, ...}] starting at y0.
const screen = (cards, y0 = 0.15) => cards.flatMap((c, i) => card(y0 + i * ROW, c)).sort((a, b) => a.midY - b.midY);
const fmt = (s) => formatStreet(s.address);
const view = (m) => m.stops.map((s) => [s.number, fmt(s), s.guessed]);

test('real layout: each card takes the pin on its own first line, including "Next Stop"', () => {
  const r = parsePage(screen([
    { pin: 1, street: '1600 S Country Club Dr', station: true },
    { pin: 2, street: '3636 E INVERNESS AVE APT 2051', next: true },
    { pin: 3, street: '3332 E Enid Ave' },
    { pin: 4, street: '1061 N PLYMOUTH CT' },
  ]));
  assert.deepEqual(r.stops.map((s) => [s.number, fmt(s)]), [
    [2, '3636 E INVERNESS AVE APT 2051'], [3, '3332 E ENID AVE'], [4, '1061 N PLYMOUTH CT'],
  ]);
  assert.equal(r.pickups.length, 1);
});

test('real layout: pin read on the same line as "Expected by"', () => {
  const lines = screen([{ pin: null, street: '100 W MAIN ST' }, { pin: null, street: '200 W MAIN ST' }])
    .map((l) => (l.text === 'Expected by 6:00 AM' ? { ...l, text: `${l.midY < 0.2 ? 7 : 8} Expected by 6:00 AM`, minX: 0.07 } : l));
  assert.deepEqual(parsePage(lines).stops.map((s) => s.number), [7, 8]);
});

test('real layout: a card whose pin was not read never takes the pin of the card above', () => {
  const r = parsePage(screen([
    { pin: 5, street: '100 W MAIN ST' },
    { pin: null, street: '200 W MAIN ST' },
  ]));
  assert.deepEqual(r.stops.map((s) => s.number), [5, null]);
});

test('typeless street "1721 S. Lemon" counts on a real card, not elsewhere', () => {
  const r = parsePage(screen([
    { pin: 9, street: '1700 S Lemon St' },
    { pin: 10, street: '1721 S. Lemon' },
    { pin: 11, street: '1750 S Lemon St' },
  ]));
  assert.deepEqual(r.stops.map((s) => [s.number, fmt(s)]), [[9, '1700 S LEMON ST'], [10, '1721 S LEMON'], [11, '1750 S LEMON ST']]);
  // Without a city line and a deliver line right below it, it isn't a stop.
  assert.equal(parsePage([L('1721 S. Lemon', 0.3), L('Something else 4', 0.33)]).stops.length, 0);
  // "12 Expected by" style lines are never typeless streets.
  assert.equal(parsePage([L('12 Expected by', 0.3), L('MESA', 0.32), L('Deliver 1 package', 0.34)]).stops.length, 0);
});

test('a type OCR ran into the name is split back off', async () => {
  const { parseTypelessStreet } = await import('../src/street.js');
  assert.equal(formatStreet(parseTypelessStreet('2214 VERNIERRD')), '2214 VERNIER RD');
  assert.equal(formatStreet(parseTypelessStreet('1721 S HOWARD')), '1721 S HOWARD'); // short stem stays
});

test('SHRS is a street type', () => {
  assert.equal(parseStreet('1220 N CRYSTAL SHRS').type, 'SHRS');
  const r = parsePage(screen([{ pin: 31, street: '1220 N CRYSTAL SHRS' }]));
  assert.deepEqual(r.stops.map((s) => [s.number, fmt(s)]), [[31, '1220 N CRYSTAL SHRS']]);
});

test('no pins anywhere: the station counts as 1, deliveries numbered from 2 in order', () => {
  const pages = [
    screen([{ street: '1600 S Country Club Dr', station: true }, { street: '100 ELM ST' }, { street: '200 ELM ST' }, { street: '300 ELM ST' }]),
    screen([{ street: '200 ELM ST' }, { street: '300 ELM ST' }, { street: '1721 S. Lemon' }, { street: '500 ELM ST' }]),
  ].map(parsePage);
  assert.deepEqual(view(mergePages(pages)), [
    [2, '100 ELM ST', true], [3, '200 ELM ST', true], [4, '300 ELM ST', true], [5, '1721 S LEMON', true], [6, '500 ELM ST', true],
  ]);
});

test('a misread street in its place in the list votes for that stop instead of becoming a new one', () => {
  const good = [{ pin: 6, street: '3100 E ELM ST' }, { pin: null, street: '3332 E Enid Ave' }, { pin: null, street: '1061 N PLYMOUTH CT' }, { pin: 9, street: '500 W OAK ST' }];
  const bad = [{ pin: 6, street: '3100 E ELM ST' }, { pin: null, street: '3552 b Enid Ave' }, { pin: null, street: '1061 NI DIVMAUITU CT' }, { pin: 9, street: '500 W OAK ST' }];
  // Pins 7 and 8 unreadable on every frame (and too far from the read pins
  // to fill): numbering comes from counting.
  const pages = [good, bad, good].map((c) => parsePage(screen(c)));
  const m = mergePages(pages);
  assert.deepEqual(m.stops.map((s) => [s.number, fmt(s)]), [
    [6, '3100 E ELM ST'], [7, '3332 E ENID AVE'], [8, '1061 N PLYMOUTH CT'], [9, '500 W OAK ST'],
  ]);
});

test('a phantom reading seen in few frames between steady neighbors is dropped', () => {
  const a = [{ street: '100 ELM ST' }, { street: '200 ELM ST' }];
  const withJunk = [{ street: '100 ELM ST' }, { street: '9999 SCREDULEC AVE' }, { street: '200 ELM ST' }];
  const pages = [a, a, withJunk, a].map((c) => parsePage(screen(c)));
  assert.deepEqual(view(mergePages(pages)), [[2, '100 ELM ST', true], [3, '200 ELM ST', true]]);
});

test('an unpinned stop with no room before the next pinned number is left out, and shows as a gap', () => {
  // Counting says the stop after 4 is 5, but 5 is pinned below it: something
  // was miscounted, so the unpinned stop is left out rather than misnumbered.
  const m = mergePages([parsePage(screen([
    { pin: 4, street: '100 ELM ST' }, { pin: null, street: '150 ELM ST' }, { pin: 5, street: '200 ELM ST' },
  ]))]);
  assert.deepEqual(m.stops.map((s) => s.number), [4, 5]);
  assert.deepEqual(reviewIssues(m.stops).missing.map((x) => [x.from, x.to]), [[2, 3]]);
});

// ---- labels

const LBL = (texts) => texts.map((t, i) => L(t, 0.1 + i * 0.05));
const ROUTE = [
  { number: 9, address: parseStreet('3828 E GABLE AVE'), guessed: false },
  { number: 12, address: parseStreet('500 W OAK ST'), guessed: false },
];

test('label with its house number cut off at the left is a partial match', () => {
  const r = matchLabel(LBL(['828 E GABLE AVE', 'MESA AZ 85209']), ROUTE);
  assert.equal(r.kind, 'partial');
  assert.equal(r.stop.number, 9);
  // A single digit isn't enough to go on.
  assert.equal(matchLabel(LBL(['8 E GABLE AVE']), ROUTE).kind, 'notOnRoute');
  // Two stops that both end in the cut-off number: ambiguous.
  const two = [...ROUTE, { number: 14, address: parseStreet('1828 E GABLE AVE'), guessed: false }];
  assert.deepEqual(matchLabel(LBL(['828 E GABLE AVE']), two).stops.map((s) => s.number), [9, 14]);
});

test('load screen shows "9?" for a partial match, says "Maybe 9" and does not count it', () => {
  let t = 0;
  const s = createLoadSession({ stops: ROUTE }, undefined, { now: () => (t += 100) });
  const frame = { lines: LBL(['828 E GABLE AVE', 'MESA AZ 85209']) };
  s.onFrame(frame);
  const st = s.onFrame(frame);
  assert.equal(st.display.text, '9?');
  assert.equal(st.display.zoneLabel, 'House number is cut off');
  assert.equal(st.announce, 'Maybe 9');
  assert.deepEqual(st.counts, { packages: 0, stops: 0 });
});
