import { makeMask, type RGBAImage } from '../../image';
import { dilate } from '../../mask';
import type { StrokeField } from '../field';
import type { GeneratedArt, Measure, Rng, StyleSample } from '../types';

// Blocks on a grid: Lego bricks and plates, square tiles, Hama beads, pixel art.
//
// Detection looks for a regular grid of seams inside the letter: the image gradient, projected
// on the grid's two axes (after estimating its rotation), repeats with the same period both ways.
// The letter is then cut into cells along that grid, and every whole cell becomes a tile (one
// brick or stud), grouped by colour.
// Rendering snaps the new letter onto the same grid - stroke width in whole cells, diagonals as
// stair steps - and fills each cell with one of the kid's bricks: mostly one colour per letter,
// with the occasional odd brick, as in the photo.

interface Tile {
  img: RGBAImage;
  group: number;
}

export interface GridMaterial {
  kind: 'grid';
  /** Cell size / source letter height. */
  cellRel: number;
  tiles: Tile[];
  /** Mean colour of each colour group. */
  groups: [number, number, number][];
  /** The letter's main colour group. */
  dominant: number;
  /** Share of cells that are not the main colour. */
  odd: number;
}

export function detectGrid(sample: StyleSample, m: Measure): GridMaterial | null {
  const H = m.heightPx;
  if (!H || H < 40) return null;
  const { width: w, height: h } = sample.mask;
  const img = sample.image;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = 0.3 * img.data[i * 4] + 0.59 * img.data[i * 4 + 1] + 0.11 * img.data[i * 4 + 2];
  const near = dilate(sample.mask, 2);

  // Gradients and their dominant direction (mod 90 degrees).
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  const hist = new Float64Array(90);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!near.data[i]) continue;
      const a = lum[i - w - 1], b = lum[i - w], c = lum[i - w + 1], d = lum[i - 1], f = lum[i + 1], g = lum[i + w - 1], hh = lum[i + w], k = lum[i + w + 1];
      const sx = c + 2 * f + k - a - 2 * d - g, sy = g + 2 * hh + k - a - 2 * b - c;
      gx[i] = sx; gy[i] = sy;
      const mag = Math.hypot(sx, sy);
      if (mag < 40) continue;
      let ang = (Math.atan2(sy, sx) * 180) / Math.PI;
      ang = ((ang % 90) + 90) % 90;
      hist[Math.floor(ang) % 90] += mag;
    }
  }
  let bestBin = 0, bestVal = -1;
  for (let b = 0; b < 90; b++) {
    let v = 0;
    for (let d = -2; d <= 2; d++) v += hist[(b + d + 90) % 90];
    if (v > bestVal) { bestVal = v; bestBin = b; }
  }
  let rot = ((bestBin + 0.5) * Math.PI) / 180;
  if (rot > Math.PI / 4) rot -= Math.PI / 2;
  const cs = Math.cos(rot), sn = Math.sin(rot);

  // Seam energy along each grid axis.
  const b = m.bounds;
  const corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]];
  const us = corners.map(([x, y]) => x * cs + y * sn), vs = corners.map(([x, y]) => -x * sn + y * cs);
  const u0 = Math.floor(Math.min(...us)), v0 = Math.floor(Math.min(...vs));
  const nu = Math.ceil(Math.max(...us)) - u0 + 1, nv = Math.ceil(Math.max(...vs)) - v0 + 1;
  const pu = new Float64Array(nu), cu = new Float64Array(nu), pv = new Float64Array(nv), cv = new Float64Array(nv);
  for (let y = b.y; y < b.y + b.h; y++) {
    for (let x = b.x; x < b.x + b.w; x++) {
      const i = y * w + x;
      if (!sample.mask.data[i]) continue;
      const u = Math.round(x * cs + y * sn) - u0, v = Math.round(-x * sn + y * cs) - v0;
      pu[u] += Math.abs(gx[i] * cs + gy[i] * sn); cu[u]++;
      pv[v] += Math.abs(-gx[i] * sn + gy[i] * cs); cv[v]++;
    }
  }
  // Bricks are at least ~1/16 of the letter tall (finer rhythms are texture: straw ribs, wafer
  // patterns) and at most a third of it.
  const lo = Math.max(6, Math.round(H / 16)), hi = Math.round(H / 3);
  const acU = acf(norm(pu, cu), lo, hi), acV = acf(norm(pv, cv), lo, hi);
  if (!acU || !acV) return null;
  // The cell is the shortest repeat both axes agree on (two bricks also repeat, at twice the size).
  const cands = [...peaks(acU, lo, hi), ...peaks(acV, lo, hi)].sort((a, b) => a - b);
  let p = 0, agree = 0;
  for (const L of cands) {
    const sc = Math.min(nearMax(acU, L), nearMax(acV, L));
    if (sc > 0.45) { p = L; agree = sc; break; }
  }
  if (DEBUG) DEBUG(`${sample.char} rot ${((rot * 180) / Math.PI).toFixed(1)} cands ${cands.map((c) => c.toFixed(1)).join(',')} -> ${p.toFixed(1)} (${agree.toFixed(2)}) H ${H}`);
  if (!p) return null;

  // Grid lines sit where the seams are.
  const phaseU = phase(norm(pu, cu), p), phaseV = phase(norm(pv, cv), p);

  // Cut every cell that lies inside the letter into a tile.
  const tiles: { img: RGBAImage; colour: [number, number, number] }[] = [];
  const T = Math.max(4, Math.round(p));
  const inMask = (x: number, y: number) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    return ix >= 0 && iy >= 0 && ix < w && iy < h && sample.mask.data[iy * w + ix] === 1;
  };
  let cells = 0;
  for (let cu0 = phaseU - p; cu0 < nu; cu0 += p) {
    for (let cv0 = phaseV - p; cv0 < nv; cv0 += p) {
      let inside = 0;
      for (let sy = 0; sy < 5; sy++) for (let sx = 0; sx < 5; sx++) {
        const u = u0 + cu0 + ((sx + 0.5) / 5) * p, v = v0 + cv0 + ((sy + 0.5) / 5) * p;
        if (inMask(u * cs - v * sn, u * sn + v * cs)) inside++;
      }
      if (inside < 23) continue;
      cells++;
      const t: RGBAImage = { width: T, height: T, data: new Uint8ClampedArray(T * T * 4) };
      let r = 0, g = 0, bl = 0;
      for (let ty = 0; ty < T; ty++) {
        for (let tx = 0; tx < T; tx++) {
          const u = u0 + cu0 + ((tx + 0.5) / T) * p, v = v0 + cv0 + ((ty + 0.5) / T) * p;
          const x = Math.min(w - 1, Math.max(0, Math.round(u * cs - v * sn - 0.5)));
          const y = Math.min(h - 1, Math.max(0, Math.round(u * sn + v * cs - 0.5)));
          const s = (y * w + x) * 4, o = (ty * T + tx) * 4;
          t.data[o] = img.data[s]; t.data[o + 1] = img.data[s + 1]; t.data[o + 2] = img.data[s + 2]; t.data[o + 3] = 255;
          r += img.data[s]; g += img.data[s + 1]; bl += img.data[s + 2];
        }
      }
      tiles.push({ img: t, colour: [r / (T * T), g / (T * T), bl / (T * T)] });
    }
  }
  // A grid letter is mostly whole cells: if few cells fit, it is not built on a grid.
  const letterCells = countOn(sample.mask) / (p * p);
  if (DEBUG) DEBUG(`   cells ${cells} of ~${letterCells.toFixed(0)} tiles ${tiles.length}`);
  if (tiles.length < 6 || cells < letterCells * 0.55) return null;

  // Group tiles by colour.
  const groups: { colour: [number, number, number]; n: number }[] = [];
  const out: Tile[] = tiles.map((t) => {
    let gi = groups.findIndex((gr) => Math.hypot(gr.colour[0] - t.colour[0], gr.colour[1] - t.colour[1], gr.colour[2] - t.colour[2]) < 55);
    if (gi < 0) { groups.push({ colour: t.colour, n: 0 }); gi = groups.length - 1; }
    const gr = groups[gi];
    gr.colour = [(gr.colour[0] * gr.n + t.colour[0]) / (gr.n + 1), (gr.colour[1] * gr.n + t.colour[1]) / (gr.n + 1), (gr.colour[2] * gr.n + t.colour[2]) / (gr.n + 1)];
    gr.n++;
    return { img: t.img, group: gi };
  });
  let dominant = 0;
  groups.forEach((gr, i) => { if (gr.n > groups[dominant].n) dominant = i; });
  return { kind: 'grid', cellRel: p / H, tiles: out, groups: groups.map((g) => g.colour), dominant, odd: 1 - groups[dominant].n / out.length };
}

/** Set by scripts to print what the detector saw. */
export let DEBUG: ((msg: string) => void) | null = null;
export function setGridDebug(fn: ((msg: string) => void) | null) {
  DEBUG = fn;
}

function norm(sum: Float64Array, count: Float64Array): Float64Array {
  const out = new Float64Array(sum.length);
  for (let i = 0; i < sum.length; i++) out[i] = count[i] > 3 ? sum[i] / count[i] : 0;
  return out;
}

/** Normalised autocorrelation of a detrended profile for lags up to hi + 1 (null if too short). */
function acf(prof: Float64Array, lo: number, hi: number): Float64Array | null {
  const n = prof.length;
  if (n < lo * 3) return null;
  // Remove the slow trend so only the seam rhythm is left.
  const win = Math.max(3, hi);
  const det = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) { s += prof[j]; c++; }
    det[i] = prof[i] - s / c;
  }
  let zero = 0;
  for (let i = 0; i < n; i++) zero += det[i] * det[i];
  if (zero <= 0) return null;
  const ac = new Float64Array(hi + 2);
  for (let lag = 1; lag <= Math.min(hi + 1, n - 1); lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += det[i] * det[i + lag];
    ac[lag] = (s / zero) * (n / (n - lag));
  }
  return ac;
}

/** Local maxima of the autocorrelation above 0.3, with sub-pixel position. */
function peaks(ac: Float64Array, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let lag = Math.max(2, lo); lag <= Math.min(hi, ac.length - 2); lag++) {
    if (ac[lag] < 0.3 || ac[lag] < ac[lag - 1] || ac[lag] < ac[lag + 1]) continue;
    const a = ac[lag - 1], b = ac[lag], c = ac[lag + 1];
    const off = a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
    out.push(lag + Math.max(-0.5, Math.min(0.5, off)));
  }
  return out;
}

/** Highest autocorrelation within 8% of a lag. */
function nearMax(ac: Float64Array, L: number): number {
  let m = -1;
  for (let lag = Math.floor(L * 0.92); lag <= Math.ceil(L * 1.08); lag++) if (lag > 0 && lag < ac.length) m = Math.max(m, ac[lag]);
  return m;
}

/** Offset of the seam lines (where the profile peaks) for a given period. */
function phase(prof: Float64Array, p: number): number {
  let best = 0, bestV = -1;
  for (let ph = 0; ph < p; ph += 0.5) {
    let v = 0;
    for (let x = ph; x < prof.length; x += p) v += prof[Math.round(x)] ?? 0;
    if (v > bestV) { bestV = v; best = ph; }
  }
  return best;
}

function countOn(m: { data: Uint8Array }): number {
  let n = 0;
  for (let i = 0; i < m.data.length; i++) n += m.data[i] ? 1 : 0;
  return n;
}

// ---------- rendering ----------

/** pool: every grid material learned from this photo (including mat), e.g. to borrow brick colours. */
export function renderGrid(f: StrokeField, mat: GridMaterial, relPx: number, rng: Rng, pool: GridMaterial[]): GeneratedArt {
  const W = f.width, H = f.height;
  const cell = Math.max(3, mat.cellRel * relPx);
  // Stroke width in whole cells.
  const n = Math.max(1, Math.round((2 * f.halfWidth) / cell));
  const hq = (n * cell) / 2;
  // Line the grid up with the stem at x = 0 and the baseline.
  const x0 = f.originX - hq, y0 = f.baselineY + hq;
  const main = mat.tiles.filter((t) => t.group === mat.dominant);
  const others = pool.flatMap((p) => p.tiles.filter((t) => p !== mat || t.group !== mat.dominant));
  const data = new Uint8ClampedArray(W * H * 4);
  const mask = makeMask(W, H);
  const i0 = Math.floor(-x0 / cell) - 1, i1 = Math.ceil((W - x0) / cell) + 1;
  const j0 = Math.floor((y0 - H) / cell) - 1, j1 = Math.ceil(y0 / cell) + 1;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const cx0 = x0 + i * cell, cy1 = y0 - j * cell, cy0 = cy1 - cell;
      // Fill the cell when most of it lies within the stroke.
      let inside = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const px = Math.floor(cx0 + ((sx + 0.5) / 4) * cell), py = Math.floor(cy0 + ((sy + 0.5) / 4) * cell);
        if (px >= 0 && py >= 0 && px < W && py < H && f.dist[py * W + px] <= hq) inside++;
      }
      if (inside < 8) continue;
      const set = others.length && rng() < Math.min(0.35, mat.odd) ? others : main.length ? main : mat.tiles;
      const t = set[Math.floor(rng() * set.length)].img;
      const ax = Math.round(cx0), ay = Math.round(cy0), bx = Math.round(cx0 + cell), by = Math.round(cy1);
      for (let y = Math.max(0, ay); y < Math.min(H, by); y++) {
        for (let x = Math.max(0, ax); x < Math.min(W, bx); x++) {
          const tx = Math.min(t.width - 1, Math.floor(((x - ax + 0.5) / (bx - ax)) * t.width));
          const ty = Math.min(t.height - 1, Math.floor(((y - ay + 0.5) / (by - ay)) * t.height));
          const s = (ty * t.width + tx) * 4, o = (y * W + x) * 4;
          data[o] = t.data[s]; data[o + 1] = t.data[s + 1]; data[o + 2] = t.data[s + 2]; data[o + 3] = 255;
          mask.data[y * W + x] = 1;
        }
      }
    }
  }
  return { image: { width: W, height: H, data }, mask };
}

/**
 * A grid material for a letter that is built like its neighbours but was not detected (a thin L
 * of single bricks): all the photo's bricks, with the group closest to the letter's colour as
 * its main colour.
 */
export function gridFromPool(pool: GridMaterial[], colour: [number, number, number]): GridMaterial | null {
  if (!pool.length) return null;
  const groups: [number, number, number][] = [];
  const tiles: Tile[] = [];
  for (const g of pool) {
    for (const t of g.tiles) {
      const c = g.groups[t.group];
      let gi = groups.findIndex((q) => Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) < 55);
      if (gi < 0) { groups.push(c); gi = groups.length - 1; }
      tiles.push({ img: t.img, group: gi });
    }
  }
  let dominant = 0, best = Infinity;
  groups.forEach((q, i) => {
    const d = Math.hypot(q[0] - colour[0], q[1] - colour[1], q[2] - colour[2]);
    if (d < best) { best = d; dominant = i; }
  });
  const cells = pool.map((g) => g.cellRel).sort((a, b) => a - b);
  return { kind: 'grid', cellRel: cells[cells.length >> 1], tiles, groups, dominant, odd: 0.12 };
}
