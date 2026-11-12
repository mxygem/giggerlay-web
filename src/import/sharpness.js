// Sharpness of a skimmed video frame. Scrolling smears text vertically, which
// lowers vertical pixel change but leaves horizontal change alone, so the
// ratio drops on smeared frames whatever is on screen. (A plain mean of
// vertical change also dropped on frames that just show less text, like the
// empty end of the list, and skipped the last stops.) A nearly blank frame
// counts as sharp: there is nothing on it to lose.

/**
 * @param {{width:number,height:number,data:ArrayLike<number>}} img RGBA
 * @returns {{sharpness:number, detail:number}} detail = mean horizontal change (how much text)
 */
export function measure(img) {
  const { width: w, height: h, data: d } = img;
  if (w < 2 || h < 2) return { sharpness: 0, detail: 0 };
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; p < g.length; i += 4, p++) g[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  let vertical = 0, horizontal = 0;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const p = g[y * w + x];
      vertical += Math.abs(g[(y + 1) * w + x] - p);
      horizontal += Math.abs(g[y * w + x + 1] - p);
    }
  }
  const detail = horizontal / (w * (h - 1));
  if (detail <= 0.5) return { sharpness: 1, detail };
  return { sharpness: vertical / horizontal, detail };
}

/** @param {{width:number,height:number,data:ArrayLike<number>}} img RGBA */
export function sharpness(img) {
  return measure(img).sharpness;
}
