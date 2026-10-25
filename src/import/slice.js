// Split tall (scrolling) screenshots into screen-shaped tiles with 30% overlap.

export const TALL_RATIO = 2.6; // taller than this x width gets sliced
export const TILE_RATIO = 2.17; // tile height / width (an iPhone screen)
export const OVERLAP = 0.3;

/** @returns {{x:number,y:number,w:number,h:number}[]} pixel rects covering the image */
export function slicePlan(width, height) {
  const w = Math.round(width), h = Math.round(height);
  if (!(w > 0 && h > 0)) return [];
  if (h <= TALL_RATIO * w) return [{ x: 0, y: 0, w, h }];
  const tileH = Math.round(TILE_RATIO * w);
  const step = Math.max(1, Math.round(tileH * (1 - OVERLAP)));
  const rects = [];
  for (let y = 0; y + tileH < h; y += step) rects.push({ x: 0, y, w, h: tileH });
  rects.push({ x: 0, y: h - tileH, w, h: tileH }); // last tile flush with the bottom
  return rects;
}
