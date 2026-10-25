import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStreet, parseStreetDetail, isRejectedLine, formatStreet, normalizeType, STREET_TYPES, DIRECTIONS,
} from '../src/street.js';

test('parses the label street line with a bare APT marker', () => {
  const d = parseStreetDetail('10635 E HAMPTON AVE APT');
  assert.deepEqual(d.address, { number: '10635', direction: 'E', name: 'HAMPTON', type: 'AVE' });
  assert.equal(d.bareUnit, true);
});

test('full address with unit, case-insensitive, uppercase output', () => {
  assert.deepEqual(parseStreet('10635 e hampton avenue apt 3056'),
    { number: '10635', direction: 'E', name: 'HAMPTON', type: 'AVE', unit: '3056' });
});

test('itinerary-style and multi-token names', () => {
  assert.deepEqual(parseStreet('1007 ANITA AVE'), { number: '1007', name: 'ANITA', type: 'AVE' });
  assert.deepEqual(parseStreet('20 GROSSE POINTE BLVD'), { number: '20', name: 'GROSSE POINTE', type: 'BLVD' });
  assert.deepEqual(parseStreet('55 W 42ND ST'), { number: '55', direction: 'W', name: '42ND', type: 'ST' });
  assert.deepEqual(parseStreet('1007 5 ST'), { number: '1007', name: '5', type: 'ST' });
  assert.equal(parseStreet('1 MARTIN LUTHER KING JR BLVD'), null); // name > 3 tokens
});

test('spelled-out direction and a direction used as the name', () => {
  assert.equal(parseStreet('400 NORTH MAIN STREET').direction, 'N');
  assert.deepEqual(parseStreet('100 E ST'), { number: '100', name: 'E', type: 'ST' });
});

test('trailing direction only when simple', () => {
  assert.deepEqual(parseStreet('123 MAIN ST NW'), { number: '123', direction: 'NW', name: 'MAIN', type: 'ST' });
  assert.equal(parseStreet('123 MAIN ST NW APT 4').unit, '4');
  assert.equal(parseStreet('123 MAIN ST N MESA').direction, undefined);
});

test('house number OCR fixes and never a leading 0', () => {
  assert.equal(parseStreet('1O635 E HAMPTON AVE').number, '10635');
  assert.equal(parseStreet('l0635 E HAMPTON AVE').number, '10635');
  assert.equal(parseStreet('I2 OAK DR').number, '12');
  assert.equal(parseStreet('0123 OAK DR'), null);
  assert.equal(parseStreet('O12 OAK DR'), null);
});

test('unit markers: APT, AP (OCR), UNIT, STE, #, glued', () => {
  assert.equal(parseStreet('5 OAK LN AP 12').unit, '12');
  assert.equal(parseStreet('5 OAK LN UNIT 7B').unit, '7B');
  assert.equal(parseStreet('5 OAK LN STE 200').unit, '200');
  assert.equal(parseStreet('5 OAK LN #12').unit, '12');
  assert.equal(parseStreet('5 OAK LN APT3056').unit, '3056');
  assert.equal(parseStreet('5 OAK LN LOT 9').unit, '9');
});

test('ignores text after the type and after a zip', () => {
  assert.deepEqual(parseStreet('10635 E HAMPTON AVE MESA AZ 85209'),
    { number: '10635', direction: 'E', name: 'HAMPTON', type: 'AVE' });
  assert.deepEqual(parseStreet('9 1007 ANITA AVE'), { number: '1007', name: 'ANITA', type: 'AVE' });
});

test('requires a street type', () => {
  assert.equal(parseStreet('MESA AZ 85209 -4164'), null);
  assert.equal(parseStreet('123 MAIN'), null);
  assert.equal(parseStreet('JANE DOE'), null);
});

test('junk never parses', () => {
  for (const t of ['0.56 Lbs', '3 hr', '2 OF 3', 'VAZ1', 'B10', '5 packages', '05:00 - 08:00', '$12.99',
    '10/23', '1 L03 / B12 DDD', 'TBA335791486589', '3056', '12 lb', '4 kg', '8 oz', '15 mins', 'Deliver 1 package',
    '05:00 - 08:00 / VAZ1 / 04:40 / 10/23 / 0.56 Lbs', '# H-24.1B • Scheduled 3:00 - 8:00 AM']) {
    assert.equal(parseStreet(t), null, t);
  }
});

test('isRejectedLine: times, prices, dates, counts, weights', () => {
  for (const t of ['3:00', '05:00 - 08:00', '$12.99', '10/23', '10/23/2026', '3 hr', '2 OF 3', '5 packages', '0.56 Lbs', '2 lb', '1 kg', '3 oz', '10 mins']) {
    assert.equal(isRejectedLine(t), true, t);
  }
  for (const t of ['10635 E HAMPTON AVE APT', '100 G ST', 'MESA AZ 85209']) assert.equal(isRejectedLine(t), false, t);
});

test('normalizeType and tables', () => {
  assert.equal(normalizeType('Avenue'), 'AVE');
  assert.equal(normalizeType('AV'), 'AVE');
  assert.equal(normalizeType('street'), 'ST');
  assert.equal(normalizeType('PARKWAY'), 'PKWY');
  assert.equal(normalizeType('CROSSING'), 'XING');
  assert.equal(normalizeType('Ave.'), 'AVE');
  assert.equal(normalizeType('HAMPTON'), null);
  assert.ok(STREET_TYPES.includes('BLVD') && STREET_TYPES.includes('LOOP'));
  assert.deepEqual([...DIRECTIONS].sort(), ['E', 'N', 'NE', 'NW', 'S', 'SE', 'SW', 'W']);
});

test('formatStreet', () => {
  assert.equal(formatStreet({ number: '10635', direction: 'E', name: 'HAMPTON', type: 'AVE', unit: '3056' }),
    '10635 E HAMPTON AVE APT 3056');
  assert.equal(formatStreet({ number: '1007', name: 'ANITA', type: 'AVE' }), '1007 ANITA AVE');
});
