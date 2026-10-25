import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelAddresses, scoreAddress, matchLabel, trackingFromBarcode, ACCEPT, AMBIGUOUS_GAP } from '../src/matcher.js';
import { parseStreet } from '../src/street.js';

const L = (texts) => texts.map((text, i) => ({ text, midY: (i + 0.5) / texts.length, minX: 0.1, height: 0.03 }));
const stop = (number, text) => ({ number, address: parseStreet(text), guessed: false });

const STOPS = [
  stop(2, '1007 ANITA AVE'),
  stop(5, '10635 E HAMPTON AVE APT 2041'),
  stop(7, '10635 E HAMPTON AVE APT 3056'),
  stop(9, '10653 E HAMPTON AVE APT 3056'),
  stop(21, '500 OAK ST'),
  stop(22, '500 OAK ST'),
];

const label = (street, unitLines) => L([
  'FREE SHIPPING WITH PRIME', 'Smile more, shop more',
  '1 L03 / B12 DDD', 'B10', 'JANE DOE', street, ...unitLines,
  'TBA335791486589', '05:00 - 08:00 / VAZ1 / 04:40 / 10/23 / 0.56 Lbs',
]);

test('constants', () => {
  assert.equal(ACCEPT, 0.7);
  assert.equal(AMBIGUOUS_GAP, 0.15);
});

test('label sample picks APT 3056 over decoys', () => {
  const r = matchLabel(label('10635 E HAMPTON AVE APT', ['3056', 'MESA AZ 85209 -4164']), STOPS);
  assert.equal(r.kind, 'stop');
  assert.equal(r.stop.number, 7);
  assert.equal(r.address.unit, '3056');
});

test('unit below the city line', () => {
  const r = matchLabel(label('10635 E HAMPTON AVE APT', ['MESA AZ 85209 -4164', '3056']), STOPS);
  assert.equal(r.kind, 'stop');
  assert.equal(r.stop.number, 7);
});

test('OCR reads APT as AP', () => {
  const r = matchLabel(label('10635 E HAMPTON AVE AP', ['3056', 'MESA AZ 85209 -4164']), STOPS);
  assert.equal(r.kind, 'stop');
  assert.equal(r.stop.number, 7);
});

test('labelAddresses: only the street, unit joined; junk ignored', () => {
  const a = labelAddresses(label('10635 E HAMPTON AVE APT', ['3056', 'MESA AZ 85209 -4164']));
  assert.deepEqual(a, [{ number: '10635', direction: 'E', name: 'HAMPTON', type: 'AVE', unit: '3056' }]);
});

test('lone unit must be within 3 lines and not a station code', () => {
  assert.equal(labelAddresses(L(['5 OAK LN APT', 'VAZ1', 'B10', '12B']))[0].unit, '12B');
  assert.equal(labelAddresses(L(['5 OAK LN APT', 'MESA AZ 85209', 'X', 'Y', '12']))[0].unit, undefined);
  assert.equal(labelAddresses(L(['5 OAK LN APT', '0.56 Lbs', '12']))[0].unit, '12');
});

test('next line starting with a unit marker gives the unit', () => {
  assert.equal(labelAddresses(L(['5 OAK LN', 'APT 12']))[0].unit, '12');
  assert.equal(labelAddresses(L(['5 OAK LN', 'AP 12']))[0].unit, '12');
  assert.equal(labelAddresses(L(['5 OAK LN', '# 12']))[0].unit, '12');
  // A lone number after a street without a bare marker is not a unit.
  assert.equal(labelAddresses(L(['5 OAK LN', '12']))[0].unit, undefined);
});

test('lines are sorted by midY', () => {
  const lines = [
    { text: '3056', midY: 0.5, minX: 0.1, height: 0.03 },
    { text: '10635 E HAMPTON AVE APT', midY: 0.4, minX: 0.1, height: 0.03 },
  ];
  assert.equal(labelAddresses(lines)[0].unit, '3056');
});

const A = (t) => parseStreet(t);

test('scoreAddress: house number must match exactly', () => {
  assert.equal(scoreAddress(A('10653 E HAMPTON AVE'), A('10635 E HAMPTON AVE')), 0);
  assert.equal(scoreAddress(A('1O635 E HAMPTON AVE'), A('10635 E HAMPTON AVE')), 1);
});

test('scoreAddress: name edit distance, min 0.6', () => {
  const s = scoreAddress(A('10635 E HAMPTDN AVE'), A('10635 E HAMPTON AVE'));
  assert.ok(s > 0.8 && s < 1, String(s));
  assert.equal(scoreAddress(A('10635 E OAK AVE'), A('10635 E HAMPTON AVE')), 0);
});

test('scoreAddress: token prefix >= 0.85', () => {
  assert.ok(scoreAddress(A('20 GROSSE BLVD'), A('20 GROSSE POINTE BLVD')) >= 0.85);
});

test('scoreAddress: direction, type and unit adjustments', () => {
  const base = A('10 E OAK ST');
  assert.equal(scoreAddress(A('10 W OAK ST'), base), 0.5);
  assert.equal(scoreAddress(A('10 OAK ST'), base), 1);
  assert.equal(scoreAddress(A('10 E OAK AVE'), base), 0.75);
  assert.ok(Math.abs(scoreAddress(A('10 E OAK ST APT 3'), A('10 E OAK ST APT 3')) - 1.1) < 1e-9);
  assert.ok(Math.abs(scoreAddress(A('10 E OAK ST APT 3'), A('10 E OAK ST APT 4')) - 0.7) < 1e-9);
  assert.equal(scoreAddress(A('10 E OAK ST APT 3'), base), 1);
  assert.equal(scoreAddress(A('10 W OAK AVE APT 3'), A('10 E OAK ST APT 4')), 0); // clamped
});

test('shared-address stops are ambiguous, best first by lower number', () => {
  const r = matchLabel(L(['JANE DOE', '500 OAK ST', 'MESA AZ 85209']), STOPS);
  assert.equal(r.kind, 'ambiguous');
  assert.deepEqual(r.stops.map((s) => s.number), [21, 22]);
});

test('missing unit on a building with two stops is ambiguous', () => {
  const r = matchLabel(L(['10635 E HAMPTON AVE', 'MESA AZ 85209']), STOPS);
  assert.equal(r.kind, 'ambiguous');
  assert.deepEqual(r.stops.map((s) => s.number), [5, 7]);
});

test('real street not on route => notOnRoute', () => {
  const r = matchLabel(L(['JANE DOE', '742 EVERGREEN TER', 'SPRINGFIELD OR 97477']), STOPS);
  assert.equal(r.kind, 'notOnRoute');
  assert.equal(r.address.name, 'EVERGREEN');
});

test('junk-only label => noAddress', () => {
  const r = matchLabel(L(['1 L03 / B12 DDD', 'B10', 'TBA335791486589', '05:00 - 08:00 / VAZ1 / 04:40 / 10/23 / 0.56 Lbs', '3 hr', '2 OF 3']), STOPS);
  assert.deepEqual(r, { kind: 'noAddress' });
  assert.deepEqual(matchLabel([], STOPS), { kind: 'noAddress' });
});

test('trackingFromBarcode', () => {
  assert.equal(trackingFromBarcode('TBA335791486589'), 'TBA335791486589');
  assert.equal(trackingFromBarcode('tba335791486589'), 'TBA335791486589');
  assert.equal(trackingFromBarcode('TBA12345678'), null); // 8 digits
  assert.equal(trackingFromBarcode('TBA1234567890123456'), null); // 16 digits
  assert.equal(trackingFromBarcode('1Z999AA10123456784'), null);
  assert.equal(trackingFromBarcode(null), null);
});
