import type { Box, Mask } from './image';
import { makeMask } from './image';

// Binary morphology on 0/1 masks using integral images, so cost does not grow with radius.

function integral(m: Mask): Int32Array {
  const w = m.width + 1;
  const ii = new Int32Array(w * (m.height + 1));
  for (let y = 0; y < m.height; y++) {
    let row = 0;
    for (let x = 0; x < m.width; x++) {
      row += m.data[y * m.width + x] ? 1 : 0;
      ii[(y + 1) * w + x + 1] = ii[y * w + x + 1] + row;
    }
  }
  return ii;
}

function boxCount(ii: Int32Array, iw: number, x0: number, y0: number, x1: number, y1: number): number {
  return ii[y1 * iw + x1] - ii[y0 * iw + x1] - ii[y1 * iw + x0] + ii[y0 * iw + x0];
}

/** Square dilation (r > 0) or erosion (r < 0). */
function morph(m: Mask, r: number, dilate: boolean): Mask {
  if (r <= 0) return { ...m, data: m.data.slice() };
  const out = makeMask(m.width, m.height);
  const ii = integral(m);
  const iw = m.width + 1;
  for (let y = 0; y < m.height; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(m.height, y + r + 1);
    for (let x = 0; x < m.width; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(m.width, x + r + 1);
      const c = boxCount(ii, iw, x0, y0, x1, y1);
      // Erosion treats pixels outside the image as background.
      out.data[y * m.width + x] = dilate ? (c > 0 ? 1 : 0) : (c === (2 * r + 1) * (2 * r + 1) ? 1 : 0);
    }
  }
  return out;
}

export const dilate = (m: Mask, r: number) => morph(m, Math.round(r), true);
export const erode = (m: Mask, r: number) => morph(m, Math.round(r), false);
export const close = (m: Mask, r: number) => erode(dilate(m, r), r);
export const open = (m: Mask, r: number) => dilate(erode(m, r), r);

/** Closing that does not shrink shapes touching the image edge (pads first). */
export function closePadded(m: Mask, r: number): Mask {
  r = Math.round(r);
  if (r <= 0) return m;
  const p = r + 1;
  const big = makeMask(m.width + 2 * p, m.height + 2 * p);
  for (let y = 0; y < m.height; y++) big.data.set(m.data.subarray(y * m.width, (y + 1) * m.width), (y + p) * big.width + p);
  const c = close(big, r);
  const out = makeMask(m.width, m.height);
  for (let y = 0; y < m.height; y++) out.data.set(c.data.subarray((y + p) * big.width + p, (y + p) * big.width + p + m.width), y * m.width);
  return out;
}

/** Separable box blur on a float field, repeated for a near-Gaussian result. */
export function blurField(src: Float32Array, w: number, h: number, r: number, passes = 2): Float32Array {
  r = Math.round(r);
  if (r <= 0) return src.slice();
  let a = src.slice();
  let b = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        b[row + x] = acc / (2 * r + 1);
        acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc / (2 * r + 1);
        acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return a;
}

export interface Component {
  label: number;
  area: number;
  box: Box;
  cx: number;
  cy: number;
  touchesEdge: boolean;
}

/** 8-connected component labelling. labels[i] = component index + 1, or 0. */
export function components(m: Mask): { labels: Int32Array; comps: Component[] } {
  const { width: w, height: h } = m;
  const labels = new Int32Array(w * h);
  const comps: Component[] = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (!m.data[start] || labels[start]) continue;
    const label = comps.length + 1;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = label;
    let area = 0, minX = w, minY = h, maxX = 0, maxY = 0, sx = 0, sy = 0, edge = false;
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % w, y = (i / w) | 0;
      area++; sx += x; sy += y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const j = ny * w + nx;
          if (m.data[j] && !labels[j]) { labels[j] = label; stack[sp++] = j; }
        }
      }
    }
    comps.push({ label, area, box: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }, cx: sx / area, cy: sy / area, touchesEdge: edge });
  }
  return { labels, comps };
}

/** Fill background regions not connected to the border and smaller than maxArea pixels. */
export function fillHoles(m: Mask, maxArea = Infinity): Mask {
  const inv = makeMask(m.width, m.height);
  for (let i = 0; i < inv.data.length; i++) inv.data[i] = m.data[i] ? 0 : 1;
  const { labels, comps } = components(inv);
  const out = { ...m, data: m.data.slice() };
  const fill = new Uint8Array(comps.length + 1);
  for (const c of comps) if (!c.touchesEdge && c.area <= maxArea) fill[c.label] = 1;
  for (let i = 0; i < out.data.length; i++) if (labels[i] && fill[labels[i]]) out.data[i] = 1;
  return out;
}

/** Keep only components with area >= minFraction of the biggest one (and >= minArea). */
export function keepBig(m: Mask, minFraction: number, minArea = 0): Mask {
  const { labels, comps } = components(m);
  if (!comps.length) return m;
  const biggest = Math.max(...comps.map((c) => c.area));
  const keep = new Uint8Array(comps.length + 1);
  for (const c of comps) if (c.area >= biggest * minFraction && c.area >= minArea) keep[c.label] = 1;
  const out = makeMask(m.width, m.height);
  for (let i = 0; i < out.data.length; i++) out.data[i] = labels[i] && keep[labels[i]] ? 1 : 0;
  return out;
}

export function countOn(m: Mask): number {
  let n = 0;
  for (let i = 0; i < m.data.length; i++) n += m.data[i] ? 1 : 0;
  return n;
}

export function maskBounds(m: Mask): Box | null {
  let minX = m.width, minY = m.height, maxX = -1, maxY = -1;
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      if (!m.data[y * m.width + x]) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Nearest-neighbour resample of a mask onto a new grid. */
export function resizeMask(m: Mask, w: number, h: number): Mask {
  const out = makeMask(w, h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(m.height - 1, Math.floor(((y + 0.5) * m.height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(m.width - 1, Math.floor(((x + 0.5) * m.width) / w));
      out.data[y * w + x] = m.data[sy * m.width + sx];
    }
  }
  return out;
}
