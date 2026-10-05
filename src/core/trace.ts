import type { Box, Mask } from './image';
import { makeMask } from './image';
import { blurField, fillHoles, keepBig, maskBounds } from './mask';

// Bitmap letter -> smooth TrueType outline.
// The mask is softened and resampled to a fixed height, its pixel boundaries are traced,
// simplified (Ramer-Douglas-Peucker) and turned into quadratic curves: sharp corners stay
// on-curve, gentle bends become off-curve control points (TrueType's native curve type).

export interface Pt {
  x: number;
  y: number;
  on: boolean;
}
export type Contour = Pt[];

export interface GlyphOutline {
  contours: Contour[];
  advance: number;
  /** Mask bounds (in mask pixels) that map onto [lsb, lsb+inkWidth] x [bottom, top]. */
  source: Box;
  lsb: number;
  inkWidth: number;
  /** Font-unit vertical extent of the ink (0..CAP_HEIGHT for capitals; below 0 for descenders). */
  bottom: number;
  top: number;
}

export const UNITS_PER_EM = 1000;
export const CAP_HEIGHT = 700;
export const SIDE_BEARING = 60;
const TRACE_HEIGHT = 220;

type P = [number, number];

function traceBoundaries(m: Mask): P[][] {
  const W = m.width, H = m.height;
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H ? m.data[y * W + x] : 0);
  const VW = W + 1;
  // Each vertex has at most 2 outgoing edges. Edge stored as end-vertex index.
  const out = new Int32Array(VW * (H + 1) * 2).fill(-1);
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const s = (y0 * VW + x0) * 2;
    out[out[s] < 0 ? s : s + 1] = y1 * VW + x1;
  };
  let edges = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!m.data[y * W + x]) continue;
      if (!at(x, y - 1)) { add(x, y, x + 1, y); edges++; }
      if (!at(x + 1, y)) { add(x + 1, y, x + 1, y + 1); edges++; }
      if (!at(x, y + 1)) { add(x + 1, y + 1, x, y + 1); edges++; }
      if (!at(x - 1, y)) { add(x, y + 1, x, y); edges++; }
    }
  }
  const loops: P[][] = [];
  if (!edges) return loops;
  for (let v = 0; v < VW * (H + 1); v++) {
    while (out[v * 2] >= 0 || out[v * 2 + 1] >= 0) {
      const loop: P[] = [];
      let cur = v;
      let pdx = 0, pdy = 0;
      for (let guard = 0; guard <= edges; guard++) {
        const s = cur * 2;
        let slot = out[s] >= 0 ? s : s + 1;
        if (out[s] >= 0 && out[s + 1] >= 0) {
          // Saddle: turn right relative to the incoming direction (keeps diagonal pixels apart).
          const cx = cur % VW, cy = (cur / VW) | 0;
          const n0 = out[s];
          const dx0 = (n0 % VW) - cx, dy0 = ((n0 / VW) | 0) - cy;
          const cross = pdx * dy0 - pdy * dx0;
          slot = cross > 0 ? s : s + 1;
        }
        const next = out[slot];
        if (next < 0) break;
        out[slot] = -1;
        const cx = cur % VW, cy = (cur / VW) | 0;
        const nx = next % VW, ny = (next / VW) | 0;
        const dx = nx - cx, dy = ny - cy;
        if (dx !== pdx || dy !== pdy) loop.push([cx, cy]);
        pdx = dx; pdy = dy;
        cur = next;
        if (cur === v) break;
      }
      if (loop.length >= 3) loops.push(loop);
    }
  }
  return loops;
}

function rdp(pts: P[], eps: number): P[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function simplifyClosed(loop: P[], eps: number): P[] {
  // Split the loop at the point farthest from loop[0] and simplify both halves.
  let far = 0, farD = -1;
  for (let i = 1; i < loop.length; i++) {
    const d = (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2;
    if (d > farD) { farD = d; far = i; }
  }
  const a = rdp(loop.slice(0, far + 1), eps);
  const b = rdp([...loop.slice(far), loop[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function signedArea(p: P[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

function inside(pt: P, poly: P[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function depthOf(idx: number, polys: P[][]): number {
  const p = polys[idx];
  // Probe a few points just off the vertices and take the majority answer.
  let depth = 0;
  for (let j = 0; j < polys.length; j++) {
    if (j === idx) continue;
    let votes = 0, n = 0;
    for (let k = 0; k < p.length && n < 5; k += Math.max(1, Math.floor(p.length / 5))) {
      const a = p[k], b = p[(k + 1) % p.length];
      votes += inside([(a[0] + b[0]) / 2 + 0.013, (a[1] + b[1]) / 2 + 0.017], polys[j]) ? 1 : 0;
      n++;
    }
    if (votes * 2 > n) depth++;
  }
  return depth;
}

/** Polygon -> TrueType quadratic contour. Sharp corners stay on-curve. */
function toQuadratic(p: P[], cornerDeg: number): Pt[] {
  const n = p.length;
  const out: Pt[] = [];
  const cosLimit = Math.cos((cornerDeg * Math.PI) / 180);
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
    const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
    const lu = Math.hypot(ux, uy) || 1, lv = Math.hypot(vx, vy) || 1;
    out.push({ x: b[0], y: b[1], on: (ux * vx + uy * vy) / (lu * lv) < cosLimit });
    // Long straight runs: pin both ends on-curve so the line stays straight.
    if (lv > 120) {
      const t = 36 / lv;
      out.push({ x: b[0] + vx * t, y: b[1] + vy * t, on: true });
      out.push({ x: c[0] - vx * t, y: c[1] - vy * t, on: true });
    }
  }
  return out;
}

/** Soften and resample a letter mask so its height is `targetH` pixels. */
function normaliseMask(m: Mask, b: Box, targetH: number): { mask: Mask; scale: number; margin: number } {
  const margin = 4;
  const scale = targetH / b.h;
  const w = Math.max(1, Math.round(b.w * scale)) + margin * 2;
  const h = targetH + margin * 2;
  // Soft field from the source crop.
  const pad = Math.ceil(2 / scale) + 2;
  const fw = b.w + pad * 2, fh = b.h + pad * 2;
  const field = new Float32Array(fw * fh);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) field[(y + pad) * fw + x + pad] = m.data[(y + b.y) * m.width + x + b.x] ? 1 : 0;
  const soft = blurField(field, fw, fh, Math.max(1, Math.round(b.h * 0.008)), 2);
  const out = makeMask(w, h);
  for (let y = 0; y < h; y++) {
    const sy = (y - margin + 0.5) / scale - 0.5 + pad;
    const y0 = Math.floor(sy), ty = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = (x - margin + 0.5) / scale - 0.5 + pad;
      const x0 = Math.floor(sx), tx = sx - x0;
      const g = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= fw || yy >= fh ? 0 : soft[yy * fw + xx]);
      const v = (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty;
      out.data[y * w + x] = v >= 0.5 ? 1 : 0;
    }
  }
  return { mask: out, scale, margin };
}

/**
 * Trace a letter mask into a glyph. The ink's bounds are scaled (keeping its aspect ratio) so
 * they span `range` vertically, in font units: [0, CAP_HEIGHT] for a capital, [-210, 490] for a
 * lowercase p, and so on (see verticalRange in core/alphabet/skeletons.ts).
 */
export function maskToGlyph(mask: Mask, range: [number, number] = [0, CAP_HEIGHT]): GlyphOutline | null {
  const [bottom, top] = range;
  const b = maskBounds(mask);
  if (!b || b.h < 4 || b.w < 2) return null;
  const { mask: norm, margin } = normaliseMask(mask, b, TRACE_HEIGHT);
  let clean = keepBig(norm, 0.02, 12);
  clean = fillHoles(clean, 25);
  const nb = maskBounds(clean);
  if (!nb) return null;

  const loops = traceBoundaries(clean)
    .map((l) => simplifyClosed(l, 0.9))
    .filter((l) => l.length >= 3 && Math.abs(signedArea(l)) > 16);

  const k = (top - bottom) / TRACE_HEIGHT;
  const baseY = margin + TRACE_HEIGHT; // mask row that sits at `bottom`
  const left = nb.x;
  const inkWidth = Math.round(nb.w * k);
  const contours: Contour[] = loops.map((loop, i) => {
    // Pixel coords -> font units (y up).
    let poly: P[] = loop.map(([x, y]) => [(x - left) * k + SIDE_BEARING, bottom + (baseY - y) * k]);
    const depth = depthOf(i, loops);
    const area = signedArea(poly);
    // TrueType: outer contours clockwise (negative area with y up), holes counter-clockwise.
    if ((depth % 2 === 0 && area > 0) || (depth % 2 === 1 && area < 0)) poly = poly.reverse();
    const q = toQuadratic(poly, 50).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), on: p.on }));
    return q.filter((p, j) => j === 0 || p.x !== q[j - 1].x || p.y !== q[j - 1].y || p.on !== q[j - 1].on);
  });

  return {
    contours: contours.filter((c) => c.length >= 3),
    advance: inkWidth + SIDE_BEARING * 2,
    source: b,
    lsb: SIDE_BEARING,
    inkWidth,
    bottom,
    top,
  };
}

/** SVG path data in font units (y up). Handles implied on-curve points between off-curve ones. */
export function contoursToSvg(contours: Contour[], dx = 0): string {
  let d = '';
  for (const c of contours) {
    if (!c.length) continue;
    const n = c.length;
    // Find a starting on-curve point (or synthesise one).
    let start = c.findIndex((p) => p.on);
    let first: { x: number; y: number };
    if (start < 0) {
      first = { x: (c[0].x + c[n - 1].x) / 2, y: (c[0].y + c[n - 1].y) / 2 };
      start = 0;
      d += `M${first.x + dx} ${first.y}`;
      for (let i = 0; i < n; i++) {
        const p = c[i], q = c[(i + 1) % n];
        const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
        d += `Q${p.x + dx} ${p.y} ${mx + dx} ${my}`;
      }
      d += 'Z';
      continue;
    }
    first = c[start];
    d += `M${first.x + dx} ${first.y}`;
    let ctrl: Pt | null = null;
    for (let k = 1; k <= n; k++) {
      const p = c[(start + k) % n];
      if (p.on) {
        d += ctrl ? `Q${ctrl.x + dx} ${ctrl.y} ${p.x + dx} ${p.y}` : `L${p.x + dx} ${p.y}`;
        ctrl = null;
      } else {
        if (ctrl) {
          const mx = (ctrl.x + p.x) / 2, my = (ctrl.y + p.y) / 2;
          d += `Q${ctrl.x + dx} ${ctrl.y} ${mx + dx} ${my}`;
        }
        ctrl = p;
      }
    }
    d += 'Z';
  }
  return d;
}

/** Parse the subset of SVG path data produced by contoursToSvg back into contours. */
export function svgToContours(d: string): Contour[] {
  const contours: Contour[] = [];
  let cur: Contour = [];
  const re = /([MLQZ])([^MLQZ]*)/g;
  let mt: RegExpExecArray | null;
  while ((mt = re.exec(d))) {
    const nums = mt[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    switch (mt[1]) {
      case 'M':
        cur = [{ x: nums[0], y: nums[1], on: true }];
        break;
      case 'L':
        cur.push({ x: nums[0], y: nums[1], on: true });
        break;
      case 'Q':
        cur.push({ x: nums[0], y: nums[1], on: false }, { x: nums[2], y: nums[3], on: true });
        break;
      case 'Z':
        if (cur.length > 1 && cur[cur.length - 1].on && cur[cur.length - 1].x === cur[0].x && cur[cur.length - 1].y === cur[0].y) cur.pop();
        if (cur.length >= 3) contours.push(cur.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), on: p.on })));
        cur = [];
        break;
    }
  }
  return contours;
}
