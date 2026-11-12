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
    const pins = opts.prepare !== false ? prepare(ctx, canvas.width, canvas.height) : [];
    const worker = await getWorker();
    const psm = String(opts.psm ?? DEFAULT_PSM);
    if (psm !== curPSM) { await worker.setParameters({ tessedit_pageseg_mode: psm }); curPSM = psm; }
    const { data } = await worker.recognize(canvas);
    const lines = toLines(data.lines ?? [], canvas.width, canvas.height);
    if (opts.pins === false) return lines;
    // Pins read on their own replace whatever the page pass made of them.
    const pinLines = await readPins(worker, canvas, pins, canvas.width, canvas.height);
    const kept = lines.filter((l) => !pinLines.some((p) => Math.abs(l.midY - p.midY) < 1.5 * p.height && l.maxX <= p.maxX + 0.04));
    return [...kept, ...pinLines].sort((a, b) => a.midY - b.midY || a.minX - b.minX);
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
  // Light pages: pins are dark discs. Dark pages (inverted above): Flex's
  // pins are mid-tone (blue, green or gray) discs, so after inversion they
  // are mid-gray on white; look for those instead.
  const mask = new Uint8Array(gw * gh); // 1 candidate, 2 visited
  for (let c = 0; c < mask.length; c++) {
    const v = acc[c] / cnt[c];
    mask[c] = inv ? (v > 110 && v < 225 ? 1 : 0) : (v < 100 ? 1 : 0);
  }
  const minD = (0.045 * w) / G, maxD = (0.14 * w) / G, stack = [], pins = [];
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
    // Stop pins sit in the left column (the "?" help button is also a disc).
    const isPin = cxp < 0.25 * w;
    if (isPin && !inv) pins.push({ x0: Math.max(0, cxp - rx * 0.75), x1: Math.min(w, cxp + rx * 0.75), y0: Math.max(0, cyp - ry * 0.75), y1: Math.min(h, cyp + ry * 0.75) });
    if (inv) {
      // Mid-gray disc with a black digit (white in the original): the digit
      // stays black, everything else in the disc turns white.
      // The box around it (pin tail, timeline line) is cleared too, so the
      // digit stands alone: Tesseract skips a lone digit with marks beside it.
      const qy0 = Math.max(0, Math.floor(cyp - 1.6 * ry)), qy1 = Math.min(h, Math.ceil(cyp + 2.4 * ry));
      const qx0 = Math.max(0, Math.floor(cxp - 1.4 * rx)), qx1 = Math.min(w, Math.ceil(cxp + 2 * rx));
      let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
      for (let y = qy0; y < qy1; y++) for (let x = qx0; x < qx1; x++) {
        const e = ((x - cxp) / rx) ** 2 + ((y - cyp) / ry) ** 2, i = (y * w + x) * 4;
        const ink = e < 0.6 && d[i] < lo - 50;
        d[i] = ink ? 0 : 255;
        if (ink) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
      }
      // The digit's own box, for reading it on its own.
      if (isPin && bx1 > bx0 && by1 > by0) pins.push({ x0: bx0, x1: bx1 + 1, y0: by0, y1: by1 + 1 });
      continue;
    }
    for (let y = py0; y < py1; y++) for (let x = px0; x < px1; x++) {
      const e = ((x - cxp) / rx) ** 2 + ((y - cyp) / ry) ** 2, i = (y * w + x) * 4;
      if (e < 0.6) d[i] = Math.max(0, Math.min(255, 255 - ((d[i] - lo) * 255) / (255 - lo))); // inner: invert
      else if (e < 1.15 && d[i] < 200) d[i] = 255; // ring and anti-aliased edge: white
    }
  }
  for (let i = 0; i < d.length; i += 4) d[i + 1] = d[i + 2] = d[i];
  ctx.putImageData(img, 0, 0);
  return pins;
}

/**
 * Read each cleaned pin on its own as one line of digits. Tesseract's page
 * layout often drops a lone digit or glues it to the line beside it.
 * Returns OCRLines in the canvas's 0-1 coordinates.
 */
async function readPins(worker, src, pins, cw, ch) {
  const out = [];
  if (!pins.length) return out;
  const pc = document.createElement('canvas');
  await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789' });
  curPSM = null;
  try {
    for (const p of pins) {
      const bw = p.x1 - p.x0, bh = p.y1 - p.y0;
      if (!(bw > 2 && bh > 2)) continue;
      const k = 48 / bh, pad = 24;
      if (bw > 4 * bh) continue; // not a 1-3 digit number
      pc.width = Math.round(bw * k) + 2 * pad;
      pc.height = Math.round(bh * k) + 2 * pad;
      const c = pc.getContext('2d');
      c.fillStyle = '#fff';
      c.fillRect(0, 0, pc.width, pc.height);
      c.imageSmoothingQuality = 'high';
      c.drawImage(src, p.x0, p.y0, bw, bh, pad, pad, bw * k, bh * k);
      const { data } = await worker.recognize(pc);
      const text = (data.text ?? '').replace(/\D/g, '');
      // The ink's width must fit the digit count (measured on Flex's pins:
      // one digit 0.48-0.83 of its height, two digits 1.0-1.57). A read that
      // doesn't fit ("1" for 11) is dropped; row spacing fills it instead.
      const r = bw / bh, fits = text.length === 1 ? r < 0.92 : text.length === 2 ? r >= 0.9 && r < 2 : r >= 1.4;
      if (/^[1-9]\d{0,2}$/.test(text) && fits && (data.confidence ?? 100) >= 60) {
        out.push({ text, midY: (p.y0 + p.y1) / 2 / ch, minX: p.x0 / cw, maxX: p.x1 / cw, height: bh / ch, pin: true });
      }
    }
  } finally {
    await worker.setParameters({ tessedit_char_whitelist: '' });
    pc.width = pc.height = 0;
  }
  return out;
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
