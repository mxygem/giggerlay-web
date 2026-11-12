// Choose which skimmed video frames to OCR: the sharpest per window, if sharp
// enough relative to the whole video.

/**
 * @param {{t:number, sharpness:number, detail?:number}[]} samples (about every 0.1s)
 * @param {{window?:number, minRatio?:number, percentile?:number, edgeRun?:number}} [opts]
 * @returns {{times:number[], skippedBlurry:boolean, threshold:number, skipped:number}}
 */
export function pickFrames(samples, { window = 0.4, minRatio = 0.88, percentile = 0.9, edgeRun = 3, minRun = 2 } = {}) {
  const s = samples.filter((x) => Number.isFinite(x.t) && Number.isFinite(x.sharpness)).sort((a, b) => a.t - b.t);
  if (!s.length) return { times: [], skippedBlurry: false, threshold: 0, skipped: 0 };
  const sorted = s.map((x) => x.sharpness).sort((a, b) => a - b);
  const p = sorted[Math.min(sorted.length - 1, Math.ceil(percentile * sorted.length) - 1)];
  const threshold = minRatio * p;
  // Per window: among the samples about as sharp as the sharpest (within
  // 3%), the one showing the most text, so a stop near the edge of the
  // screen isn't left out by chance.
  const t0 = s[0].t, groups = [];
  for (const x of s) {
    const k = Math.floor((x.t - t0) / window + 1e-6);
    (groups[k] ??= []).push(x);
  }
  const best = groups.map((g) => {
    if (!g) return g;
    const top = Math.max(...g.map((x) => x.sharpness));
    return g.filter((x) => x.sharpness >= top * 0.97).reduce((a, b) => ((b.detail ?? 0) > (a.detail ?? 0) ? b : a));
  });
  const times = [], ok = [];
  for (const b of best) {
    if (!b) continue; // no samples in this window (gap): not a blur signal
    const good = b.sharpness >= threshold;
    ok.push(good);
    if (good) times.push(b.t);
  }
  // Blurry runs: an interior run of minRun+ windows warns (one window is just
  // a frame caught mid-scroll; its neighbors overlap it); runs touching the
  // start/end only when long (>= edgeRun windows), since the first/last
  // moments of a recording are often a tap or a settling scroll.
  let skippedBlurry = false, skipped = 0;
  for (let i = 0; i < ok.length; ) {
    if (ok[i]) { i++; continue; }
    let j = i;
    while (j < ok.length && !ok[j]) j++;
    const run = j - i, edge = i === 0 || j === ok.length;
    skipped += run;
    if (edge ? run >= edgeRun : run >= minRun) skippedBlurry = true;
    i = j;
  }
  return { times, skippedBlurry, threshold, skipped };
}
