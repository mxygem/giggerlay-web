// "Check these": missing numbers, shared addresses, guessed numbers.
import { formatStreet } from './street.js';

/**
 * @param {import('./contracts.js').RouteStop[]} stops
 * @returns {import('./contracts.js').ReviewIssues}
 */
export function reviewIssues(stops) {
  const nums = new Set(stops.map((s) => s.number));
  const max = Math.max(0, ...nums);

  // Missing numbers from 2 up to max, as ranges.
  const missing = [];
  for (let n = 2; n <= max; n++) {
    if (nums.has(n)) continue;
    let to = n;
    while (to + 1 <= max && !nums.has(to + 1)) to++;
    missing.push({ from: n, to, label: n === to ? `${n}` : `${n}-${to}` });
    n = to;
  }

  // Stops sharing street + unit.
  const groups = new Map();
  for (const s of [...stops].sort((a, b) => a.number - b.number)) {
    const k = formatStreet(s.address);
    if (!groups.has(k)) groups.set(k, { numbers: [], address: s.address });
    groups.get(k).numbers.push(s.number);
  }
  const duplicates = [...groups.values()].filter((g) => g.numbers.length > 1);

  const guessed = stops.filter((s) => s.guessed).map((s) => s.number).sort((a, b) => a - b);
  return { missing, duplicates, guessed };
}
