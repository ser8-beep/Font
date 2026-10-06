import type { RGBAImage } from '../../image';
import { medialAxis, type AxisPath } from '../measure';
import type { Measure, P2, StyleSample } from '../types';

// Letters built from a few whole objects or continuous lengths of stuff: markers, pencils, books,
// wafers, pipes, carabiners, chains, straws, rope, clay sausages, wool, honey.
//
// Extraction cuts the captured letter into PARTS along its medial axis (split at junctions and
// sharp corners): each part is roughly one physical object, straightened into a strip of photo
// pixels - ends included, so a pencil keeps its tip and a marker its cap. Big round things (a
// tape roll, a biscuit, a can, a turbo, an orange) are cut out whole as ROUND parts.
//
// Rendering splits the new letter's strokes the same way and gives every stroke a part: straight
// strokes get a stick placed rigidly along them, curves get a part swept along the curve, bowls and
// loops get a round part when the photo has one (borrowed from another captured letter if needed).
// Parts overlap where strokes meet, like objects laid on top of each other.

interface StripPart {
  straight: boolean;
  /** Straightened strip: columns run along the part, rows across it (straight RGBA). */
  img: RGBAImage;
  /** Columns where the medial-axis path starts and ends (the rest is the object's real ends). */
  core: [number, number];
  /** Row of the centreline. */
  mid: number;
  /** Signed total turn of the part (radians); sign says which way it bends. */
  bend: number;
  /** Core length / source letter height. */
  lengthRel: number;
  /** Source letter height, px (to convert pixels to rel units). */
  heightPx: number;
}

interface RoundPart {
  /** Square cut-out centred on the object (straight RGBA, transparent outside it). */
  img: RGBAImage;
  /** Visible radius of the object, px in img. */
  radius: number;
  /** A ring with a hole (tape roll) rather than a solid disc (biscuit). */
  ring: boolean;
}

export interface StrokesMaterial {
  kind: 'strokes';
  strips: StripPart[];
  rounds: RoundPart[];
  colour: [number, number, number];
}

const SHARP = (45 * Math.PI) / 180;

// ---------- extraction ----------

export function extractStrokes(sample: StyleSample, m: Measure): StrokesMaterial | null {
  if (!m.heightPx || !m.paths.length) return null;
  const axis = medialAxis(sample.mask, m.dist, m.bounds);
  if (!axis.length) return null;
  const H = m.heightPx;
  const r0 = Math.max(1.5, m.strokePx / 2);

  // Round parts: big round blobs (a biscuit, a turbo, an orange) and round junction-free loops (a
  // tape roll, a ring). Crossings of two sticks also make big inscribed circles, so a blob must
  // really be round: most rays from its centre leave the ink at about the same distance.
  const rounds: RoundPart[] = [];
  const discs: { x: number; y: number; r: number }[] = [];
  for (const p of axis) {
    if (p.closed && p.points.length > 8) {
      const cx = mean(p.points.map((q) => q[0])), cy = mean(p.points.map((q) => q[1]));
      const ds = p.points.map((q) => Math.hypot(q[0] - cx, q[1] - cy));
      const outer = mean(ds) + median(p.radius);
      if (Math.max(...ds) / Math.max(1, Math.min(...ds)) < 1.45 && outer > H * 0.12) {
        rounds.push({ img: cutRound(sample, cx, cy, outer * 1.08), radius: outer, ring: true });
        discs.push({ x: cx, y: cy, r: outer });
      }
      continue;
    }
    // Candidates: places where the path is locally fattest (a biscuit on the end of a wafer).
    const cand: number[] = [];
    for (let i = 0; i < p.points.length; i++) {
      if (p.radius[i] < H * 0.1) continue;
      let peak = true;
      for (let j = Math.max(0, i - 6); j <= Math.min(p.points.length - 1, i + 6) && peak; j++) if (p.radius[j] > p.radius[i]) peak = false;
      if (peak) cand.push(i);
    }
    cand.sort((a, b) => p.radius[b] - p.radius[a]);
    for (const i of cand.slice(0, 4)) {
      const [x, y] = p.points[i], r = p.radius[i];
      if (discs.some((d) => Math.hypot(d.x - x, d.y - y) < Math.max(d.r, r))) continue;
      const vis = roundness(sample, x, y, r);
      if (!vis) continue;
      discs.push({ x, y, r: vis });
      rounds.push({ img: cutRound(sample, x, y, vis * 1.06), radius: vis, ring: false });
    }
  }

  // Stick / curve parts: paths minus the round parts, split at sharp corners.
  const runs: Run[] = [];
  for (const p of axis) {
    if (p.closed) {
      const cx = mean(p.points.map((q) => q[0])), cy = mean(p.points.map((q) => q[1]));
      if (discs.some((d) => Math.hypot(d.x - cx, d.y - cy) < d.r * 0.5)) continue; // became a ring
    }
    for (const run of outsideDiscs(p, discs)) runs.push(...splitAtCorners(run));
  }
  const owner = ownership(sample, runs, discs);
  const strips: StripPart[] = [];
  runs.forEach((run, id) => {
    const strip = cutStrip(sample, run, H, r0, owner, id);
    if (strip) strips.push(strip);
  });
  if (!strips.length && !rounds.length) return null;
  return { kind: 'strokes', strips, rounds, colour: m.colour };
}

/**
 * Is the blob around (x, y) round? Cast 24 rays and measure where each leaves the ink. Rays that
 * run off along an attached stick are ignored; the rest must agree. Returns the visible radius,
 * or 0 when the blob is not round (a crossing of two sticks, a block, a cup).
 */
function roundness(s: StyleSample, x: number, y: number, r: number): number {
  const m = s.mask;
  const at = (px: number, py: number) => {
    const ix = Math.floor(px), iy = Math.floor(py);
    return ix >= 0 && iy >= 0 && ix < m.width && iy < m.height && m.data[iy * m.width + ix] === 1;
  };
  const hits: number[] = [];
  let long = 0;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
    let d = r * 0.8;
    while (d < r * 2.2 && at(x + dx * d, y + dy * d)) d += 0.5;
    if (d >= r * 1.5) long++;
    else hits.push(d);
  }
  if (long > 7 || hits.length < 15) return 0;
  const mu = mean(hits);
  const sd = Math.sqrt(mean(hits.map((h) => (h - mu) ** 2)));
  return sd / mu < 0.09 ? mu : 0;
}

/** Give every ink pixel to the nearest part (multi-source flood fill), so a strip holds one object. */
function ownership(s: StyleSample, runs: Run[], discs: { x: number; y: number; r: number }[]): Int32Array {
  const { width: w, height: h, data } = s.mask;
  const owner = new Int32Array(w * h).fill(-1);
  const queue = new Int32Array(w * h);
  let qh = 0, qt = 0;
  const seed = (x: number, y: number, id: number) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) return;
    const i = iy * w + ix;
    if (!data[i] || owner[i] !== -1) return;
    owner[i] = id;
    queue[qt++] = i;
  };
  // Round parts own their whole disc (they are drawn whole elsewhere).
  discs.forEach((d, k) => {
    const id = runs.length + k;
    for (let y = Math.floor(d.y - d.r); y <= Math.ceil(d.y + d.r); y++) for (let x = Math.floor(d.x - d.r); x <= Math.ceil(d.x + d.r); x++) if (Math.hypot(x + 0.5 - d.x, y + 0.5 - d.y) <= d.r * 1.05) seed(x, y, id);
  });
  runs.forEach((r, id) => r.points.forEach(([x, y]) => seed(x, y, id)));
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % w, y = (i / w) | 0;
    if (x > 0) seed(x - 1, y, owner[i]);
    if (x < w - 1) seed(x + 1, y, owner[i]);
    if (y > 0) seed(x, y - 1, owner[i]);
    if (y < h - 1) seed(x, y + 1, owner[i]);
  }
  return owner;
}

interface Run {
  points: P2[];
  radius: number[];
  /** Is each end a free stroke end (true) or a joint / cut (false)? */
  freeStart: boolean;
  freeEnd: boolean;
}

function outsideDiscs(p: AxisPath, discs: { x: number; y: number; r: number }[]): Run[] {
  const runs: Run[] = [];
  let cur: Run | null = null;
  p.points.forEach((q, i) => {
    const inside = discs.some((d) => Math.hypot(q[0] - d.x, q[1] - d.y) < d.r);
    if (inside) {
      if (cur) { cur.freeEnd = false; runs.push(cur); cur = null; }
      return;
    }
    if (!cur) cur = { points: [], radius: [], freeStart: i === 0 ? !p.startJunction && !p.closed : false, freeEnd: false };
    cur.points.push(q);
    cur.radius.push(p.radius[i]);
  });
  if (cur) {
    (cur as Run).freeEnd = !p.endJunction && !p.closed;
    runs.push(cur);
  }
  return runs.filter((r) => r.points.length >= 3);
}

function splitAtCorners(run: Run): Run[] {
  const pts = run.points;
  const n = pts.length;
  const k = Math.max(3, Math.round(median(run.radius) / 1.5));
  const turn = new Float32Array(n);
  for (let i = k; i < n - k; i++) {
    const a = pts[i - k], b = pts[i], c = pts[i + k];
    turn[i] = Math.abs(angleBetween([b[0] - a[0], b[1] - a[1]], [c[0] - b[0], c[1] - b[1]]));
  }
  const cuts: number[] = [];
  for (let i = k; i < n - k; i++) {
    if (turn[i] < SHARP) continue;
    let isMax = true;
    for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++) if (turn[j] > turn[i]) isMax = false;
    if (isMax && (!cuts.length || i - cuts[cuts.length - 1] > k)) cuts.push(i);
  }
  if (!cuts.length) return [run];
  const out: Run[] = [];
  let s = 0;
  for (const c of [...cuts, n - 1]) {
    out.push({ points: pts.slice(s, c + 1), radius: run.radius.slice(s, c + 1), freeStart: s === 0 ? run.freeStart : false, freeEnd: c === n - 1 ? run.freeEnd : false });
    s = c;
  }
  return out.filter((r) => r.points.length >= 3);
}

/** Straighten one part of the letter into a strip of photo pixels (only pixels this part owns). */
function cutStrip(s: StyleSample, run: Run, H: number, r0: number, owner: Int32Array, id: number): StripPart | null {
  let pts = smooth(run.points, 3);
  let len = arcLength(pts);
  const r = Math.max(1.5, median(run.radius));
  if (len < Math.max(4, r * 1.2)) return null;
  const owns = (x: number, y: number) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= s.mask.width || iy >= s.mask.height) return false;
    const o = owner[iy * s.mask.width + ix];
    return s.mask.data[iy * s.mask.width + ix] === 1 && (o === id || o === -1);
  };

  // A part that is straight along its middle is a rigid object (pencil, wafer, book): the medial
  // axis bends into its corners near the ends, so follow the middle's direction instead, out to
  // where the object really ends.
  const n = pts.length;
  const mid = pts.slice(Math.floor(n * 0.2), Math.ceil(n * 0.8));
  const midLen = arcLength(mid);
  const midStraight = mid.length >= 3 && Math.abs(totalTurn(smooth(mid, 2))) < (25 * Math.PI) / 180 && maxDeviation(mid) < Math.max(1.5, midLen * 0.08);
  let straight = false;
  let extStart = Math.round(r * (run.freeStart ? 1.25 : 1.0) + 2);
  let extEnd = Math.round(r * (run.freeEnd ? 1.25 : 1.0) + 2);
  let bend = totalTurn(pts);
  if (midStraight) {
    const cx = mean(mid.map((q) => q[0])), cy = mean(mid.map((q) => q[1]));
    // Principal direction of the middle points.
    let sxx = 0, sxy = 0, syy = 0;
    for (const [x, y] of mid) { sxx += (x - cx) ** 2; sxy += (x - cx) * (y - cy); syy += (y - cy) ** 2; }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    let ux = Math.cos(ang), uy = Math.sin(ang);
    if ((pts[n - 1][0] - pts[0][0]) * ux + (pts[n - 1][1] - pts[0][1]) * uy < 0) { ux = -ux; uy = -uy; }
    const proj = (q: P2) => (q[0] - cx) * ux + (q[1] - cy) * uy;
    const t0 = proj(pts[0]), t1 = proj(pts[n - 1]);
    // March out along the axis (checking a few lines across it) to the object's real ends.
    const reachEnd = (dir: number, from: number) => {
      let t = from, gap = 0;
      for (let steps = 0; steps < H * 2; steps++) {
        t += dir;
        let hit = false;
        for (const v of [-r * 0.5, 0, r * 0.5]) if (owns(cx + ux * t - uy * v, cy + uy * t + ux * v)) hit = true;
        if (hit) gap = 0;
        else if (++gap > 2) return t - dir * gap;
      }
      return t;
    };
    const e0 = reachEnd(-1, t0), e1 = reachEnd(1, t1);
    pts = [[cx + ux * t0, cy + uy * t0], [cx + ux * t1, cy + uy * t1]];
    len = Math.max(1, t1 - t0);
    extStart = Math.max(1, Math.round(t0 - e0) + 1);
    extEnd = Math.max(1, Math.round(e1 - t1) + 1);
    straight = true;
    bend = 0;
  } else {
    const chord = Math.hypot(pts[n - 1][0] - pts[0][0], pts[n - 1][1] - pts[0][1]);
    straight = Math.abs(bend) < (35 * Math.PI) / 180 && maxDeviation(pts) < Math.max(2, len * 0.08) && chord > len * 0.9;
    if (straight) pts = [pts[0], pts[n - 1]];
  }

  // A short, fat "curve" is the joint between wide objects (the corner where two wafers meet),
  // not a bendy object: real bendy parts (clay, wool, cable) are long for their width.
  if (!straight && len / (2 * r) < 2.5) return null;
  const half = Math.ceil(Math.max(Math.max(...run.radius) * 1.15, r0 * 1.3) + 3);
  const cols = Math.round(len) + extStart + extEnd;
  const rows = half * 2 + 1;
  const img: RGBAImage = { width: cols, height: rows, data: new Uint8ClampedArray(cols * rows * 4) };
  const walk = walker(pts);
  let coreInk = 0;
  for (let c = 0; c < cols; c++) {
    const [px, py, tx, ty] = walk(c - extStart);
    const nx = -ty, ny = tx;
    for (let rr = 0; rr < rows; rr++) {
      const v = rr - half;
      const x = px + nx * v, y = py + ny * v;
      if (!owns(x, y) && !owns(x + 0.5, y) && !owns(x, y + 0.5)) continue;
      const a = bilinearMask(s, x, y);
      if (a <= 0.02) continue;
      const [cr, cg, cb] = bilinearRGB(s, x, y);
      const o = (rr * cols + c) * 4;
      img.data[o] = cr; img.data[o + 1] = cg; img.data[o + 2] = cb; img.data[o + 3] = a * 255;
      if (c >= extStart && c < cols - extEnd && Math.abs(v) <= r) coreInk++;
    }
  }
  // Scraps (a sliver between two joints, mostly someone else's pixels) are not worth reusing.
  if (len / H < 0.06 || coreInk < Math.round(len) * Math.min(2 * r, rows) * 0.45) return null;
  return { straight, img, core: [extStart, extStart + Math.round(len)], mid: half, bend, lengthRel: len / H, heightPx: H };
}

function cutRound(s: StyleSample, cx: number, cy: number, R: number): RGBAImage {
  const size = Math.ceil(R * 2) + 2;
  const img: RGBAImage = { width: size, height: size, data: new Uint8ClampedArray(size * size * 4) };
  const o0 = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = cx + x + 0.5 - o0, sy = cy + y + 0.5 - o0;
      const d = Math.hypot(sx - cx, sy - cy);
      const edge = Math.min(1, Math.max(0, R - d + 0.5));
      if (edge <= 0) continue;
      const a = bilinearMask(s, sx, sy) * edge;
      if (a <= 0.02) continue;
      const [r, g, b] = bilinearRGB(s, sx, sy);
      const o = (y * size + x) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = a * 255;
    }
  }
  return img;
}

/** The kid bent this part into a real curve (a clay bowl, a wool loop), so the stuff is bendy. */
const bentPart = (p: StripPart) => !p.straight && Math.abs(p.bend) > 1.0 && p.lengthRel > 0.35;

/** Made of bendy stuff (clay, wool, cable, peel) rather than rigid objects. */
export const isBendy = (mat: StrokesMaterial) => mat.strips.some(bentPart);

/** Each stick or curve part: mean colour, length (rel units) and length / width. */
export function partStats(mat: StrokesMaterial): { colour: [number, number, number]; lengthRel: number; widthPx: number; aspect: number }[] {
  const out: { colour: [number, number, number]; lengthRel: number; widthPx: number; aspect: number }[] = [];
  for (const p of mat.strips) {
    const d = p.img.data;
    let r = 0, g = 0, b = 0, a = 0;
    for (let i = 0; i < d.length; i += 16) {
      const w = d[i + 3];
      r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; a += w;
    }
    if (a > 0) out.push({ colour: [r / a, g / a, b / a], lengthRel: p.lengthRel, widthPx: p.img.height, aspect: p.img.width / Math.max(1, p.img.height) });
  }
  return out;
}

function bilinearMask(s: StyleSample, x: number, y: number): number {
  const m = s.mask;
  const x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5);
  const tx = x - 0.5 - x0, ty = y - 0.5 - y0;
  const at = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= m.width || yy >= m.height ? 0 : m.data[yy * m.width + xx] ? 1 : 0);
  return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
}

function bilinearRGB(s: StyleSample, x: number, y: number): [number, number, number] {
  const im = s.image;
  const x0 = Math.max(0, Math.min(im.width - 2, Math.floor(x - 0.5))), y0 = Math.max(0, Math.min(im.height - 2, Math.floor(y - 0.5)));
  const tx = Math.min(1, Math.max(0, x - 0.5 - x0)), ty = Math.min(1, Math.max(0, y - 0.5 - y0));
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const g = (xx: number, yy: number) => im.data[(yy * im.width + xx) * 4 + c];
    out[c] = (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty;
  }
  return out;
}

/** Position and unit tangent at arc length s along a polyline (straight on past the ends). */
function walker(pts: P2[]): (s: number) => [number, number, number, number] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  const tangent = (k: number) => {
    // Average direction over a few segments for a steadier normal.
    const a = pts[Math.max(0, k - 2)], b = pts[Math.min(pts.length - 1, k + 3)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    return [dx / L, dy / L];
  };
  return (s: number) => {
    if (s <= 0 || pts.length === 2) {
      const [tx, ty] = pts.length === 2 ? unit(pts[0], pts[1]) : tangent(0);
      if (s <= 0) return [pts[0][0] + tx * s, pts[0][1] + ty * s, tx, ty];
    }
    if (s >= total) {
      const [tx, ty] = pts.length === 2 ? unit(pts[0], pts[1]) : tangent(pts.length - 2);
      const e = pts[pts.length - 1];
      return [e[0] + tx * (s - total), e[1] + ty * (s - total), tx, ty];
    }
    let k = 0;
    while (k < cum.length - 2 && cum[k + 1] < s) k++;
    const L = cum[k + 1] - cum[k] || 1;
    const t = (s - cum[k]) / L;
    const [tx, ty] = pts.length === 2 ? unit(pts[0], pts[1]) : tangent(k);
    return [pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t, tx, ty];
  };
}

function unit(a: P2, b: P2): [number, number] {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  return [dx / L, dy / L];
}

function smooth(pts: P2[], k: number): P2[] {
  if (pts.length <= 2 * k + 1) return pts;
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p;
    let sx = 0, sy = 0, n = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(pts.length - 1, i + k); j++) { sx += pts[j][0]; sy += pts[j][1]; n++; }
    return [sx / n, sy / n] as P2;
  });
}

function arcLength(pts: P2[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

function angleBetween(u: [number, number], v: [number, number]): number {
  return Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]);
}

function totalTurn(pts: P2[]): number {
  let t = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    t += angleBetween([b[0] - a[0], b[1] - a[1]], [c[0] - b[0], c[1] - b[1]]);
  }
  return t;
}

function maxDeviation(pts: P2[]): number {
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  let m = 0;
  for (const p of pts) m = Math.max(m, Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L);
  return m;
}

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
}
