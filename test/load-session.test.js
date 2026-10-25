import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLoadSession } from '../src/load/session.js';
import { AMBIGUOUS_COLOR, NOT_ON_ROUTE_COLOR, ZONE_COLORS } from '../src/contracts.js';

// Route: stops 2..25, stop 12 has 3 packages.
const addr = (n) => ({ number: String(1000 + n), name: 'MAIN', type: 'ST' });
const stops = Array.from({ length: 24 }, (_, i) => ({ number: i + 2, address: addr(i + 2), guessed: false, ...(i + 2 === 12 ? { packages: 3 } : {}) }));
const route = { stops, createdAt: 0, source: 'typed' };
const byNum = (n) => stops.find((s) => s.number === n);

// Stub matcher: a frame is described by one token in lines[0].text:
// "12" stop, "12|13" ambiguous, "X" not on route, "" no address.
function match(lines) {
  const t = lines[0]?.text ?? '';
  if (!t) return { kind: 'noAddress' };
  if (t === 'X') return { kind: 'notOnRoute', address: { number: '9', name: 'ELM', type: 'RD' } };
  const nums = t.split('|').map(Number);
  if (nums.length > 1) return { kind: 'ambiguous', stops: nums.map(byNum), score: 0.8, address: byNum(nums[0]).address };
  return { kind: 'stop', stop: byNum(nums[0]), score: 1, address: byNum(nums[0]).address };
}
const tracking = (b) => (/^TBA\d{9,15}$/.test(b) ? b : null);

function setup(settings = { zoneSize: 10, speak: true }) {
  let t = 0;
  const s = createLoadSession(route, settings, { now: () => t, match, tracking });
  // frame(token, {dt, tba}) advances the clock by dt (default 100ms) then feeds a frame
  const frame = (tok, { dt = 100, tba } = {}) => { t += dt; return s.onFrame({ lines: tok ? [{ text: tok, midY: 0.5, minX: 0, height: 0.1 }] : [], barcodes: tba ? [tba] : [] }); };
  return { s, frame };
}

test('one frame is not enough; two agreeing frames show the stop', () => {
  const { frame } = setup();
  const a = frame('12');
  assert.equal(a.display.kind, 'idle');
  assert.equal(a.announce, undefined);
  const b = frame('12');
  assert.equal(b.display.kind, 'stop');
  assert.equal(b.display.text, '12');
  assert.equal(b.announce, '12');
});

test('disagreeing frames do not show anything', () => {
  const { frame } = setup();
  frame('12'); const r = frame('13');
  assert.equal(r.display.kind, 'idle');
  assert.equal(frame('13').display.text, '13');
});

test('noAddress frames do not break a streak', () => {
  const { frame } = setup();
  frame('12'); frame(''); const r = frame('12');
  assert.equal(r.display.text, '12');
  assert.equal(r.announce, '12');
});

test('not on route needs 5 frames, shows red ?', () => {
  const { frame } = setup();
  for (let i = 0; i < 4; i++) assert.equal(frame('X').display.kind, 'idle');
  const r = frame('X');
  assert.equal(r.display.kind, 'notOnRoute');
  assert.equal(r.display.text, '?');
  assert.equal(r.display.color, NOT_ON_ROUTE_COLOR);
  assert.ok(r.announce);
  assert.deepEqual(r.counts, { packages: 0, stops: 0 });
});

test('ambiguous shows orange "12 or 13"', () => {
  const { frame } = setup();
  frame('13|12'); const r = frame('12|13');
  assert.equal(r.display.kind, 'ambiguous');
  assert.equal(r.display.text, '12 or 13'); // same set in either order agrees
  assert.equal(r.display.color, AMBIGUOUS_COLOR);
  assert.equal(r.announce, r.display.text);
  assert.deepEqual(r.counts, { packages: 0, stops: 0 });
});

test('ambiguous text lists stops best first', () => {
  const { frame } = setup();
  frame('12|13'); const r = frame('12|13');
  assert.equal(r.display.text, '12 or 13');
});

test('zone label and color: size 10 from first stop 2', () => {
  const { frame } = setup();
  frame('11'); const a = frame('11');
  assert.equal(a.display.zoneLabel, 'Stops 2-11');
  assert.equal(a.display.color, ZONE_COLORS[0].hex);
  frame('12'); const b = frame('12');
  assert.equal(b.display.zoneLabel, 'Stops 12-21');
  assert.equal(b.display.color, ZONE_COLORS[1].hex);
  assert.match(b.display.address, /1012 MAIN ST/);
});

test('label kept in view does not re-announce', () => {
  const { frame } = setup();
  frame('12'); assert.equal(frame('12').announce, '12');
  for (let i = 0; i < 20; i++) assert.equal(frame(i % 3 ? '12' : '').announce, undefined);
  assert.deepEqual(frame('12').counts, { packages: 1, stops: 1 });
});

test('>1s with no address then same stop: new package, announced again', () => {
  const { frame } = setup();
  frame('12'); const a = frame('12');
  assert.equal(a.display.packageLabel, 'package 1 of 3');
  frame('', { dt: 600 }); frame('', { dt: 600 });
  frame('12'); const b = frame('12');
  assert.equal(b.announce, '12');
  assert.equal(b.display.packageLabel, 'package 2 of 3');
  assert.deepEqual(b.counts, { packages: 2, stops: 1 });
});

test('gap under 1s does not start a new package', () => {
  const { frame } = setup();
  frame('12'); frame('12');
  frame('', { dt: 400 }); frame('', { dt: 400 });
  frame('12'); const r = frame('12');
  assert.equal(r.announce, undefined);
  assert.equal(r.counts.packages, 1);
});

test('different TBA on the same stop re-announces and is counted', () => {
  const { frame } = setup();
  frame('12', { tba: 'TBA111111111111' }); assert.equal(frame('12', { tba: 'TBA111111111111' }).announce, '12');
  frame('12', { tba: 'TBA222222222222' });
  const r = frame('12', { tba: 'TBA222222222222' });
  assert.equal(r.announce, '12');
  assert.equal(r.display.packageLabel, 'package 2 of 3');
  assert.deepEqual(r.counts, { packages: 2, stops: 1 });
});

test('same TBA scanned twice is not double-counted', () => {
  const { frame } = setup();
  frame('12', { tba: 'TBA111111111111' }); frame('12', { tba: 'TBA111111111111' });
  frame('', { dt: 750 }); frame('', { dt: 750 });
  frame('12', { tba: 'TBA111111111111' });
  const r = frame('12', { tba: 'TBA111111111111' });
  assert.equal(r.announce, '12'); // still spoken: it's a fresh look at a label
  assert.deepEqual(r.counts, { packages: 1, stops: 1 });
});

test('TBA read after the announcement merges with an earlier same-TBA package', () => {
  const { frame } = setup();
  frame('12', { tba: 'TBA111111111111' }); frame('12');
  frame('', { dt: 750 }); frame('', { dt: 750 });
  frame('12'); frame('12'); // counted without a TBA (2)
  const r = frame('12', { tba: 'TBA111111111111' }); // barcode turns up: same package
  assert.deepEqual(r.counts, { packages: 1, stops: 1 });
});

test('without TBAs a package is counted per announcement', () => {
  const { frame } = setup();
  frame('12'); frame('12');
  frame('5', { dt: 200 }); frame('5');
  frame('12', { dt: 200 }); const r = frame('12');
  assert.equal(r.announce, '12');
  assert.deepEqual(r.counts, { packages: 3, stops: 2 });
});

test('counts footer over several stops; stop without packages field', () => {
  const { s, frame } = setup();
  const gap = () => { frame('', { dt: 600 }); frame('', { dt: 600 }); };
  for (const n of [2, 3, 3, 20]) { gap(); frame(String(n)); frame(String(n)); }
  assert.deepEqual(s.counts(), { packages: 4, stops: 3 });
  gap(); frame('20'); const r = frame('20');
  assert.equal(r.display.packageLabel, 'package 2');
});

test('slow frames (OCR > 1s each) on one label do not re-announce', () => {
  const { frame } = setup();
  frame('12', { dt: 1500 }); assert.equal(frame('12', { dt: 1500 }).announce, '12');
  frame('', { dt: 1500 }); // one blurry frame is not a gap
  for (let i = 0; i < 4; i++) assert.equal(frame('12', { dt: 1500 }).announce, undefined);
  assert.equal(frame('12').counts.packages, 1);
});

test('display is marked stale after 1s without an address', () => {
  const { frame } = setup();
  frame('12'); frame('12');
  const r = frame('', { dt: 1100 });
  assert.equal(r.display.text, '12');
  assert.equal(r.display.stale, true);
});

test('cssRectToVideo maps a guide rect through object-fit: cover', async () => {
  const { cssRectToVideo } = await import('../src/load/camera.js');
  // 430x932 portrait element, 1920x1080 landscape video: scale = 932/1080, sides cropped
  const s = 932 / 1080, ox = (430 - 1920 * s) / 2;
  const r = cssRectToVideo({ x: 40, y: 400, w: 350, h: 300 }, 430, 932, 1920, 1080);
  assert.equal(r.x, Math.round((40 - ox) / s));
  assert.equal(r.y, Math.round(400 / s));
  assert.equal(r.w, Math.round(350 / s));
  assert.equal(r.h, Math.round(300 / s));
  // whole element maps to the visible middle of the video
  const all = cssRectToVideo({ x: 0, y: 0, w: 430, h: 932 }, 430, 932, 1920, 1080);
  assert.equal(all.y, 0); assert.equal(all.h, 1080);
  assert.equal(all.x + all.w / 2, 960);
});

test('real matchLabel + trackingFromBarcode: label sample announces stop 12', async () => {
  const { parseStreet } = await import('../src/street.js');
  const rs = [
    { number: 2, address: parseStreet('1007 ANITA AVE'), guessed: false },
    { number: 12, address: parseStreet('10635 E HAMPTON AVE APT 3056'), packages: 2, guessed: false },
  ];
  let t = 0;
  const s = createLoadSession({ stops: rs, createdAt: 0, source: 'import' }, { zoneSize: 10, speak: true }, { now: () => (t += 200) });
  const L = (text, midY) => ({ text, midY, minX: 0.1, height: 0.05 });
  const lines = [L('JANE DOE', 0.1), L('10635 E HAMPTON AVE APT', 0.2), L('3056', 0.3), L('MESA AZ 85209 -4164', 0.4), L('TBA335791486589', 0.5)];
  s.onFrame({ lines, barcodes: ['TBA335791486589'] });
  const r = s.onFrame({ lines, barcodes: [] });
  assert.equal(r.announce, '12');
  assert.equal(r.display.text, '12');
  assert.equal(r.display.address, '10635 E HAMPTON AVE APT 3056');
  assert.equal(r.display.zoneLabel, 'Stops 12-21');
  assert.equal(r.display.packageLabel, 'package 1 of 2');
});
