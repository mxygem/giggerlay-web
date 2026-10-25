// Sharpness = mean absolute vertical change of gray. Scrolling blur smears
// text vertically, so this drops sharply on motion-blurred video frames.

/** @param {{width:number,height:number,data:ArrayLike<number>}} img RGBA */
export function sharpness(img) {
  const { width: w, height: h, data: d } = img;
  if (w < 1 || h < 2) return 0;
  let prev = new Float32Array(w), cur = new Float32Array(w), sum = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
      cur[x] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (y) sum += Math.abs(cur[x] - prev[x]);
    }
    [prev, cur] = [cur, prev];
  }
  return sum / (w * (h - 1));
}
