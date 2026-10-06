import type { Box, Mask } from '../image';
import { buildField } from './field';
import { skeletonFor } from './skeletons';
import { DEFAULT_GEOMETRY, type GeometryParams, type Measure, type P2, type Skeleton, type StyleSample } from './types';

// Fit the shared letter geometry (width, slant, bowl / bar / fork heights, roundness) to the
// captured letters. Each captured letter the skeletons can draw is compared with its skeleton
// rendered at the measured stroke weight: both are cropped to their ink, scaled to the same height
// (so size and position do not matter but width / height does), centred on each other and scored
// 1 - IoU. A pattern search minimises the summed scores plus a pull toward the defaults, so a badly
// cleaned or oddly built letter cannot drag the whole alphabet to an extreme. Only parameters that
// change at least one captured letter's skeleton are fitted; the others keep their defaults.
//
// Roundness also gets evidence the skeletons cannot give: the free stroke ends of blocky things
// (bricks, books, boxes) are square, those of clay or straws are round. That sets the value round
// is pulled toward, and its value when no captured letter has a bowl or a curve.

/** Height (px) letters are compared at. */
export const FIT_H = 64;
/** Most letter renders one fit may spend (keeps it fast and deterministic). */
const MAX_RENDERS = 400;
/** Strength of the pull toward the prior, per captured letter the parameter shapes. */
const PULL = 0.03;
/** Weight of the bowl-corner score (see scoreOf) next to the whole-letter score. */
const FOCUS = 0.25;
/** Letters thinner than this are fattened before comparing (see tolerance). */
const MIN_WEIGHT = 0.14;

type Key = keyof GeometryParams;
interface Spec { key: Key; lo: number; hi: number; step: number; min: number; scale: number }
const SPECS: Spec[] = [
  { key: 'width', lo: 0.7, hi: 1.5, step: 0.08, min: 0.01, scale: 0.3 },
  { key: 'slant', lo: -0.3, hi: 0.3, step: 0.06, min: 0.01, scale: 0.12 },
  { key: 'bowl', lo: -0.15, hi: 0.15, step: 0.05, min: 0.01, scale: 0.07 },
  { key: 'bar', lo: -0.15, hi: 0.15, step: 0.05, min: 0.01, scale: 0.07 },
  { key: 'fork', lo: -0.15, hi: 0.15, step: 0.05, min: 0.01, scale: 0.07 },
  { key: 'round', lo: 0, hi: 1, step: 0.25, min: 0.04, scale: 1 },
];

/** A greyscale picture: coverage 0..1, row-major. */
export interface Coverage {
  w: number;
  h: number;
  data: Float32Array;
}

/** A captured letter ready to compare: its mask FIT_H tall, grown by `grow`, on a wide canvas. */
export interface FitTarget {
  canvas: Coverage;
  /** Left edge and width (canvas px) of the letter's ink before growing. Rows: [grow, grow + FIT_H). */
  x: number;
  w: number;
  grow: number;
  /** Stroke thickness / letter height. */
  weight: number;
}

export function fitGeometry(samples: StyleSample[], measures: Measure[]): GeometryParams {
  const prior: GeometryParams = { ...DEFAULT_GEOMETRY, round: roundFromEnds(samples, measures) };

  // Letters we can compare: a skeleton exists and the mask is not empty.
  const letters = samples.flatMap((s, i) => {
    const m = measures[i];
    if (!m || m.heightPx < 8 || m.widthPx < 2 || !skeletonFor(s.char, DEFAULT_GEOMETRY)) return [];
    const target = prepareTarget(s.mask, m.bounds, strokeWeight(m));
    const deps = SPECS.filter((sp) => dependsOn(s.char, sp)).map((sp) => sp.key);
    return [{ char: s.char, target, aspect: m.bounds.w / m.bounds.h, deps, memo: new Map<string, number>(), regions: new Map<string, Int32Array>() }];
  });
  const specs = SPECS.filter((sp) => letters.some((l) => l.deps.includes(sp.key)));
  if (!letters.length || !specs.length) return prior;

  type Letter = (typeof letters)[number];
  let renders = 0;
  // Where square and round versions of the letter differ (the corners of its bowls), for the
  // letter's other parameters as in g.
  const cornersOf = (l: Letter, g: GeometryParams): Int32Array => {
    const key = l.deps.filter((k) => k !== 'round').map((k) => g[k].toFixed(4)).join(',');
    let idx = l.regions.get(key);
    if (!idx) {
      renders += 2;
      const a = renderSkeleton(l.char, { ...g, round: 0 }, l.target), b = renderSkeleton(l.char, { ...g, round: 1 }, l.target);
      const out: number[] = [];
      if (a && b) for (let i = 0; i < a.data.length; i++) if (Math.abs(a.data[i] - b.data[i]) > 0.25) out.push(i);
      idx = Int32Array.from(out);
      l.regions.set(key, idx);
    }
    return idx;
  };
  // 1 - IoU, plus for letters with bowls 1 - IoU over just their corners: over the whole letter
  // the corners are too small a share to tell square from round.
  const scoreOf = (l: Letter, g: GeometryParams): number => {
    const key = l.deps.map((k) => g[k].toFixed(4)).join(',');
    let v = l.memo.get(key);
    if (v === undefined) {
      renders++;
      const sk = renderSkeleton(l.char, g, l.target);
      v = sk ? 1 - iou(l.target.canvas, sk) : 1;
      if (l.deps.includes('round')) {
        const idx = cornersOf(l, g);
        v += FOCUS * (sk && idx.length >= 8 ? 1 - iou(l.target.canvas, sk, idx) : 0.5);
      }
      l.memo.set(key, v);
    }
    return v;
  };

  const g: GeometryParams = { ...prior };
  if (specs.some((sp) => sp.key === 'width')) g.width = initialWidth(letters, g);
  // Letters that cannot look like their skeleton at all (badly cleaned, or built very oddly) get
  // less say. The pull does not shrink with them, so when every letter is doubtful the defaults
  // win; it grows with the number of letters a parameter shapes (their scores add up too).
  const lw = letters.map((l) => Math.min(1, Math.max(0.15, (0.6 - scoreOf(l, g)) / 0.3)));
  const pull = specs.map((sp) => PULL * letters.filter((l) => l.deps.includes(sp.key)).length);
  const energy = (gg: GeometryParams) => {
    let e = 0;
    letters.forEach((l, i) => (e += lw[i] * scoreOf(l, gg)));
    specs.forEach((sp, k) => (e += pull[k] * ((gg[sp.key] - prior[sp.key]) / sp.scale) ** 2));
    return e;
  };

  // Pattern search: try each parameter up and down (and keep going while it helps), halve the
  // steps that help in neither direction.
  const step = new Map(specs.map((sp) => [sp.key, sp.step]));
  let best = energy(g);
  for (let sweep = 0; sweep < 40 && renders < MAX_RENDERS; sweep++) {
    let active = false;
    for (const sp of specs) {
      const st = step.get(sp.key)!;
      if (st < sp.min) continue;
      active = true;
      let moved = false;
      for (const dir of [1, -1]) {
        for (;;) {
          const v = clampSpec(sp, g[sp.key] + dir * st);
          if (Math.abs(v - g[sp.key]) < 1e-9 || renders >= MAX_RENDERS) break;
          const e = energy({ ...g, [sp.key]: v });
          if (e >= best - 1e-7) break;
          best = e;
          g[sp.key] = v;
          moved = true;
        }
        if (moved) break;
      }
      if (!moved) step.set(sp.key, st / 2);
    }
    if (!active) break;
  }
  const out: GeometryParams = { ...prior };
  for (const sp of specs) out[sp.key] = Math.round(g[sp.key] * 1e4) / 1e4;
  return out;
}

/** 1 - IoU of a captured letter against its skeleton at geometry g; null if it has no skeleton. */
export function letterScore(s: StyleSample, m: Measure, g: GeometryParams): number | null {
  if (!m.heightPx || !m.widthPx) return null;
  const t = prepareTarget(s.mask, m.bounds, strokeWeight(m));
  const sk = renderSkeleton(s.char, g, t);
  return sk ? 1 - iou(t.canvas, sk) : null;
}

/**
 * Thin letters are compared fattened (both shapes grown by this many px at FIT_H) to an
 * effective weight of MIN_WEIGHT, so a slightly rotated stick still overlaps its skeleton.
 */
export function tolerance(weight: number): number {
  return Math.max(0, Math.round(((MIN_WEIGHT - weight) * FIT_H) / 2));
}

function strokeWeight(m: Measure): number {
  return Math.min(0.4, Math.max(0.03, m.strokePx / Math.max(1, m.heightPx)));
}

function clampSpec(sp: Spec, v: number): number {
  return Math.min(sp.hi, Math.max(sp.lo, v));
}

/** Does this character's skeleton change when the parameter moves? */
function dependsOn(ch: string, sp: Spec): boolean {
  const base = skeletonFor(ch, DEFAULT_GEOMETRY);
  if (!base) return false;
  for (const v of [sp.lo, sp.hi, (DEFAULT_GEOMETRY[sp.key] + sp.lo) / 2, (DEFAULT_GEOMETRY[sp.key] + sp.hi) / 2]) {
    const other = skeletonFor(ch, { ...DEFAULT_GEOMETRY, [sp.key]: v });
    if (!other || !sameShape(base, other)) return true;
  }
  return false;
}

function sameShape(a: Skeleton, b: Skeleton): boolean {
  if (a.strokes.length !== b.strokes.length) return false;
  for (let i = 0; i < a.strokes.length; i++) {
    const p = a.strokes[i].points, q = b.strokes[i].points;
    if (p.length !== q.length) return false;
    for (let k = 0; k < p.length; k++) if (Math.abs(p[k][0] - q[k][0]) > 1e-6 || Math.abs(p[k][1] - q[k][1]) > 1e-6) return false;
  }
  return true;
}

/** Ink box of a skeleton drawn at stroke weight w, in skeleton units, plus the stroke thickness. */
function inkBox(sk: Skeleton, weight: number): { x0: number; x1: number; y0: number; y1: number; stroke: number } | null {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of sk.strokes) for (const [x, y] of s.points) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < x0) return null;
  const w = Math.min(0.45, Math.max(0.02, weight));
  // Stroke = w x letter height, letter height = span + stroke.
  const stroke = (w * Math.max(0.05, y1 - y0)) / (1 - w);
  const h = stroke / 2;
  return { x0: x0 - h, x1: x1 + h, y0: y0 - h, y1: y1 + h, stroke };
}

/**
 * Starting width: for each letter whose shape depends on width, the width at which its skeleton
 * has the captured letter's width / height ratio; the median of those.
 */
function initialWidth(letters: { char: string; aspect: number; target: FitTarget; deps: Key[] }[], g: GeometryParams): number {
  const ws: number[] = [];
  const sp = SPECS[0];
  for (const l of letters) {
    if (!l.deps.includes('width')) continue;
    const aspect = (w: number) => {
      const sk = skeletonFor(l.char, { ...g, width: w });
      const b = sk && inkBox(sk, l.target.weight);
      return b ? (b.x1 - b.x0) / (b.y1 - b.y0) : NaN;
    };
    let lo = sp.lo, hi = sp.hi;
    const aLo = aspect(lo), aHi = aspect(hi);
    if (!(aHi > aLo)) continue;
    if (l.aspect <= aLo) { ws.push(lo); continue; }
    if (l.aspect >= aHi) { ws.push(hi); continue; }
    for (let it = 0; it < 12; it++) {
      const mid = (lo + hi) / 2;
      if (aspect(mid) < l.aspect) lo = mid;
      else hi = mid;
    }
    ws.push((lo + hi) / 2);
  }
  if (!ws.length) return g.width;
  ws.sort((a, b) => a - b);
  const mid = ws.length >> 1;
  return ws.length % 2 ? ws[mid] : (ws[mid - 1] + ws[mid]) / 2;
}

// ---------- rendering for comparison ----------

/**
 * The mask cropped to its ink box `b`, area-resampled to FIT_H px tall (keeping the aspect),
 * grown for thin strokes (see tolerance) and placed on a canvas wide enough for any skeleton.
 */
export function prepareTarget(mask: Mask, b: Box, weight: number): FitTarget {
  const grow = tolerance(weight);
  const src = new Float32Array(b.w * b.h);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) src[y * b.w + x] = mask.data[(b.y + y) * mask.width + b.x + x] ? 1 : 0;
  const w = Math.max(1, Math.round((FIT_H * b.w) / b.h));
  const small = resampleArea(src, b.w, b.h, w, FIT_H);
  const W = Math.max(w, Math.ceil(2.6 * FIT_H)) + 2 * grow + 4, H = FIT_H + 2 * grow;
  const x = Math.floor((W - w) / 2);
  const canvas: Coverage = { w: W, h: H, data: new Float32Array(W * H) };
  // Grey dilation by a disc of radius grow while pasting.
  const offs: P2[] = [];
  for (let dy = -grow; dy <= grow; dy++) for (let dx = -grow; dx <= grow; dx++) if (dx * dx + dy * dy <= (grow + 0.5) ** 2) offs.push([dx, dy]);
  for (let yy = 0; yy < FIT_H; yy++) for (let xx = 0; xx < w; xx++) {
    const v = small[yy * w + xx];
    if (v <= 0) continue;
    for (const [dx, dy] of offs) {
      const i = (yy + grow + dy) * W + x + xx + dx;
      if (canvas.data[i] < v) canvas.data[i] = v;
    }
  }
  return { canvas, x, w, grow, weight };
}

/**
 * A character's skeleton drawn as a thick stroke (buildField coverage) at the target's stroke
 * weight, its ink box scaled to FIT_H tall and centred on the target's: a picture on the target's
 * canvas. Null if there is no skeleton for the character.
 */
export function renderSkeleton(ch: string, g: GeometryParams, t: FitTarget): Coverage | null {
  const sk = skeletonFor(ch, g);
  const box = sk && sk.strokes.some((s) => s.points.length) ? inkBox(sk, t.weight) : null;
  if (!sk || !box) return null;
  const ppu = FIT_H / (box.y1 - box.y0);
  const f = buildField(sk, { pxPerUnit: ppu, halfWidth: (box.stroke * ppu) / 2 + t.grow, margin: 1 });
  // The field is a translated copy of the canvas (same scale): canvas (c, r) <- field (c + dx, r + dy).
  const dx = f.originX + ((box.x0 + box.x1) / 2) * ppu - (t.x + t.w / 2);
  const dy = f.baselineY - box.y1 * ppu - t.grow;
  const { w: W, h: H } = t.canvas;
  const out = new Float32Array(W * H);
  const ix = Math.floor(dx), iy = Math.floor(dy), fx = dx - ix, fy = dy - iy;
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < f.width && y < f.height ? f.coverage[y * f.width + x] : 0);
  const c0 = Math.max(0, -ix - 1), c1 = Math.min(W, f.width - ix + 1);
  const r0 = Math.max(0, -iy - 1), r1 = Math.min(H, f.height - iy + 1);
  for (let r = r0; r < r1; r++) {
    const y = r + iy;
    for (let c = c0; c < c1; c++) {
      const x = c + ix;
      // A whole-pixel shift plus a fractional one: the area overlap is exactly bilinear.
      out[r * W + c] = (at(x, y) * (1 - fx) + at(x + 1, y) * fx) * (1 - fy) + (at(x, y + 1) * (1 - fx) + at(x + 1, y + 1) * fx) * fy;
    }
  }
  return { w: W, h: H, data: out };
}

/** Area-weighted resample of a float picture (separable box overlap). */
function resampleArea(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const wx = overlaps(sw, dw), wy = overlaps(sh, dh);
  const tmp = new Float32Array(sh * dw);
  for (let y = 0; y < sh; y++) {
    const row = y * sw;
    for (const [d, s, wgt] of wx) tmp[y * dw + d] += src[row + s] * wgt;
  }
  const out = new Float32Array(dw * dh);
  for (const [d, s, wgt] of wy) {
    const o = d * dw, t = s * dw;
    for (let x = 0; x < dw; x++) out[o + x] += tmp[t + x] * wgt;
  }
  return out;
}

/** (dst, src, weight) triples: how much of each source cell falls in each destination cell, normalised. */
function overlaps(n: number, m: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const k = n / m;
  for (let d = 0; d < m; d++) {
    const a = d * k, b = (d + 1) * k;
    for (let s = Math.floor(a); s < Math.min(n, Math.ceil(b)); s++) {
      const o = Math.min(b, s + 1) - Math.max(a, s);
      if (o > 1e-9) out.push([d, s, o / k]);
    }
  }
  return out;
}

/** Soft IoU (sum of min / sum of max) of two pictures on the same canvas, optionally over some pixels only. */
export function iou(a: Coverage, b: Coverage, only?: Int32Array): number {
  let inter = 0, uni = 0;
  const n = only ? only.length : Math.min(a.data.length, b.data.length);
  for (let k = 0; k < n; k++) {
    const i = only ? only[k] : k;
    const va = a.data[i], vb = b.data[i];
    if (va === 0 && vb === 0) continue;
    if (va < vb) { inter += va; uni += vb; } else { inter += vb; uni += va; }
  }
  return uni > 0 ? inter / uni : 0;
}

// ---------- roundness evidence from stroke ends ----------

/**
 * How square the free stroke ends are, as the roundness to pull toward: 0 when the ends are
 * clearly square (bricks, books, boxes), 1 when round (clay, straws) or when there is too little
 * evidence to tell.
 */
export function roundFromEnds(samples: StyleSample[], measures: Measure[]): number {
  let sum = 0, n = 0;
  samples.forEach((s, i) => {
    const m = measures[i];
    if (!m) return;
    // Fused pieces (beans, buttons) have lumpy ends that say little.
    const wt = s.porous ? 0.5 : 1;
    for (const f of endSquareness(s.mask, m)) { sum += f * wt; n += wt; }
  });
  if (n < 2) return DEFAULT_GEOMETRY.round;
  const sq = sum / n;
  return Math.round(Math.min(1, Math.max(0, (0.8 - sq) / 0.45)) * 1e4) / 1e4;
}

/** For each free stroke end: the share of its two outer corners that is ink (1 square, ~0 round or pointed). */
export function endSquareness(mask: Mask, m: Measure): number[] {
  const ends: P2[] = [];
  for (const p of m.paths) {
    if (p.points.length < 2) continue;
    const a = p.points[0], b = p.points[p.points.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5) continue;
    ends.push(a, b);
  }
  // A free end is one no other path end shares (paths meeting at a junction share its centre).
  const isFree = (q: P2) => ends.filter((e) => Math.hypot(e[0] - q[0], e[1] - q[1]) < 0.75).length === 1;
  const ink = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    return xi >= 0 && yi >= 0 && xi < mask.width && yi < mask.height && mask.data[yi * mask.width + xi] ? 1 : 0;
  };
  const out: number[] = [];
  for (const p of m.paths) {
    const n = p.points.length;
    if (n < 4) continue;
    const a = p.points[0], b = p.points[n - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5) continue;
    for (const fromStart of [true, false]) {
      const pts = fromStart ? p.points : [...p.points].reverse();
      const rad = fromStart ? p.radius : [...p.radius].reverse();
      const E = pts[0];
      if (!isFree(E)) continue;
      // Stroke radius near the end, and the direction the stroke runs out of it.
      let L = 0, k = 1;
      const look = Math.max(6, 0.1 * m.heightPx);
      while (k < n - 1 && L < look) { L += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); k++; }
      const rs = rad.slice(0, k + 1).sort((x, y) => x - y);
      const r = rs[rs.length >> 1];
      if (r < 2.5 || L < Math.min(look, 2 * r)) continue;
      let j = 0, back = 0;
      while (j < k && back < 2 * r) { back += Math.hypot(pts[j + 1][0] - pts[j][0], pts[j + 1][1] - pts[j][1]); j++; }
      const dx = E[0] - pts[j][0], dy = E[1] - pts[j][1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const tx = dx / len, ty = dy / len, nx = -ty, ny = tx;
      // March out to the tip of the stroke, then probe the two corners a square end would have.
      let t = 0;
      while (t < 3 * r && ink(E[0] + tx * (t + 0.5), E[1] + ty * (t + 0.5))) t += 0.5;
      if (t >= 3 * r) continue;
      const cx = E[0] + tx * (t + 0.25 - r), cy = E[1] + ty * (t + 0.25 - r);
      let hit = 0, tot = 0;
      for (const u of [0.75, 0.85]) for (const v of [-0.85, -0.75, 0.75, 0.85]) {
        hit += ink(cx + (tx * u + nx * v) * r, cy + (ty * u + ny * v) * r);
        tot++;
      }
      out.push(hit / tot);
    }
  }
  return out;
}
