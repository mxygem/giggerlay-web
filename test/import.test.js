import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slicePlan } from '../src/import/slice.js';
import { sharpness } from '../src/import/sharpness.js';
import { fingerprint, fingerprintDiff, FP_W, FP_H } from '../src/import/fingerprint.js';
import { pickFrames } from '../src/import/frames.js';

const img = (w, h, f) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = f(x, y), i = (y * w + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  return { width: w, height: h, data };
};

test('slicePlan: normal screenshot is one rect', () => {
  assert.deepEqual(slicePlan(1290, 2796), [{ x: 0, y: 0, w: 1290, h: 2796 }]);
  assert.deepEqual(slicePlan(1170, 3042), [{ x: 0, y: 0, w: 1170, h: 3042 }]); // exactly 2.6x
});

test('slicePlan: long screenshot tiles with 30% overlap, covering the bottom', () => {
  const r = slicePlan(1170, 7000), tileH = Math.round(2.17 * 1170);
  assert.ok(r.length >= 3);
  assert.equal(r[0].y, 0);
  for (const t of r) assert.deepEqual([t.x, t.w, t.h], [0, 1170, tileH]);
  for (let i = 1; i < r.length; i++) {
    const overlap = r[i - 1].y + tileH - r[i].y;
    assert.ok(overlap >= Math.round(0.3 * tileH) - 1, `overlap ${overlap}`);
    assert.ok(r[i].y > r[i - 1].y);
  }
  assert.equal(r.at(-1).y + tileH, 7000);
  for (let i = 1; i < r.length - 1; i++) assert.equal(r[i].y - r[i - 1].y, Math.round(0.7 * tileH));
});

test('slicePlan: degenerate sizes', () => {
  assert.deepEqual(slicePlan(0, 100), []);
});

test('sharpness: flat is 0, horizontal stripes high, vertical stripes 0', () => {
  assert.equal(sharpness(img(20, 20, () => 128)), 0);
  assert.equal(sharpness(img(20, 20, (x, y) => (y % 2 ? 255 : 0))), 255);
  assert.equal(sharpness(img(20, 20, (x) => (x % 2 ? 255 : 0))), 0);
  const blur = sharpness(img(20, 40, (x, y) => (y % 8) * 30)); // smooth ramps
  assert.ok(blur > 0 && blur < 255);
});

test('fingerprint: 24x52, identical = 0, different > 2', () => {
  const a = img(120, 260, (x, y) => (x * 7 + y * 3) % 256);
  const fa = fingerprint(a);
  assert.equal(fa.length, FP_W * FP_H);
  assert.equal(FP_W, 24); assert.equal(FP_H, 52);
  assert.equal(fingerprintDiff(fa, fingerprint(a)), 0);
  assert.ok(fingerprintDiff(fingerprint(img(120, 260, () => 0)), fingerprint(img(120, 260, () => 255))) > 250);
  // area average: uniform image -> uniform fingerprint
  assert.ok(fingerprint(img(50, 70, () => 100)).every((v) => Math.abs(v - 100) < 1e-3));
  assert.equal(fingerprintDiff(fa, null), Infinity);
});

const series = (vals) => vals.map((s, i) => ({ t: +(i * 0.1).toFixed(1), sharpness: s }));

test('pickFrames: sharpest per 0.4s window above threshold', () => {
  const r = pickFrames(series([10, 12, 11, 10, 9, 10, 11, 13]));
  assert.deepEqual(r.times, [0.1, 0.7]);
  assert.equal(r.skippedBlurry, false);
  // threshold = 0.88 * p90
  assert.ok(Math.abs(r.threshold - 0.88 * 13) < 1e-9);
});

test('pickFrames: interior blurry window warns', () => {
  const r = pickFrames(series([10, 10, 10, 10, 2, 3, 2, 1, 10, 10, 10, 10]));
  assert.deepEqual(r.times, [0, 0.8]);
  assert.equal(r.skippedBlurry, true);
  assert.equal(r.skipped, 1);
});

test('pickFrames: one blurry window at start or end does not nag', () => {
  const r = pickFrames(series([1, 2, 1, 1, 10, 10, 10, 10, 10, 10, 10, 10, 1, 1, 1, 1]));
  assert.deepEqual(r.times, [0.4, 0.8]);
  assert.equal(r.skippedBlurry, false);
  // but a long blurry tail (3 windows) does
  const long = pickFrames(series([10, 10, 10, 10, ...Array(12).fill(1), 10, 10, 10, 10].concat(Array(12).fill(1))));
  assert.equal(long.skippedBlurry, true);
});

test('pickFrames: empty and flat input', () => {
  assert.deepEqual(pickFrames([]).times, []);
  const flat = pickFrames(series([5, 5, 5, 5, 5, 5, 5, 5]));
  assert.equal(flat.times.length, 2);
  assert.equal(flat.skippedBlurry, false);
});

test('pickFrames: unsorted samples and custom options', () => {
  const s = series([10, 12, 11, 10, 9, 10, 11, 13]).reverse();
  assert.deepEqual(pickFrames(s).times, [0.1, 0.7]);
  assert.deepEqual(pickFrames(series([10, 12, 11, 10]), { window: 0.2 }).times, [0.1, 0.2]);
});

test('ocr toLines: normalizes boxes, trims, drops empty, sorts by midY', async () => {
  const { toLines } = await import('../src/ocr.js');
  const lines = toLines([
    { text: ' 1007 ANITA AVE \n', bbox: { x0: 100, y0: 400, x1: 500, y1: 440 } },
    { text: '  ', bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
    { text: '9', bbox: { x0: 20, y0: 395, x1: 60, y1: 445 } },
    { text: '# H-24.1B', bbox: { x0: 0, y0: 100, x1: 600, y1: 140 } },
  ], 1000, 2000);
  assert.deepEqual(lines.map((l) => l.text), ['# H-24.1B', '9', '1007 ANITA AVE']); // same midY: left first
  const l = lines[2], near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  near(l.midY, 0.21); near(l.minX, 0.1); near(l.maxX, 0.5); near(l.height, 0.02);
});
