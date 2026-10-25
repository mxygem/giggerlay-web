import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

class MemStore {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

function useStore(s) {
  Object.defineProperty(globalThis, 'localStorage', { value: s, configurable: true, writable: true });
}

const { loadRoute, saveRoute, loadSettings, saveSettings, ROUTE_KEY, SETTINGS_KEY } =
  await import('../src/storage.js');

const addr = (n, name = 'ANITA', type = 'AVE') => ({ number: String(n), name, type });

beforeEach(() => useStore(new MemStore()));

test('no saved route -> null', () => {
  assert.equal(loadRoute(), null);
});

test('route round-trips and stops come back sorted', () => {
  const route = {
    stops: [
      { number: 3, address: addr(20), guessed: false },
      { number: 2, address: addr(10), packages: 3, guessed: true },
    ],
    header: 'H-24.1B',
    createdAt: 123,
    source: 'import',
  };
  assert.equal(saveRoute(route), true);
  const r = loadRoute();
  assert.deepEqual(r.stops.map((s) => s.number), [2, 3]);
  assert.equal(r.stops[0].packages, 3);
  assert.equal(r.stops[0].guessed, true);
  assert.equal(r.header, 'H-24.1B');
  assert.equal(r.source, 'import');
});

test('saveRoute(null) clears it', () => {
  saveRoute({ stops: [{ number: 2, address: addr(1), guessed: false }], createdAt: 1, source: 'typed' });
  saveRoute(null);
  assert.equal(loadRoute(), null);
});

test('corrupt JSON and bad stops are survived', () => {
  localStorage.setItem(ROUTE_KEY, '{not json');
  assert.equal(loadRoute(), null);
  localStorage.setItem(ROUTE_KEY, JSON.stringify({ stops: [{ number: 'x' }, { number: 4, address: addr(5) }] }));
  assert.deepEqual(loadRoute().stops.map((s) => s.number), [4]);
});

test('settings default and merge', () => {
  assert.deepEqual(loadSettings(), { zoneSize: 10, speak: true });
  saveSettings({ speak: false });
  assert.deepEqual(loadSettings(), { zoneSize: 10, speak: false });
  saveSettings({ zoneSize: 8 });
  assert.deepEqual(loadSettings(), { zoneSize: 8, speak: false });
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ zoneSize: -3, speak: 'yes' }));
  assert.deepEqual(loadSettings(), { zoneSize: 10, speak: true });
});

test('throwing or missing localStorage never throws', () => {
  useStore({
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('denied'); },
  });
  assert.equal(loadRoute(), null);
  assert.equal(saveRoute({ stops: [], createdAt: 0, source: 'typed' }), false);
  assert.deepEqual(loadSettings(), { zoneSize: 10, speak: true });
  useStore(undefined);
  assert.equal(loadRoute(), null);
  assert.equal(saveSettings({ speak: false }), false);
});
