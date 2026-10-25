// Tiny grayscale thumbnail used to skip repeated video frames.

export const FP_W = 24, FP_H = 52;

/** Area-average an RGBA image down to 24x52 gray. @returns {Float32Array} */
export function fingerprint(img) {
  const { width: w, height: h, data: d } = img;
  const sum = new Float32Array(FP_W * FP_H), n = new Float32Array(FP_W * FP_H);
  for (let y = 0; y < h; y++) {
    const row = Math.min(FP_H - 1, Math.floor((y * FP_H) / h)) * FP_W;
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
      const c = row + Math.min(FP_W - 1, Math.floor((x * FP_W) / w));
      sum[c] += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      n[c]++;
    }
  }
  for (let c = 0; c < sum.length; c++) sum[c] = n[c] ? sum[c] / n[c] : 0;
  return sum;
}

/** Mean absolute difference, 0-255 scale. Infinity when either is missing. */
export function fingerprintDiff(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}
