// Shared types and constants for giggerlay web. See CONTRACTS.md.

/**
 * One line of OCR text. Coordinates are 0-1, top-origin, relative to the
 * image (or crop) that was read.
 * @typedef {{text: string, midY: number, minX: number, height: number, maxX?: number}} OCRLine
 */

/**
 * A parsed street address, uppercase.
 * @typedef {{number: string, direction?: string, name: string, type?: string, unit?: string}} StreetAddress
 */

/**
 * @typedef {{number: number, address: StreetAddress, packages?: number, guessed: boolean}} RouteStop
 */

/**
 * @typedef {{stops: RouteStop[], header?: string, createdAt: number, source: 'import'|'typed'}} Route
 */

/**
 * @typedef {{kind: 'stop', stop: RouteStop, score: number, address: StreetAddress}
 *   | {kind: 'ambiguous', stops: RouteStop[], score: number, address: StreetAddress}
 *   | {kind: 'partial', stop: RouteStop, address: StreetAddress}
 *   | {kind: 'notOnRoute', address: StreetAddress}
 *   | {kind: 'noAddress'}} MatchResult
 */

/**
 * One stop as read from a single page. number is null when no pin was read
 * or filled. pinFilled is true when the number came from row spacing.
 * @typedef {{number: number|null, address: StreetAddress, packages?: number, midY: number, pinFilled?: boolean}} PageStop
 */

/** @typedef {{number?: number, address?: StreetAddress}} Pickup */

/** @typedef {{stops: PageStop[], pickups: Pickup[], header?: string}} PageReading */

/**
 * @typedef {{missing: {from: number, to: number, label: string}[],
 *   duplicates: {numbers: number[], address: StreetAddress}[],
 *   guessed: number[]}} ReviewIssues
 */

/** @typedef {{zoneSize: number, speak: boolean}} Settings */

/** @type {Settings} */
export const DEFAULT_SETTINGS = Object.freeze({ zoneSize: 10, speak: true });

export const ZONE_COLORS = Object.freeze([
  { name: 'green', hex: '#2e9e44' },
  { name: 'blue', hex: '#1f6fe0' },
  { name: 'orange', hex: '#f08a00' },
  { name: 'purple', hex: '#8a3fd1' },
  { name: 'pink', hex: '#e0418f' },
  { name: 'teal', hex: '#0f9c98' },
  { name: 'indigo', hex: '#4b4fc7' },
  { name: 'brown', hex: '#8a5a32' },
]);

/** Colors for the ambiguous and not-on-route states. */
export const AMBIGUOUS_COLOR = '#f08a00';
export const NOT_ON_ROUTE_COLOR = '#d93025';

/**
 * Zone for a stop number. Zones change every settings.zoneSize stops, counted
 * from the first delivery stop (the lowest number in stops).
 * @param {number} number
 * @param {RouteStop[]} stops
 * @param {Settings} [settings]
 * @returns {{index: number, color: {name: string, hex: string}, from: number, to: number}}
 */
export function zoneColor(number, stops, settings = DEFAULT_SETTINGS) {
  const size = Math.max(1, Math.floor(settings.zoneSize) || DEFAULT_SETTINGS.zoneSize);
  const first = stops.length ? Math.min(...stops.map((s) => s.number)) : 2;
  const zone = Math.max(0, Math.floor((number - first) / size));
  const from = first + zone * size;
  return {
    index: zone,
    color: ZONE_COLORS[zone % ZONE_COLORS.length],
    from,
    to: from + size - 1,
  };
}
