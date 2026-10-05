import type { P2, Skeleton } from './types';

// Rasterises a skeleton into a "stroke field": for every pixel, where is the nearest stroke
// centreline, how far along that stroke, and how far to the side. Material renderers paint from
// this (lay bricks on it, scatter beans inside it, sweep clay texture along it).

export interface FieldStroke {
  /** Centreline points in px (x right, y down). */
  pts: P2[];
  /** Arc length (px) at each point. */
  cum: number[];
  /** Total length, px (0 for a dot). */
  length: number;
}

export interface StrokeField {
  width: number;
  height: number;
  pxPerUnit: number;
  /** Pixel position of skeleton unit (0, 0): x of the origin, y of the baseline. */
  originX: number;
  baselineY: number;
  /** Half the stroke thickness, px. */
  halfWidth: number;
  strokes: FieldStroke[];
  /** Distance (px) to the nearest centreline; Infinity where no stroke is within reach. */
  dist: Float32Array;
  /** Index of the nearest stroke, -1 if none. */
  stroke: Int16Array;
  /**
   * Arc length (px) of the nearest point along that stroke. Past the two ends of an open stroke
   * it keeps counting (negative before the start, beyond `length` after the end).
   */
  along: Float32Array;
  /** Signed sideways offset (px) from the nearest stroke: sign tells the two sides apart. */
  across: Float32Array;
  /** Direction (radians, image coordinates) of the nearest stroke segment. */
  dir: Float32Array;
  /** Distance and index of the nearest *different* stroke, for blending where strokes meet. */
  dist2: Float32Array;
  stroke2: Int16Array;
  /** Anti-aliased coverage (0..1) of the plain thick-stroke letter shape. */
  coverage: Float32Array;
}

export interface FieldOptions {
  pxPerUnit: number;
  /** Half stroke thickness, px. */
  halfWidth: number;
  /** Extra space around the thick shape, px (room for beans that stick out). */
  margin?: number;
}

export function unitToPx(f: Pick<StrokeField, 'originX' | 'baselineY' | 'pxPerUnit'>, p: P2): P2 {
  return [f.originX + p[0] * f.pxPerUnit, f.baselineY - p[1] * f.pxPerUnit];
}

export function buildField(sk: Skeleton, opts: FieldOptions): StrokeField {
  const { pxPerUnit, halfWidth } = opts;
  const margin = opts.margin ?? Math.ceil(halfWidth * 0.6 + 6);
  const all = sk.strokes.flatMap((s) => s.points);
  if (!all.length) throw new Error('empty skeleton');
  const minX = Math.min(...all.map((p) => p[0])), maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1])), maxY = Math.max(...all.map((p) => p[1]));
  const pad = halfWidth + margin;
  const width = Math.ceil((maxX - minX) * pxPerUnit + 2 * pad);
  const height = Math.ceil((maxY - minY) * pxPerUnit + 2 * pad);
  const originX = pad - minX * pxPerUnit;
  const baselineY = pad + maxY * pxPerUnit;

  const n = width * height;
  const dist = new Float32Array(n).fill(Infinity);
  const dist2 = new Float32Array(n).fill(Infinity);
  const stroke = new Int16Array(n).fill(-1);
  const stroke2 = new Int16Array(n).fill(-1);
  const along = new Float32Array(n);
  const across = new Float32Array(n);
  const dir = new Float32Array(n);

  const strokes: FieldStroke[] = sk.strokes.map((s) => {
    const pts = s.points.map((p) => unitToPx({ originX, baselineY, pxPerUnit }, p));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, cum, length: cum[cum.length - 1] };
  });

  const reach = pad;
  strokes.forEach((st, si) => {
    const pts = st.pts;
    const closed = pts.length > 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
    // Per-stroke nearest point, over this stroke's bounding box.
    const bx0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0])) - reach));
    const by0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1])) - reach));
    const bx1 = Math.min(width - 1, Math.ceil(Math.max(...pts.map((p) => p[0])) + reach));
    const by1 = Math.min(height - 1, Math.ceil(Math.max(...pts.map((p) => p[1])) + reach));
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
    const dS = new Float32Array(bw * bh).fill(Infinity);
    const aS = new Float32Array(bw * bh);
    const cS = new Float32Array(bw * bh);
    const rS = new Float32Array(bw * bh);
    const segs = Math.max(1, pts.length - 1);
    for (let k = 0; k < segs; k++) {
      const a = pts[k], b = pts[Math.min(k + 1, pts.length - 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      const ux = len ? dx / len : 1, uy = len ? dy / len : 0;
      const ang = Math.atan2(uy, ux);
      const sx0 = Math.max(bx0, Math.floor(Math.min(a[0], b[0]) - reach));
      const sy0 = Math.max(by0, Math.floor(Math.min(a[1], b[1]) - reach));
      const sx1 = Math.min(bx1, Math.ceil(Math.max(a[0], b[0]) + reach));
      const sy1 = Math.min(by1, Math.ceil(Math.max(a[1], b[1]) + reach));
      const first = k === 0 && !closed, last = k === segs - 1 && !closed;
      for (let y = sy0; y <= sy1; y++) {
        const py = y + 0.5;
        for (let x = sx0; x <= sx1; x++) {
          const px = x + 0.5;
          const rx = px - a[0], ry = py - a[1];
          const tRaw = len ? (rx * ux + ry * uy) / len : 0;
          const t = Math.min(1, Math.max(0, tRaw));
          const qx = a[0] + dx * t, qy = a[1] + dy * t;
          const d = Math.hypot(px - qx, py - qy);
          const j = (y - by0) * bw + (x - bx0);
          if (d >= dS[j]) continue;
          dS[j] = d;
          const cross = ux * (py - qy) - uy * (px - qx);
          cS[j] = t > 0 && t < 1 ? cross : (cross >= 0 ? 1 : -1) * d;
          const tAlong = (first && tRaw < 0) || (last && tRaw > 1) ? tRaw : t;
          aS[j] = st.cum[k] + tAlong * len;
          rS[j] = ang;
        }
      }
    }
    // Merge into the global field, keeping the runner-up stroke.
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        const j = (y - by0) * bw + (x - bx0);
        const d = dS[j];
        if (d === Infinity) continue;
        const i = y * width + x;
        if (d < dist[i]) {
          dist2[i] = dist[i];
          stroke2[i] = stroke[i];
          dist[i] = d;
          stroke[i] = si;
          along[i] = aS[j];
          across[i] = cS[j];
          dir[i] = rS[j];
        } else if (d < dist2[i]) {
          dist2[i] = d;
          stroke2[i] = si;
        }
      }
    }
  });

  const coverage = new Float32Array(n);
  for (let i = 0; i < n; i++) coverage[i] = Math.min(1, Math.max(0, halfWidth - dist[i] + 0.5));

  return { width, height, pxPerUnit, originX, baselineY, halfWidth, strokes, dist, stroke, along, across, dir, dist2, stroke2, coverage };
}
