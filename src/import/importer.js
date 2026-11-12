// Import screenshots and screen recordings of the Flex itinerary into stops.
// Never saves anything: the caller decides (an import with no stops must not
// replace the saved route).
import { recognize } from '../ocr.js';
import { parsePage as defaultParsePage, mergePages as defaultMergePages } from '../itinerary.js';
import { slicePlan } from './slice.js';
import { measure } from './sharpness.js';
import { fingerprint, fingerprintDiff } from './fingerprint.js';
import { pickFrames } from './frames.js';
import { reviewIssues } from '../review.js';

export const SLOWER = 'record again a little slower';
export const NO_STOPS = 'No stops found';
const STEP = 0.1; // skim step, seconds
const SKIM_W = 180; // skim canvas width, px
const REPEAT_DIFF = 2; // fingerprint diff below this = same screen
const SEEK_TIMEOUT = 4000;

const isVideo = (f) => /^video\//.test(f.type) || /\.(mov|mp4|m4v|webm)$/i.test(f.name ?? '');

/**
 * @param {File[]} files images and/or videos
 * @param {{ocr?: Function, onProgress?: (p:{done:number,total:number,phase:string,file?:number}) => void,
 *   parsePage?: Function, mergePages?: Function}} [opts]
 * @returns {Promise<{pages: import('../contracts.js').PageReading[], stops: import('../contracts.js').RouteStop[], header?: string, warnings: string[]}>}
 */
export async function importFiles(files, opts = {}) {
  const { ocr = recognize, onProgress = () => {}, parsePage = defaultParsePage, mergePages = defaultMergePages } = opts;
  const pages = [], warnings = [];
  let blurry = false;
  const list = [...files];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    const progress = (done, total, phase) => onProgress({ done, total, phase, file: i, files: list.length });
    try {
      if (isVideo(f)) blurry = (await readVideo(f, { ocr, parsePage, pages, progress })) || blurry;
      else await readImage(f, { ocr, parsePage, pages, progress });
    } catch (e) {
      warnings.push(`Couldn't read ${f.name || 'a file'}: ${e?.message ?? e}`);
    }
  }
  const merged = pages.length ? mergePages(pages) : { stops: [] };
  // Only worth a re-record when the blurry stretch actually cost stops.
  if (blurry && merged.stops?.length && reviewIssues(merged.stops).missing.length) warnings.push(SLOWER);
  if (!merged.stops?.length) warnings.push(NO_STOPS);
  return { pages, stops: merged.stops ?? [], header: merged.header, warnings };
}

// ---- images ----

async function decodeImage(file) {
  try {
    const bmp = await createImageBitmap(file);
    return { src: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
  } catch {
    // Fallback (older Safari / very large images).
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    try { await img.decode(); } catch (e) { URL.revokeObjectURL(url); throw new Error('not an image'); }
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, close: () => { URL.revokeObjectURL(url); img.src = ''; } };
  }
}

async function readImage(file, { ocr, parsePage, pages, progress }) {
  const im = await decodeImage(file);
  try {
    const tiles = slicePlan(im.w, im.h);
    progress(0, tiles.length, 'read');
    for (let k = 0; k < tiles.length; k++) {
      const crop = tiles.length > 1 ? tiles[k] : undefined;
      pages.push(parsePage(await ocr(im.src, crop ? { crop } : {})));
      progress(k + 1, tiles.length, 'read');
    }
  } finally {
    im.close();
  }
}

// ---- videos ----

function once(el, ok, ms, bad = 'error') {
  return new Promise((resolve, reject) => {
    const done = (fn, v) => { clearTimeout(timer); el.removeEventListener(ok, onOk); el.removeEventListener(bad, onBad); fn(v); };
    const onOk = () => done(resolve);
    const onBad = () => done(reject, new Error('video could not be read'));
    const timer = setTimeout(() => done(reject, new Error(`video timed out (${ok})`)), ms);
    el.addEventListener(ok, onOk);
    el.addEventListener(bad, onBad);
  });
}

// Seek and wait until the frame is ready to draw. iOS Safari: 'seeked' can
// fire before the frame is painted, so also wait for a video frame callback
// when available (briefly; it never fires if the frame didn't change).
async function seek(v, t) {
  if (Math.abs(v.currentTime - t) < 1e-3 && v.readyState >= 2) return;
  const p = once(v, 'seeked', SEEK_TIMEOUT);
  v.currentTime = t;
  await p;
  if (v.requestVideoFrameCallback) {
    await new Promise((r) => { const id = setTimeout(r, 120); v.requestVideoFrameCallback(() => { clearTimeout(id); r(); }); });
  } else if (v.readyState < 2) {
    await once(v, 'canplay', 1000).catch(() => {});
  }
}

async function readVideo(file, { ocr, parsePage, pages, progress }) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
  const small = document.createElement('canvas');
  try {
    const meta = once(v, 'loadeddata', 15000);
    v.src = url;
    v.load();
    await meta;
    // iOS sometimes won't decode frames for a never-played video; nudge it.
    try { await v.play(); v.pause(); } catch {}
    let dur = v.duration;
    if (!Number.isFinite(dur)) { // some recordings report Infinity until seeked far
      await seek(v, 1e6).catch(() => {});
      dur = v.duration;
    }
    if (!Number.isFinite(dur) || !(dur > 0) || !v.videoWidth) throw new Error('video has no frames');
    small.width = SKIM_W;
    small.height = Math.max(2, Math.round((SKIM_W * v.videoHeight) / v.videoWidth));
    const ctx = small.getContext('2d', { willReadFrequently: true });
    const grab = () => { ctx.drawImage(v, 0, 0, small.width, small.height); return ctx.getImageData(0, 0, small.width, small.height); };

    // 1) Skim small frames for sharpness.
    const n = Math.max(1, Math.floor(dur / STEP + 1e-6));
    const samples = [];
    progress(0, n, 'skim');
    for (let i = 0; i < n; i++) {
      const t = Math.min(dur - 0.01, i * STEP + 0.02); // just after the step mark
      await seek(v, t);
      samples.push({ t, ...measure(grab()) });
      if (i % 5 === 4 || i === n - 1) progress(i + 1, n, 'skim');
    }

    // 2) OCR picked frames at full resolution, skipping repeats.
    const { times, skippedBlurry } = pickFrames(samples);
    let last = null;
    progress(0, times.length, 'read');
    for (let k = 0; k < times.length; k++) {
      await seek(v, times[k]);
      const fp = fingerprint(grab());
      if (fingerprintDiff(fp, last) >= REPEAT_DIFF) {
        last = fp;
        pages.push(parsePage(await ocr(v))); // ocr draws the full-res frame itself
      }
      progress(k + 1, times.length, 'read');
    }
    return skippedBlurry;
  } finally {
    v.removeAttribute('src'); v.load();
    URL.revokeObjectURL(url);
    small.width = small.height = 0;
  }
}
