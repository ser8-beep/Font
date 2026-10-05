import type { Box, Mask, RGBAImage } from './image';
import { clampBox, fitImage, makeMask, padBox, unionBox } from './image';
import { blurField, closePadded, components, dilate, fillHoles, keepBig, open, type Component } from './mask';

// Photo -> letter blobs.
//
// 1. Model the background as a smooth colour surface (quadratic in x/y per Lab channel),
//    fitted robustly to the pixels that look like background. This copes with uneven
//    lighting and phone vignetting.
// 2. Distance from that surface = "how much does this pixel stand out".
// 3. Otsu threshold, then a closing big enough that beans / pom-poms / pasta pieces
//    fuse into one blob per letter.
// 4. Connected components, then merge / drop / split until we have the expected count.

export const WORK_SIDE = 640;

export interface BgModel {
  /** 6 quadratic coefficients for each of L, a, b, in normalised coords u,v in [-1,1]. */
  coef: [number[], number[], number[]];
}

export interface Blob {
  /** Box in work-image pixels. */
  box: Box;
  /** Region mask covering `box` (work resolution). */
  region: Mask;
  area: number;
  /** Made of many small pieces (beans, pasta)? Then "fill the gaps" starts switched on. */
  porous: boolean;
}

export interface Analysis {
  work: RGBAImage;
  bg: BgModel;
  dist: Float32Array;
  threshold: number;
  fg: Mask;
  /** Closing radius used to find blobs (work px). */
  closeR: number;
  /** Closing radius for "fill the gaps" (work px). */
  fillR: number;
  blobs: Blob[];
}

// ---------- colour ----------

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

export function rgbToLab(r: number, g: number, b: number, out: Float32Array | number[], o = 0) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const fx = f(X), fy = f(Y), fz = f(Z);
  out[o] = 116 * fy - 16;
  out[o + 1] = 500 * (fx - fy);
  out[o + 2] = 200 * (fy - fz);
}

function toLab(img: RGBAImage): Float32Array {
  const lab = new Float32Array(img.width * img.height * 3);
  for (let i = 0, j = 0; i < img.width * img.height; i++, j += 3) {
    const p = i * 4;
    rgbToLab(img.data[p], img.data[p + 1], img.data[p + 2], lab, j);
  }
  return lab;
}

// ---------- background model ----------

function basis(u: number, v: number): number[] {
  return [1, u, v, u * u, u * v, v * v];
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-9) M[c][c] = 1e-9;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / M[c][c];
      for (let k2 = c; k2 <= n; k2++) M[r][k2] -= k * M[c][k2];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function fitBg(lab: Float32Array, w: number, h: number, use: (i: number) => boolean, ridge: number): BgModel {
  const AtA = Array.from({ length: 6 }, () => new Array(6).fill(0));
  const Atb = [new Array(6).fill(0), new Array(6).fill(0), new Array(6).fill(0)];
  const step = Math.max(1, Math.round(Math.sqrt((w * h) / 40000)));
  let n = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = y * w + x;
      if (!use(i)) continue;
      const bvec = basis((2 * x) / w - 1, (2 * y) / h - 1);
      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 6; c++) AtA[r][c] += bvec[r] * bvec[c];
        for (let ch = 0; ch < 3; ch++) Atb[ch][r] += bvec[r] * lab[i * 3 + ch];
      }
      n++;
    }
  }
  // Ridge term keeps the surface flat when samples are only on the border.
  for (let r = 1; r < 6; r++) AtA[r][r] += ridge * Math.max(1, n);
  if (n < 10) AtA[0][0] += 1;
  return { coef: [solve(AtA, Atb[0]), solve(AtA, Atb[1]), solve(AtA, Atb[2])] };
}

export function bgAt(bg: BgModel, u: number, v: number, out: number[]) {
  const b = basis(u, v);
  for (let ch = 0; ch < 3; ch++) {
    let s = 0;
    for (let k = 0; k < 6; k++) s += bg.coef[ch][k] * b[k];
    out[ch] = s;
  }
}

/** How strongly a Lab pixel differs from background (shadows count less than colour). */
function labDist(L: number, a: number, b: number, bg: number[]): number {
  const dL = (L - bg[0]) * 0.65;
  const da = a - bg[1];
  const db = b - bg[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

/**
 * Distance map for `box` of `img` (any resolution). The background model is in normalised
 * coordinates, so it applies equally to the small work image and the full-res photo.
 */
export function distanceMap(img: RGBAImage, bg: BgModel, box: Box, blurR: number): Float32Array {
  const out = new Float32Array(box.w * box.h);
  const lab = [0, 0, 0];
  const bgc = [0, 0, 0];
  for (let y = 0; y < box.h; y++) {
    const sy = y + box.y;
    for (let x = 0; x < box.w; x++) {
      const sx = x + box.x;
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
      const p = (sy * img.width + sx) * 4;
      rgbToLab(img.data[p], img.data[p + 1], img.data[p + 2], lab);
      bgAt(bg, (2 * sx) / img.width - 1, (2 * sy) / img.height - 1, bgc);
      out[y * box.w + x] = labDist(lab[0], lab[1], lab[2], bgc);
    }
  }
  return blurField(out, box.w, box.h, blurR, 1);
}

export function otsu(values: Float32Array, maxV = 160, sampleStep = 1): number {
  const bins = new Float64Array(maxV + 1);
  let n = 0;
  for (let i = 0; i < values.length; i += sampleStep) {
    bins[Math.min(maxV, Math.max(0, Math.round(values[i])))]++;
    n++;
  }
  let sum = 0;
  for (let i = 0; i <= maxV; i++) sum += i * bins[i];
  let sumB = 0, wB = 0, best = 0, bestT = 20;
  for (let t = 0; t <= maxV; t++) {
    wB += bins[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * bins[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; bestT = t + 0.5; }
  }
  return bestT;
}

// ---------- blobs ----------

function gapX(a: Box, b: Box): number {
  return Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
}
function gapY(a: Box, b: Box): number {
  return Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
}
function overlapXRatio(a: Box, b: Box): number {
  const o = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  return o / Math.min(a.w, b.w);
}

interface Group {
  box: Box;
  labels: number[];
  area: number;
  /** Optional column limits after a split (work coords, inclusive start / exclusive end). */
  cut?: [number, number];
}

function mergeGroups(a: Group, b: Group): Group {
  return { box: unionBox(a.box, b.box), labels: [...a.labels, ...b.labels], area: a.area + b.area };
}

function groupRegion(g: Group, labels: Int32Array, w: number): Mask {
  const m = makeMask(g.box.w, g.box.h);
  const set = new Set(g.labels);
  for (let y = 0; y < g.box.h; y++) {
    for (let x = 0; x < g.box.w; x++) {
      const sx = x + g.box.x;
      if (g.cut && (sx < g.cut[0] || sx >= g.cut[1])) continue;
      const l = labels[(y + g.box.y) * w + sx];
      if (l && set.has(l)) m.data[y * g.box.w + x] = 1;
    }
  }
  return m;
}

/** Split a group at the weakest column (fewest foreground pixels) in its middle part. */
function splitGroup(g: Group, labels: Int32Array, w: number, raw: Mask): [Group, Group] | null {
  const region = groupRegion(g, labels, w);
  // Column profile of the un-closed mask: thin bridges made by the closing count for little.
  const cols = new Float64Array(g.box.w);
  for (let y = 0; y < g.box.h; y++) {
    for (let x = 0; x < g.box.w; x++) {
      if (region.data[y * g.box.w + x]) cols[x] += raw.data[(y + g.box.y) * w + x + g.box.x] ? 1 : 0.1;
    }
  }
  const lo = Math.floor(g.box.w * 0.2), hi = Math.ceil(g.box.w * 0.8);
  if (hi - lo < 2) return null;
  let best = lo, bestV = Infinity;
  for (let x = lo; x < hi; x++) {
    // Prefer cuts near the middle when columns are equally thin.
    const v = cols[x] + Math.abs(x - g.box.w / 2) * 0.02 * g.box.h / g.box.w;
    if (v < bestV) { bestV = v; best = x; }
  }
  const cutX = g.box.x + best;
  const lim0: [number, number] = g.cut ? [g.cut[0], cutX] : [g.box.x, cutX];
  const lim1: [number, number] = g.cut ? [cutX, g.cut[1]] : [cutX, g.box.x + g.box.w];
  let areaL = 0;
  for (let y = 0; y < g.box.h; y++) for (let x = 0; x < best; x++) areaL += region.data[y * g.box.w + x];
  return [
    { box: { x: g.box.x, y: g.box.y, w: best, h: g.box.h }, labels: g.labels, area: areaL, cut: lim0 },
    { box: { x: cutX, y: g.box.y, w: g.box.w - best, h: g.box.h }, labels: g.labels, area: g.area - areaL, cut: lim1 },
  ];
}

function tightenGroup(g: Group, labels: Int32Array, w: number, raw: Mask): Blob {
  const region = groupRegion(g, labels, w);
  let minX = region.width, minY = region.height, maxX = -1, maxY = -1, area = 0;
  for (let y = 0; y < region.height; y++) {
    for (let x = 0; x < region.width; x++) {
      if (!region.data[y * region.width + x]) continue;
      area++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { box: g.box, region, area: 0, porous: false };
  const box = { x: g.box.x + minX, y: g.box.y + minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  const tight = makeMask(box.w, box.h);
  let rawOn = 0;
  for (let y = 0; y < box.h; y++) {
    for (let x = 0; x < box.w; x++) {
      const on = region.data[(y + minY) * region.width + x + minX];
      tight.data[y * box.w + x] = on;
      if (on && raw.data[(y + box.y) * w + x + box.x]) rawOn++;
    }
  }
  return { box, region: tight, area, porous: rawOn / area < 0.88 };
}

function groupComponents(comps: Component[], expected: number, imgW: number, imgH: number): Group[] {
  let groups: Group[] = comps.map((c) => ({ box: c.box, labels: [c.label], area: c.area }));
  if (!groups.length) return groups;

  // Drop big things hugging the frame edge (table edges, a hand, the shadow of the phone).
  groups = groups.filter((g) => {
    const c = comps[g.labels[0] - 1];
    return !(c.touchesEdge && (g.box.w > imgW * 0.6 || g.box.h > imgH * 0.85));
  });

  const sizeRef = () => {
    const areas = groups.map((g) => g.area).sort((a, b) => b - a);
    return areas[Math.min(areas.length - 1, Math.max(0, expected - 1))] || areas[0] || 1;
  };
  const heightRef = () => {
    const hs = [...groups].sort((a, b) => b.area - a.area).slice(0, Math.max(1, expected)).map((g) => g.box.h).sort((a, b) => a - b);
    return hs[Math.floor(hs.length / 2)] || 1;
  };

  // 1. Fuse small fragments into a close big neighbour (stray beans, the dot of a wool end).
  for (let changed = true; changed;) {
    changed = false;
    const ref = sizeRef();
    const hRef = heightRef();
    groups.sort((a, b) => a.area - b.area);
    for (let i = 0; i < groups.length && !changed; i++) {
      const g = groups[i];
      if (g.area >= ref * 0.35) break;
      let best = -1, bestGap = Infinity;
      for (let j = 0; j < groups.length; j++) {
        if (j === i || groups[j].area < g.area) continue;
        const gap = Math.max(gapX(g.box, groups[j].box), gapY(g.box, groups[j].box));
        if (gap < bestGap) { bestGap = gap; best = j; }
      }
      if (best >= 0 && bestGap <= hRef * 0.12) {
        const merged = mergeGroups(groups[best], g);
        groups = groups.filter((_, k) => k !== i && k !== best);
        groups.push(merged);
        changed = true;
      }
    }
  }

  // 2. Drop specks.
  {
    const ref = sizeRef();
    groups = groups.filter((g) => g.area >= ref * 0.12);
  }

  // 3. Too many: drop small loners, otherwise merge the most "stacked" / closest pair.
  while (groups.length > expected) {
    const areas = groups.map((g) => g.area).sort((a, b) => a - b);
    const median = areas[Math.floor(areas.length / 2)];
    const smallest = groups.reduce((m, g) => (g.area < m.area ? g : m), groups[0]);
    let bi = -1, bj = -1, bestScore = -Infinity;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i].box, b = groups[j].box;
        const ov = overlapXRatio(a, b);
        const gap = gapX(a, b) / Math.max(1, Math.min(a.h, b.h));
        const score = ov > 0.4 ? 10 + ov : -gap;
        if (score > bestScore) { bestScore = score; bi = i; bj = j; }
      }
    }
    if (bestScore < 10 && smallest.area < median * 0.4) {
      groups = groups.filter((g) => g !== smallest);
      continue;
    }
    if (bi < 0) break;
    const merged = mergeGroups(groups[bi], groups[bj]);
    groups = groups.filter((_, k) => k !== bi && k !== bj);
    groups.push(merged);
  }

  return groups;
}

export interface SegmentOptions {
  /** How many letters we expect to find (4 for PLAY). */
  expected: number;
}

export function analyse(src: RGBAImage, opts: SegmentOptions): Analysis {
  const work = fitImage(src, WORK_SIDE);
  const { width: w, height: h } = work;
  const lab = toLab(work);
  const diag = Math.hypot(w, h);

  // Initial background guess: border pixels close to the median border colour.
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.06));
  const isBorder = (i: number) => {
    const x = i % w, y = (i / w) | 0;
    return x < band || y < band || x >= w - band || y >= h - band;
  };
  const borderLab: number[][] = [[], [], []];
  for (let i = 0; i < w * h; i += 3) if (isBorder(i)) for (let c = 0; c < 3; c++) borderLab[c].push(lab[i * 3 + c]);
  const med = borderLab.map((arr) => arr.sort((a, b) => a - b)[arr.length >> 1] ?? 0);
  const close0 = (i: number) => labDist(lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2], med) < 22;
  let bg = fitBg(lab, w, h, (i) => isBorder(i) && close0(i), 0.05);

  const computeDist = (model: BgModel) => {
    const d = new Float32Array(w * h);
    const bgc = [0, 0, 0];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        bgAt(model, (2 * x) / w - 1, (2 * y) / h - 1, bgc);
        d[i] = labDist(lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2], bgc);
      }
    }
    return blurField(d, w, h, Math.max(1, Math.round(diag / 500)), 1);
  };

  let dist = computeDist(bg);
  let threshold = Math.max(10, otsu(dist));
  for (let iter = 0; iter < 2; iter++) {
    const t = threshold;
    bg = fitBg(lab, w, h, (i) => dist[i] < t * 0.6, 0.002);
    dist = computeDist(bg);
    threshold = Math.max(10, otsu(dist));
  }

  const raw = makeMask(w, h);
  for (let i = 0; i < w * h; i++) raw.data[i] = dist[i] > threshold ? 1 : 0;
  const opened = open(raw, Math.max(1, Math.round(diag * 0.0015)));
  const minArea = w * h * 0.0008;

  // Try a few closing sizes: big enough to fuse beans into letters, small enough not to
  // bridge neighbouring letters. Prefer the biggest one that gives the expected count.
  const base = diag * 0.012;
  let pick: { closeR: number; fg: Mask; labels: Int32Array; groups: Group[] } | null = null;
  for (const factor of [1, 0.65, 0.4]) {
    const closeR = Math.max(2, Math.round(base * factor));
    const fg = closePadded(opened, closeR);
    const { labels, comps } = components(fg);
    const groups = groupComponents(comps.filter((c) => c.area >= minArea), opts.expected, w, h);
    const cand = { closeR, fg, labels, groups };
    if (!pick || Math.abs(groups.length - opts.expected) < Math.abs(pick.groups.length - opts.expected)) pick = cand;
    if (groups.length === opts.expected) break;
  }
  const { closeR, fg, labels, groups } = pick!;

  // Too few: split the blob that is much wider than a letter (letters touching each other).
  while (groups.length < opts.expected && groups.length > 0) {
    groups.sort((a, b) => b.box.w - a.box.w);
    const g = groups[0];
    const others = groups.slice(1).map((o) => o.box.w).sort((a, b) => a - b);
    const typical = others.length ? others[others.length >> 1] : g.box.h * 0.75;
    if (g.box.w < typical * 1.3 && g.box.w / g.box.h < 1.15) break;
    const parts = splitGroup(g, labels, w, raw);
    if (!parts) break;
    groups.splice(0, 1, ...parts);
  }

  const blobs = groups
    .map((g) => tightenGroup(g, labels, w, raw))
    .filter((b) => b.area > 0)
    .sort((a, b) => a.box.x + a.box.w / 2 - (b.box.x + b.box.w / 2));

  return { work, bg, dist, threshold, fg, closeR, fillR: Math.max(closeR, Math.round(base)), blobs };
}

// ---------- per-letter clean-up at full resolution ----------

export interface LetterRegion {
  /** Box in work-image pixels. */
  box: Box;
  /** Optional region mask (work resolution) covering `box`. Absent for hand-drawn boxes. */
  region?: Mask;
}

export interface CleanSettings {
  /** -1 (thinner) .. +1 (bolder). */
  bolder: number;
  fillHoles: boolean;
}

export interface CleanResult {
  /** Crop of the full-res photo, in full-res pixels. */
  box: Box;
  mask: Mask;
  /** Raw thresholded mask before clean-up (for the "before" view). */
  raw: Mask;
}

/** Per-letter work that does not depend on the sliders; pass the same object back to reuse it. */
export interface CleanCache {
  box?: Box;
  dist?: Float32Array;
  allowed?: Mask;
  threshold?: number;
}

export function cleanLetter(src: RGBAImage, an: Analysis, letter: LetterRegion, s: CleanSettings, cache: CleanCache = {}): CleanResult {
  const k = src.width / an.work.width;
  const pad = an.closeR * 1.5;
  if (!cache.box || !cache.dist || !cache.allowed) {
    cache.box = clampBox({ x: (letter.box.x - pad) * k, y: (letter.box.y - pad) * k, w: (letter.box.w + 2 * pad) * k, h: (letter.box.h + 2 * pad) * k }, src.width, src.height);
    cache.dist = distanceMap(src, an.bg, cache.box, Math.max(1, Math.round(k)));
    cache.allowed = allowedRegion(an, letter, cache.box, k, pad);
    // A hand-drawn box usually means the letter is faint: pick a threshold just for this box.
    if (letter.region) cache.threshold = an.threshold;
    else {
      const inBox = cache.dist.filter((_, i) => cache.allowed!.data[i]);
      cache.threshold = Math.max(5, Math.min(an.threshold, otsu(inBox)));
    }
  }
  const { box, dist, allowed } = cache;
  const t = cache.threshold! * Math.pow(2, -s.bolder * 1.1);
  const raw = makeMask(box.w, box.h);
  for (let i = 0; i < raw.data.length; i++) raw.data[i] = dist[i] > t && allowed.data[i] ? 1 : 0;

  let m = open(raw, Math.max(1, Math.round(k * 0.8)));
  const cr = s.fillHoles ? an.fillR * k : an.closeR * k * 0.35;
  m = closePadded(m, cr);
  if (s.fillHoles) m = fillHoles(m, box.w * box.h * 0.012);
  m = keepBig(m, 0.06);
  return { box, mask: m, raw };
}

/** Only keep pixels near this letter's blob, so neighbours cannot leak into the crop. */
function allowedRegion(an: Analysis, letter: LetterRegion, box: Box, k: number, pad: number): Mask {
  let allowed: Mask | null = null;
  if (letter.region) {
    const grown = dilate(padMask(letter.region, Math.ceil(pad)), Math.ceil(an.closeR * 0.8));
    allowed = makeMask(box.w, box.h);
    const ox = letter.box.x - Math.ceil(pad), oy = letter.box.y - Math.ceil(pad);
    for (let y = 0; y < box.h; y++) {
      const ry = Math.floor((y + box.y) / k - oy);
      if (ry < 0 || ry >= grown.height) continue;
      for (let x = 0; x < box.w; x++) {
        const rx = Math.floor((x + box.x) / k - ox);
        if (rx < 0 || rx >= grown.width) continue;
        allowed.data[y * box.w + x] = grown.data[ry * grown.width + rx];
      }
    }
  } else {
    // Hand-drawn box: everything inside the box (not the padding) is fair game.
    allowed = makeMask(box.w, box.h);
    for (let y = 0; y < box.h; y++) {
      for (let x = 0; x < box.w; x++) {
        const wx = (x + box.x) / k, wy = (y + box.y) / k;
        if (wx >= letter.box.x && wx < letter.box.x + letter.box.w && wy >= letter.box.y && wy < letter.box.y + letter.box.h) allowed.data[y * box.w + x] = 1;
      }
    }
  }
  return allowed;
}

function padMask(m: Mask, p: number): Mask {
  const out = makeMask(m.width + 2 * p, m.height + 2 * p);
  for (let y = 0; y < m.height; y++) out.data.set(m.data.subarray(y * m.width, (y + 1) * m.width), (y + p) * out.width + p);
  return out;
}

/** Turn a user-drawn box (work coords) into a region. */
export function regionFromBox(an: Analysis, box: Box): LetterRegion {
  return { box: clampBox(box, an.work.width, an.work.height) };
}

/** Rough count of letters found, for the samples script. */
export function countLetters(an: Analysis): number {
  return an.blobs.length;
}

export { padBox };
