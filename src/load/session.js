// Load-screen state machine: turns per-frame OCR/barcode readings into what
// to show, what to say, and package counts. Pure; time is injected.
import { matchLabel, trackingFromBarcode } from '../matcher.js';
import { formatStreet } from '../street.js';
import { zoneColor, AMBIGUOUS_COLOR, NOT_ON_ROUTE_COLOR, DEFAULT_SETTINGS } from '../contracts.js';

export const STOP_FRAMES = 2; // agreeing frames to show a stop / ambiguous set
export const NOT_ON_ROUTE_FRAMES = 5; // agreeing frames to show "?"
export const NEW_LABEL_GAP_MS = 1000; // no address this long => next label is a new package
export const NEW_LABEL_FRAMES = 2; // ...seen on at least this many frames (slow OCR can't fake a gap)

const IDLE = Object.freeze({ kind: 'idle', text: '', color: '#000000', address: '', zoneLabel: '', packageLabel: '' });

/** Stable key for "same result": stop number, ambiguous set, or notOnRoute. */
function keyOf(r) {
  if (r.kind === 'stop') return `s${r.stop.number}`;
  if (r.kind === 'ambiguous') return `a${r.stops.map((s) => s.number).sort((a, b) => a - b).join(',')}`;
  if (r.kind === 'partial') return `p${r.stop.number}`;
  if (r.kind === 'notOnRoute') return 'n';
  return null;
}

/** "12 or 13", "12, 13 or 14". */
function orList(nums) {
  return nums.length < 2 ? String(nums[0] ?? '') : `${nums.slice(0, -1).join(', ')} or ${nums[nums.length - 1]}`;
}

/**
 * @param {import('../contracts.js').Route} route
 * @param {import('../contracts.js').Settings} settings
 * @param {{now?: () => number, match?: Function, tracking?: Function}} [opts]
 */
export function createLoadSession(route, settings = DEFAULT_SETTINGS, { now = Date.now, match = matchLabel, tracking = trackingFromBarcode } = {}) {
  const stops = route?.stops ?? [];
  const perStop = new Map(); // stop number -> {tbas:Set, untracked:number}
  let cand = null; // {key, streak, result}
  let pkg = null; // open package: {key, result, tba}
  let lastAddrAt = -Infinity;
  let blank = 0; // consecutive noAddress frames
  let display = IDLE;

  const tally = (n) => {
    if (!perStop.has(n)) perStop.set(n, { tbas: new Set(), untracked: 0 });
    return perStop.get(n);
  };
  const stopCount = (n) => { const t = perStop.get(n); return t ? t.tbas.size + t.untracked : 0; };

  function counts() {
    let packages = 0, stopsN = 0;
    for (const n of perStop.keys()) { const c = stopCount(n); packages += c; if (c) stopsN++; }
    return { packages, stops: stopsN };
  }

  // Count a package for a stop; a TBA already counted for that stop adds nothing.
  function countPackage(n, tba) {
    const t = tally(n);
    if (!tba) t.untracked++;
    else t.tbas.add(tba);
  }
  // A TBA arrived after the package was counted without one.
  function attachTba(n, tba) {
    const t = tally(n);
    if (t.untracked > 0) t.untracked--;
    t.tbas.add(tba);
  }

  function render(result) {
    if (result.kind === 'stop') {
      const n = result.stop.number;
      const z = zoneColor(n, stops, settings);
      const c = stopCount(n);
      const total = result.stop.packages;
      return {
        kind: 'stop', text: String(n), color: z.color.hex,
        address: formatStreet(result.stop.address),
        zoneLabel: `Stops ${z.from}-${z.to}`,
        packageLabel: total ? `package ${c} of ${total}` : `package ${c}`,
      };
    }
    if (result.kind === 'ambiguous') {
      const nums = result.stops.map((s) => s.number);
      return { kind: 'ambiguous', text: orList(nums), color: AMBIGUOUS_COLOR, address: formatStreet(result.address), zoneLabel: '', packageLabel: '' };
    }
    if (result.kind === 'partial') {
      // House number cut off on the label: a likely stop, not counted as a package.
      return { kind: 'partial', text: `${result.stop.number}?`, color: AMBIGUOUS_COLOR, address: formatStreet(result.stop.address), zoneLabel: 'House number is cut off', packageLabel: '' };
    }
    return { kind: 'notOnRoute', text: '?', color: NOT_ON_ROUTE_COLOR, address: result.address ? formatStreet(result.address) : '', zoneLabel: 'Not on route', packageLabel: '' };
  }

  const spoken = (r) => (r.kind === 'notOnRoute' ? 'Not on route'
    : r.kind === 'ambiguous' ? orList(r.stops.map((s) => s.number))
      : r.kind === 'partial' ? `Maybe ${r.stop.number}` : String(r.stop.number));

  function onFrame({ lines = [], barcodes = [] } = {}) {
    const t = now();
    const tba = barcodes.map((b) => tracking(b)).find(Boolean) || null;
    const result = match(lines, stops) || { kind: 'noAddress' };
    const key = keyOf(result);
    let announce;

    // No address for 1s (over 2+ frames) means whatever comes next is a new label.
    blank = key ? 0 : blank + 1;
    if (!key && blank >= NEW_LABEL_FRAMES && t - lastAddrAt > NEW_LABEL_GAP_MS) { pkg = null; cand = null; }
    // A different TBA in view means a different package, even before OCR agrees.
    if (tba && pkg?.tba && tba !== pkg.tba) { pkg = null; cand = null; }

    if (key) {
      lastAddrAt = t;
      // Keep the TBA seen on any frame of the streak (barcode and OCR may land on different frames).
      cand = cand?.key === key ? { key, streak: cand.streak + 1, result, tba: tba || cand.tba } : { key, streak: 1, result, tba };
      const need = key === 'n' ? NOT_ON_ROUTE_FRAMES : STOP_FRAMES;
      if (cand.streak >= need) {
        if (!pkg || pkg.key !== key) {
          // New package: count it (stops only) and announce.
          pkg = { key, result, tba: cand.tba };
          if (result.kind === 'stop') countPackage(result.stop.number, cand.tba);
          announce = spoken(result);
        } else {
          pkg.result = result;
          if (tba && !pkg.tba) {
            pkg.tba = tba;
            if (result.kind === 'stop') attachTba(result.stop.number, tba);
          }
        }
        display = render(pkg.result);
      }
    } else if (tba && pkg && !pkg.tba && pkg.result.kind === 'stop') {
      // Barcode read on a frame where OCR missed: still belongs to the open package.
      pkg.tba = tba;
      attachTba(pkg.result.stop.number, tba);
      display = render(pkg.result);
    }
    // noAddress frames leave cand untouched so a blurry frame doesn't break a streak.

    const state = { display: { ...display, stale: display.kind !== 'idle' && t - lastAddrAt > NEW_LABEL_GAP_MS }, counts: counts() };
    if (announce) state.announce = announce;
    return state;
  }

  return { onFrame, counts };
}
