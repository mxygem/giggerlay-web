// Barcode reading: native BarcodeDetector when it supports Code 128,
// otherwise zxing-js (UMD, loaded lazily from unpkg, global ZXing).

export const ZXING_URL = 'https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js';
const NATIVE_FORMATS = ['code_128', 'data_matrix', 'qr_code', 'pdf417'];

let enginePromise = null;

/** Which engine detect() uses: 'native' | 'zxing' (resolves after loading). */
export function barcodeEngine() { return getEngine().then((e) => e.name); }

function getEngine() {
  return (enginePromise ??= (async () => {
    try {
      if ('BarcodeDetector' in globalThis) {
        const supported = await globalThis.BarcodeDetector.getSupportedFormats();
        if (supported.includes('code_128')) {
          const det = new globalThis.BarcodeDetector({ formats: NATIVE_FORMATS.filter((f) => supported.includes(f)) });
          return { name: 'native', detect: async (c) => (await det.detect(c)).map((b) => b.rawValue).filter(Boolean) };
        }
      }
    } catch { /* fall through to zxing */ }
    return zxingEngine(await loadZXing());
  })().catch((e) => { enginePromise = null; throw e; }));
}

function loadZXing() {
  if (globalThis.ZXing) return Promise.resolve(globalThis.ZXing);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = ZXING_URL;
    s.crossOrigin = 'anonymous';
    s.onload = () => (globalThis.ZXing ? resolve(globalThis.ZXing) : reject(new Error('ZXing missing')));
    s.onerror = () => { s.remove(); reject(new Error('Could not load the barcode reader (offline?)')); };
    document.head.appendChild(s);
  });
}

function zxingEngine(Z) {
  const reader = new Z.MultiFormatReader();
  const hints = new Map();
  // 1D readers run first, so Code 128 (the TBA) wins over the 2D codes.
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.DATA_MATRIX, Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.PDF_417]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  reader.setHints(hints);
  let gray = null;
  return {
    name: 'zxing',
    async detect(canvas) {
      const { width: w, height: h } = canvas;
      if (!w || !h) return [];
      const px = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
      if (!gray || gray.length !== w * h) gray = new Uint8ClampedArray(w * h);
      for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
      const bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(gray, w, h)));
      try { return [reader.decodeWithState(bmp).getText()]; }
      catch { return []; } // NotFound / Checksum / Format exceptions: nothing this frame
      finally { reader.reset(); }
    },
  };
}

/**
 * Read barcodes from a canvas. Never throws for "nothing found"; rejects only
 * when no engine could be loaded.
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<string[]>}
 */
export async function detect(canvas) {
  const e = await getEngine();
  try { return await e.detect(canvas); } catch { return []; }
}
