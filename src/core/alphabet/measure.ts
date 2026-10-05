import { maskBounds } from '../mask';
import type { Measure, StyleSample } from './types';

// Measurements of one captured letter.
// STUB: rough stroke width from a chamfer distance transform; no medial axis, slant or wobble.
// To be replaced by a full implementation (exact Euclidean distance transform, thinning,
// medial-axis paths, slant and wobble).

export function measureSample(s: StyleSample): Measure {
  const { width: w, height: h, data } = s.mask;
  const b = maskBounds(s.mask) ?? { x: 0, y: 0, w, h };
  const dist = new Float32Array(w * h);
  const INF = 1e9;
  for (let i = 0; i < w * h; i++) dist[i] = data[i] ? INF : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!dist[i]) continue;
    let v = dist[i];
    if (x > 0) v = Math.min(v, dist[i - 1] + 1);
    if (y > 0) v = Math.min(v, dist[i - w] + 1);
    if (x > 0 && y > 0) v = Math.min(v, dist[i - w - 1] + 1.414);
    if (x < w - 1 && y > 0) v = Math.min(v, dist[i - w + 1] + 1.414);
    dist[i] = x === 0 || y === 0 ? 1 : v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (!dist[i]) continue;
    let v = dist[i];
    if (x < w - 1) v = Math.min(v, dist[i + 1] + 1);
    if (y < h - 1) v = Math.min(v, dist[i + w] + 1);
    if (x < w - 1 && y < h - 1) v = Math.min(v, dist[i + w + 1] + 1.414);
    if (x > 0 && y < h - 1) v = Math.min(v, dist[i + w - 1] + 1.414);
    dist[i] = x === w - 1 || y === h - 1 ? 1 : v;
  }
  let sum = 0, n = 0, r = 0, g = 0, bl = 0;
  for (let i = 0; i < w * h; i++) {
    if (!data[i]) continue;
    sum += dist[i]; n++;
    r += s.image.data[i * 4]; g += s.image.data[i * 4 + 1]; bl += s.image.data[i * 4 + 2];
  }
  n = Math.max(1, n);
  return {
    heightPx: b.h,
    widthPx: b.w,
    bounds: b,
    // Mean distance-to-edge of a uniform stroke is a third of its width; fudge a bit.
    strokePx: Math.max(2, (sum / n) * 3.2),
    dist,
    paths: [],
    slant: 0,
    wobble: 0,
    colour: [r / n, g / n, bl / n],
  };
}
