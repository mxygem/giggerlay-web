// Tesseract.js wrapper: one lazy shared worker, returns OCRLine[] (see contracts.js).

export const TESSERACT_VERSION = '5.1.1';
const CDN = 'https://cdn.jsdelivr.net/npm';
const SCRIPT_URL = `${CDN}/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.min.js`;
const WORKER_URL = `${CDN}/tesseract.js@${TESSERACT_VERSION}/dist/worker.min.js`;
// tesseract.js 5.1.1 depends on tesseract.js-core ^5.1.1. corePath is a folder so
// the worker picks the SIMD/non-SIMD LSTM build itself.
const CORE_URL = `${CDN}/tesseract.js-core@5.1.1`;

/** Default page segmentation: 3 = auto layout. With pins inverted it reads "9 1007 ANITA AVE" rows reliably; 11 (sparse) dropped lone pin digits in tests. */
export const DEFAULT_PSM = '3';
const MIN_W = 1000; // upscale narrower crops to about this width
const MAX_SCALE = 3;

let scriptP = null, workerP = null, curPSM = null, canvas = null, override = null;

/** Replace recognize() with fn(source, opts) (tests); null restores Tesseract. */
export function setOCRForTests(fn) { override = fn; }

function loadScript() {
  if (globalThis.Tesseract) return Promise.resolve(globalThis.Tesseract);
  return (scriptP ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.crossOrigin = 'anonymous';
    s.onload = () => (globalThis.Tesseract ? resolve(globalThis.Tesseract) : reject(new Error('Tesseract missing')));
    s.onerror = () => { scriptP = null; s.remove(); reject(new Error('Could not load the text reader (offline?)')); };
    document.head.appendChild(s);
  }));
}

function getWorker() {
  return (workerP ??= loadScript()
    .then((T) => T.createWorker('eng', 1, { workerPath: WORKER_URL, corePath: CORE_URL }))
    .catch((e) => { workerP = null; throw e; }));
}

/** Start downloading the script, core and language data early (optional). */
export function warmUp() { return getWorker().then(() => {}); }

function sourceSize(src) {
  if (src.videoWidth) return [src.videoWidth, src.videoHeight];
  if (src.naturalWidth) return [src.naturalWidth, src.naturalHeight];
  return [src.width, src.height];
}

/**
 * @param {HTMLCanvasElement|OffscreenCanvas|ImageBitmap|HTMLImageElement|HTMLVideoElement|Blob} source
 * @param {{crop?:{x:number,y:number,w:number,h:number}, psm?:string|number, prepare?:boolean}} [opts]
 *   crop in source pixels; prepare=false skips grayscale/dark-region inversion
 * @returns {Promise<import('./contracts.js').OCRLine[]>}
 */
export async function recognize(source, opts = {}) {
  if (override) return override(source, opts);
  let bitmap = null;
  if (typeof Blob !== 'undefined' && source instanceof Blob) source = bitmap = await createImageBitmap(source);
  try {
    const [sw, sh] = sourceSize(source);
    const c = opts.crop ?? { x: 0, y: 0, w: sw, h: sh };
    const x = Math.max(0, Math.round(c.x)), y = Math.max(0, Math.round(c.y));
    const w = Math.min(sw - x, Math.round(c.w)), h = Math.min(sh - y, Math.round(c.h));
    if (!(w > 0 && h > 0)) return [];
    const scale = w < MIN_W ? Math.min(MAX_SCALE, MIN_W / w) : 1;
    canvas ??= document.createElement('canvas'); // reused between calls
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, x, y, w, h, 0, 0, canvas.width, canvas.height);
    if (opts.prepare !== false) prepare(ctx, canvas.width, canvas.height);
    const worker = await getWorker();
    const psm = String(opts.psm ?? DEFAULT_PSM);
    if (psm !== curPSM) { await worker.setParameters({ tessedit_pageseg_mode: psm }); curPSM = psm; }
    const { data } = await worker.recognize(canvas);
    return toLines(data.lines ?? [], canvas.width, canvas.height);
  } finally {
    bitmap?.close?.();
  }
}

/**
 * Grayscale, invert dark-mode pages, and turn white-on-dark pin circles into
 * dark digits on white: Tesseract reads them as "@", "®", "(6)" otherwise.
 * Pins are found as round, mostly filled dark blobs on a coarse grid (cheap,
 * no full-size label array).
 */
export function prepare(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  let total = 0;
  for (let i = 0; i < d.length; i += 4) total += d[i] = (77 * d[i] + 150 * d[i + 1] + 29 * d[i + 2]) >> 8;
  const inv = total / (w * h) < 100; // dark mode
  if (inv) for (let i = 0; i < d.length; i += 4) d[i] = 255 - d[i];
  // Coarse dark mask.
  const G = Math.max(2, Math.round(w / 320)), gw = Math.ceil(w / G), gh = Math.ceil(h / G);
  const acc = new Uint32Array(gw * gh), cnt = new Uint16Array(gw * gh);
  for (let y = 0; y < h; y++) {
    const row = ((y / G) | 0) * gw;
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) { acc[row + ((x / G) | 0)] += d[i]; cnt[row + ((x / G) | 0)]++; }
  }
  const mask = new Uint8Array(gw * gh); // 1 dark, 2 visited
  for (let c = 0; c < mask.length; c++) mask[c] = acc[c] < 100 * cnt[c] ? 1 : 0;
  const minD = (0.045 * w) / G, maxD = (0.14 * w) / G, stack = [];
  for (let c0 = 0; c0 < mask.length; c0++) {
    if (mask[c0] !== 1) continue;
    let x0 = gw, y0 = gh, x1 = -1, y1 = -1, n = 0, lum = 0;
    stack.push(c0); mask[c0] = 2;
    while (stack.length) { // flood fill (4-connected)
      const c = stack.pop(), cx = c % gw, cy = (c / gw) | 0;
      n++; lum += acc[c] / cnt[c];
      if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
      if (cx > 0 && mask[c - 1] === 1) { mask[c - 1] = 2; stack.push(c - 1); }
      if (cx < gw - 1 && mask[c + 1] === 1) { mask[c + 1] = 2; stack.push(c + 1); }
      if (cy > 0 && mask[c - gw] === 1) { mask[c - gw] = 2; stack.push(c - gw); }
      if (cy < gh - 1 && mask[c + gw] === 1) { mask[c + gw] = 2; stack.push(c + gw); }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    // Round-ish, pin-sized, filled like a disc with a digit hole (~0.5-0.8).
    if (bw < minD || bw > maxD || bh < minD || bh > maxD || bw > 1.35 * bh || bh > 1.35 * bw) continue;
    const fill = n / (bw * bh);
    if (fill < 0.45 || fill > 0.85) continue;
    const lo = lum / n, cxp = (x0 + bw / 2) * G, cyp = (y0 + bh / 2) * G, rx = (bw * G) / 2, ry = (bh * G) / 2;
    const px0 = Math.max(0, Math.floor(cxp - rx - G)), px1 = Math.min(w, Math.ceil(cxp + rx + G));
    const py0 = Math.max(0, Math.floor(cyp - ry - G)), py1 = Math.min(h, Math.ceil(cyp + ry + G));
    for (let y = py0; y < py1; y++) for (let x = px0; x < px1; x++) {
      const e = ((x - cxp) / rx) ** 2 + ((y - cyp) / ry) ** 2, i = (y * w + x) * 4;
      if (e < 0.6) d[i] = Math.max(0, Math.min(255, 255 - ((d[i] - lo) * 255) / (255 - lo))); // inner: invert
      else if (e < 1.15 && d[i] < 200) d[i] = 255; // ring and anti-aliased edge: white
    }
  }
  for (let i = 0; i < d.length; i += 4) d[i + 1] = d[i + 2] = d[i];
  ctx.putImageData(img, 0, 0);
}

/** Map Tesseract lines (pixel bbox) to normalized OCRLines sorted by midY. */
export function toLines(lines, cw, ch) {
  return lines
    .map((l) => ({
      text: (l.text ?? '').replace(/\s+/g, ' ').trim(),
      midY: (l.bbox.y0 + l.bbox.y1) / 2 / ch,
      minX: l.bbox.x0 / cw,
      maxX: l.bbox.x1 / cw,
      height: (l.bbox.y1 - l.bbox.y0) / ch,
    }))
    .filter((l) => l.text)
    .sort((a, b) => a.midY - b.midY || a.minX - b.minX);
}

/** Stop the worker and free its memory. The next recognize() starts a new one. */
export async function terminate() {
  const p = workerP;
  workerP = null; curPSM = null;
  if (canvas) { canvas.width = canvas.height = 0; canvas = null; }
  if (p) await p.then((w) => w.terminate()).catch(() => {});
}
