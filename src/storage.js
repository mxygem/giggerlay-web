// Saved route and settings, kept in localStorage as JSON. Nothing leaves the
// phone. Every access is wrapped: private mode, a full quota or a missing
// localStorage must never break the app.
import { DEFAULT_SETTINGS } from './contracts.js';

export const ROUTE_KEY = 'giggerlay.route.v1';
export const SETTINGS_KEY = 'giggerlay.settings.v1';

function store() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function readJSON(key) {
  try {
    const s = store();
    const raw = s && s.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJSON(key, value) {
  try {
    const s = store();
    if (!s) return false;
    if (value == null) s.removeItem(key);
    else s.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function validStop(s) {
  return (
    s && Number.isInteger(s.number) && s.number > 0 &&
    s.address && typeof s.address.number === 'string' &&
    typeof s.address.name === 'string' && typeof s.address.type === 'string'
  );
}

/** @returns {import('./contracts.js').Route|null} */
export function loadRoute() {
  const r = readJSON(ROUTE_KEY);
  if (!r || !Array.isArray(r.stops)) return null;
  const stops = r.stops
    .filter(validStop)
    .map((s) => ({ ...s, guessed: !!s.guessed }))
    .sort((a, b) => a.number - b.number);
  return {
    stops,
    ...(r.header ? { header: String(r.header) } : {}),
    createdAt: Number(r.createdAt) || 0,
    source: r.source === 'typed' ? 'typed' : 'import',
  };
}

/**
 * Save the route (stops are sorted by number). Pass null to clear it.
 * @param {import('./contracts.js').Route|null} route
 * @returns {boolean} false if it could not be saved
 */
export function saveRoute(route) {
  if (!route) return writeJSON(ROUTE_KEY, null);
  const stops = [...(route.stops || [])].sort((a, b) => a.number - b.number);
  return writeJSON(ROUTE_KEY, { ...route, stops });
}

/** @returns {import('./contracts.js').Settings} */
export function loadSettings() {
  const s = readJSON(SETTINGS_KEY);
  const out = { ...DEFAULT_SETTINGS };
  if (s && typeof s === 'object') {
    const z = Math.floor(Number(s.zoneSize));
    if (Number.isFinite(z) && z >= 1) out.zoneSize = Math.min(z, 999);
    if (typeof s.speak === 'boolean') out.speak = s.speak;
  }
  return out;
}

/** @param {import('./contracts.js').Settings} settings */
export function saveSettings(settings) {
  return writeJSON(SETTINGS_KEY, { ...loadSettings(), ...settings });
}
