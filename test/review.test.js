import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewIssues } from '../src/review.js';

const A = (number, name, unit) => ({ number, name, type: 'AVE', ...(unit ? { unit } : {}) });
const S = (n, addr, guessed = false) => ({ number: n, address: addr, guessed });

test('missing numbers as ranges from 2', () => {
  const stops = [3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 16].map((n) => S(n, A(String(100 + n), 'ANITA')));
  assert.deepEqual(reviewIssues(stops).missing, [
    { from: 2, to: 2, label: '2' },
    { from: 7, to: 7, label: '7' },
    { from: 14, to: 15, label: '14-15' },
  ]);
});

test('no stops, no issues', () => {
  assert.deepEqual(reviewIssues([]), { missing: [], duplicates: [], guessed: [] });
});

test('duplicates share street + unit; 21 and 22 reported', () => {
  const stops = [
    S(20, A('50', 'OAK')),
    S(22, A('60', 'OAK')),
    S(21, A('60', 'OAK')),
    S(23, A('70', 'OAK', '1')),
    S(24, A('70', 'OAK', '2')),
  ];
  const r = reviewIssues(stops);
  assert.equal(r.duplicates.length, 1);
  assert.deepEqual(r.duplicates[0].numbers, [21, 22]);
  assert.equal(r.duplicates[0].address.number, '60');
});

test('guessed numbers listed', () => {
  const r = reviewIssues([S(2, A('1', 'ELM')), S(5, A('3', 'ELM'), true), S(3, A('5', 'ELM'), true)]);
  assert.deepEqual(r.guessed, [3, 5]);
});
