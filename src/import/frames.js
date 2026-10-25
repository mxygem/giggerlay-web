// Choose which skimmed video frames to OCR: the sharpest per window, if sharp
// enough relative to the whole video.

/**
 * @param {{t:number, sharpness:number}[]} samples (about every 0.1s)
 * @param {{window?:number, minRatio?:number, percentile?:number, edgeRun?:number}} [opts]
 * @returns {{times:number[], skippedBlurry:boolean, threshold:number, skipped:number}}
 */
export function pickFrames(samples, { window = 0.4, minRatio = 0.88, percentile = 0.9, edgeRun = 3 } = {}) {
  const s = samples.filter((x) => Number.isFinite(x.t) && Number.isFinite(x.sharpness)).sort((a, b) => a.t - b.t);
  if (!s.length) return { times: [], skippedBlurry: false, threshold: 0, skipped: 0 };
  const sorted = s.map((x) => x.sharpness).sort((a, b) => a - b);
  const p = sorted[Math.min(sorted.length - 1, Math.ceil(percentile * sorted.length) - 1)];
  const threshold = minRatio * p;
  // Best sample per window.
  const t0 = s[0].t, best = [];
  for (const x of s) {
    const k = Math.floor((x.t - t0) / window + 1e-6);
    if (!best[k] || x.sharpness > best[k].sharpness) best[k] = x;
  }
  const times = [], ok = [];
  for (const b of best) {
    if (!b) continue; // no samples in this window (gap): not a blur signal
    const good = b.sharpness >= threshold;
    ok.push(good);
    if (good) times.push(b.t);
  }
  // Blurry runs: any interior run warns; runs touching the start/end only
  // when long (>= edgeRun windows), since the first/last moments of a
  // recording are often a tap or a settling scroll.
  let skippedBlurry = false, skipped = 0;
  for (let i = 0; i < ok.length; ) {
    if (ok[i]) { i++; continue; }
    let j = i;
    while (j < ok.length && !ok[j]) j++;
    const run = j - i, edge = i === 0 || j === ok.length;
    skipped += run;
    if (!edge || run >= edgeRun) skippedBlurry = true;
    i = j;
  }
  return { times, skippedBlurry, threshold, skipped };
}
