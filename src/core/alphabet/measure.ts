import { makeMask, type Box, type Mask } from '../image';
import { fillHoles, maskBounds } from '../mask';
import type { Measure, P2, SkeletonPath, StyleSample } from './types';

// Measurements of one captured letter: exact Euclidean distance transform, medial-axis paths
// (thinning, spur pruning, split at junctions), typical stroke thickness, slant, wobble, colour.
//
// Path points use continuous pixel coordinates: pixel (i, j) covers [i, i+1) x [j, j+1) and its
// centre is (i + 0.5, j + 0.5), as in field.ts, so floor(point) is the pixel a point lies in.

/** Thinning runs on a copy of the mask at most this tall (paths are mapped back to the sample). */
const WORK_H = 200;
/** ... and at most this wide. */
const WORK_W = 280;
/** Point spacing of the output paths, px. */
const STEP = 1.5;

/** A medial-axis path with what its ends touch. */
export interface AxisPath extends SkeletonPath {
  /** First point repeats at the end (a loop with no junction: O, a ring). */
  closed: boolean;
  /** The first / last point is a junction where other paths meet (else a free stroke end). */
  startJunction: boolean;
  endJunction: boolean;
}

export function measureSample(s: StyleSample): Measure {
  const { width: w, height: h } = s.mask;
  const b = maskBounds(s.mask);
  if (!b) {
    return {
      heightPx: 0, widthPx: 0, bounds: { x: 0, y: 0, w: 0, h: 0 }, strokePx: 2, dist: new Float32Array(w * h),
      paths: [], slant: 0, wobble: 0, colour: [128, 128, 128],
    };
  }
  const dist = distanceTransform(s.mask, b);
  const axis = medialAxis(s.mask, dist, b);
  return {
    heightPx: b.h,
    widthPx: b.w,
    bounds: b,
    strokePx: typicalStroke(axis, s.mask, dist, b),
    dist,
    paths: axis.map((p) => ({ points: p.points, radius: p.radius })),
    slant: measureSlant(axis, b.h),
    wobble: measureWobble(axis, s.mask, b.h),
    colour: meanColour(s, b),
  };
}

// ---------- exact Euclidean distance transform ----------

/**
 * Euclidean distance from each ink pixel centre to the nearest background pixel centre (0 on
 * background); pixels outside the image count as background. Felzenszwalb & Huttenlocher's
 * separable lower-envelope algorithm: exact and O(pixels). Only `box` (default: the ink bounds)
 * is processed; it must contain every ink pixel.
 */
export function distanceTransform(m: Mask, box?: Box | null): Float32Array {
  const W = m.width;
  const out = new Float32Array(W * m.height);
  const b = box ?? maskBounds(m);
  if (!b || !b.w || !b.h) return out;
  const { x: bx, y: by, w, h } = b;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const col = new Float64Array(w * h);
  // Columns: squared distance to the nearest background pixel in the same column. The rows just
  // outside the box are background (it holds all the ink), hence the (y+1)^2 and (h-y)^2 terms.
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = m.data[(by + y) * W + bx + x] ? Infinity : 0;
    envelope(f, h, d, v, z);
    for (let y = 0; y < h; y++) col[y * w + x] = Math.min(d[y], (y + 1) * (y + 1), (h - y) * (h - y));
  }
  // Rows: combine the column distances.
  for (let y = 0; y < h; y++) {
    const row = (by + y) * W + bx;
    for (let x = 0; x < w; x++) f[x] = col[y * w + x];
    envelope(f, w, d, v, z);
    for (let x = 0; x < w; x++) {
      if (!m.data[row + x]) continue;
      out[row + x] = Math.sqrt(Math.min(d[x], (x + 1) * (x + 1), (w - x) * (w - x)));
    }
  }
  return out;
}

/** 1-D squared distance transform of sampled function f (Infinity = no sample) into d. */
function envelope(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = -1;
  for (let q = 0; q < n; q++) {
    const fq = f[q];
    if (fq === Infinity) continue;
    if (k < 0) {
      k = 0; v[0] = q; z[0] = -Infinity; z[1] = Infinity;
      continue;
    }
    let s: number;
    for (;;) {
      const p = v[k];
      s = (fq + q * q - (f[p] + p * p)) / (2 * (q - p));
      if (s <= z[k]) k--;
      else break;
    }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  if (k < 0) {
    d.fill(Infinity, 0, n);
    return;
  }
  let j = 0;
  for (let q = 0; q < n; q++) {
    while (z[j + 1] < q) j++;
    const p = v[j];
    d[q] = (q - p) * (q - p) + f[p];
  }
}

// ---------- thinning ----------

// Neighbour bits, clockwise from north (Zhang-Suen's P2..P9).
const NB: P2[] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
const ZS1 = new Uint8Array(256), ZS2 = new Uint8Array(256), SIMPLE = new Uint8Array(256), CROSS = new Uint8Array(256);
for (let c = 0; c < 256; c++) {
  const p = (k: number) => (c >> (k & 7)) & 1;
  let B = 0, A = 0;
  for (let k = 0; k < 8; k++) {
    B += p(k);
    if (!p(k) && p(k + 1)) A++;
  }
  const [n, e, s, w] = [p(0), p(2), p(4), p(6)];
  const ok = B >= 2 && B <= 6 && A === 1;
  ZS1[c] = ok && !(n && e && s) && !(e && s && w) ? 1 : 0;
  ZS2[c] = ok && !(n && e && w) && !(n && s && w) ? 1 : 0;
  // Topological numbers: 8-connected ink components around the pixel, and 4-connected
  // background components touching it. Simple (removable without changing topology) iff both 1.
  const fg = components8(c, true), bg = components8(c, false);
  CROSS[c] = fg;
  SIMPLE[c] = fg === 1 && bg === 1 ? 1 : 0;
}

/** Ink (8-adjacent) or background (4-adjacent, touching the centre's 4-neighbours) components in a 3x3 ring. */
function components8(c: number, ink: boolean): number {
  const lab = [-1, -1, -1, -1, -1, -1, -1, -1];
  const on = (k: number) => (((c >> k) & 1) === 1) === ink;
  let count = 0;
  for (let k = 0; k < 8; k++) {
    if (!on(k) || lab[k] >= 0) continue;
    const stack = [k];
    lab[k] = count;
    let touches = ink || k % 2 === 0;
    while (stack.length) {
      const a = stack.pop()!;
      for (let j = 0; j < 8; j++) {
        if (!on(j) || lab[j] >= 0) continue;
        const dx = Math.abs(NB[a][0] - NB[j][0]), dy = Math.abs(NB[a][1] - NB[j][1]);
        if (ink ? Math.max(dx, dy) > 1 : dx + dy !== 1) continue;
        lab[j] = count;
        if (j % 2 === 0) touches = true;
        stack.push(j);
      }
    }
    if (touches) count++;
  }
  return count;
}

function code(g: Uint8Array, W: number, i: number): number {
  return g[i - W] | (g[i - W + 1] << 1) | (g[i + 1] << 2) | (g[i + W + 1] << 3) | (g[i + W] << 4) | (g[i + W - 1] << 5) | (g[i - 1] << 6) | (g[i - W - 1] << 7);
}

/** Zhang-Suen thinning in place (grid must have a 1-pixel empty border), then removal of staircase corners. */
export function thin(g: Uint8Array, W: number, H: number): void {
  // Only border pixels can go, so each pass looks at the current border: the pixels that were
  // candidates before and survived, plus those uncovered by the last deletions.
  const mark = new Uint8Array(g.length);
  const offs = NB.map(([dx, dy]) => dy * W + dx);
  let cand: number[] = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (g[i] && (!g[i - 1] || !g[i + 1] || !g[i - W] || !g[i + W])) { cand.push(i); mark[i] = 1; }
  }
  const del: number[] = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (const lut of [ZS1, ZS2]) {
      del.length = 0;
      for (const i of cand) if (lut[code(g, W, i)]) del.push(i);
      if (!del.length) continue;
      changed = true;
      for (const i of del) g[i] = 0;
      const next: number[] = [];
      for (const i of cand) {
        if (g[i]) next.push(i);
        else mark[i] = 0;
      }
      for (const i of del) for (const o of offs) {
        const j = i + o;
        if (g[j] && !mark[j]) { mark[j] = 1; next.push(j); }
      }
      cand = next;
    }
  }
  const left: number[] = [];
  for (let i = 0; i < g.length; i++) if (g[i]) left.push(i);
  cleanStairs(g, W, left);
}

/** Remove pixels that only make the line 4-connected (L-shaped steps), so lines are 1 pixel thin. */
function cleanStairs(g: Uint8Array, W: number, pixels: number[]): void {
  for (const i of pixels) {
    if (!g[i]) continue;
    const c = code(g, W, i);
    const n = c & 1, e = (c >> 2) & 1, s = (c >> 4) & 1, w = (c >> 6) & 1;
    if (SIMPLE[c] && popcount(c) >= 2 && ((n && e) || (e && s) || (s && w) || (w && n))) g[i] = 0;
  }
}

function popcount(c: number): number {
  let k = 0;
  for (; c; c &= c - 1) k++;
  return k;
}

// ---------- skeleton graph ----------

interface Edge {
  /** Working-grid pixel indices from one node to the other (node pixels included at the ends). */
  pix: number[];
  a: number;
  b: number;
}

interface Graph {
  /** Node id per pixel (-1 for chain pixels). */
  nodeOf: Int32Array;
  /** Per node (a free end, a junction or a dot): its pixels. */
  nodes: { pix: number[] }[];
  edges: Edge[];
  /** Closed loops with no node on them. */
  loops: number[][];
}

function buildGraph(g: Uint8Array, W: number, pixels: number[]): Graph {
  const nodeOf = new Int32Array(g.length).fill(-1);
  const deg = new Map<number, number>();
  for (const i of pixels) if (g[i]) deg.set(i, popcount(code(g, W, i)));
  const nodes: Graph['nodes'] = [];
  // Cluster neighbouring non-chain pixels (degree != 2) into nodes.
  for (const [i, d] of deg) {
    if (d === 2 || nodeOf[i] >= 0) continue;
    const id = nodes.length;
    const node = { pix: [] as number[] };
    nodes.push(node);
    const stack = [i];
    nodeOf[i] = id;
    while (stack.length) {
      const p = stack.pop()!;
      node.pix.push(p);
      for (const [dx, dy] of NB) {
        const q = p + dy * W + dx;
        if (!g[q] || nodeOf[q] >= 0 || deg.get(q) === 2) continue;
        nodeOf[q] = id;
        stack.push(q);
      }
    }
  }
  const seen = new Uint8Array(g.length);
  const edges: Edge[] = [];
  nodes.forEach((node, id) => {
    for (const p of node.pix) {
      for (const [dx, dy] of NB) {
        const q = p + dy * W + dx;
        if (!g[q] || nodeOf[q] >= 0 || seen[q]) continue;
        const pix = [p];
        let prev = p, cur = q, end = -1;
        for (;;) {
          seen[cur] = 1;
          pix.push(cur);
          let next = -1;
          for (const [ex, ey] of NB) {
            const r = cur + ey * W + ex;
            if (!g[r] || r === prev) continue;
            if (nodeOf[r] >= 0) {
              // Do not step straight back into the node we just left (when the first chain pixel
              // touches two of its pixels) unless the chain really closes there.
              if (nodeOf[r] === id && pix.length === 2) continue;
              next = r; end = nodeOf[r];
              break;
            }
            if (!seen[r]) next = r;
          }
          if (next < 0 || end >= 0) {
            if (next >= 0) pix.push(next);
            break;
          }
          prev = cur; cur = next;
        }
        // A chain that runs back into its own node right away belongs to the node: drop it.
        if (end >= 0) edges.push({ pix, a: id, b: end });
      }
    }
  });
  // Remaining chain pixels form loops with no junction (O, a ring).
  const loops: number[][] = [];
  for (const [i, d] of deg) {
    if (d !== 2 || seen[i]) continue;
    const loop: number[] = [];
    let prev = -1, cur = i;
    for (;;) {
      seen[cur] = 1;
      loop.push(cur);
      let next = -1;
      for (const [ex, ey] of NB) {
        const r = cur + ey * W + ex;
        if (g[r] && r !== prev && !seen[r]) { next = r; break; }
      }
      if (next < 0) break;
      prev = cur; cur = next;
    }
    if (loop.length >= 3) {
      loop.push(loop[0]);
      loops.push(loop);
    }
  }
  return { nodeOf, nodes, edges, loops };
}

// ---------- medial axis ----------

/**
 * Medial-axis paths of a letter mask: thinned skeleton, short spurs pruned, split at junctions and
 * free ends. Each path runs between two ends (junction or free end); loops with no junction are
 * closed (first point repeated). Points are ~1.5 px apart, radius = distance to the edge.
 */
export function medialAxis(mask: Mask, dist: Float32Array, bounds?: Box | null): AxisPath[] {
  const b = bounds ?? maskBounds(mask);
  if (!b) return [];
  const W0 = roughStroke(mask, dist, b);
  // Work smaller for big letters, but keep strokes at least ~7 px thick so they survive.
  let s = Math.min(1, WORK_H / b.h, WORK_W / b.w);
  s = Math.min(1, Math.max(s, 7 / Math.max(1, W0)));
  const W = Math.ceil(b.w * s) + 2, H = Math.ceil(b.h * s) + 2;

  // Downscale by area coverage (>= half covered), with a 1-pixel empty border.
  let work = makeMask(W, H);
  if (s === 1) {
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) work.data[(y + 1) * W + x + 1] = mask.data[(b.y + y) * mask.width + b.x + x] ? 1 : 0;
  } else {
    const cov = new Float32Array(W * H), area = new Float32Array(W * H);
    for (let y = 0; y < b.h; y++) {
      const wy = Math.min(H - 2, Math.floor((y + 0.5) * s)) + 1;
      for (let x = 0; x < b.w; x++) {
        const wi = wy * W + Math.min(W - 2, Math.floor((x + 0.5) * s)) + 1;
        area[wi]++;
        if (mask.data[(b.y + y) * mask.width + b.x + x]) cov[wi]++;
      }
    }
    for (let i = 0; i < W * H; i++) work.data[i] = area[i] && cov[i] * 2 >= area[i] ? 1 : 0;
  }
  // Holes much smaller than the stroke are dirt or object detail, not counters.
  work = fillHoles(work, Math.max(2, 0.3 * (W0 * s) ** 2));
  for (let x = 0; x < W; x++) work.data[x] = work.data[(H - 1) * W + x] = 0;
  for (let y = 0; y < H; y++) work.data[y * W] = work.data[y * W + W - 1] = 0;

  const g = work.data;
  thin(g, W, H);
  let pixels: number[] = [];
  for (let i = 0; i < g.length; i++) if (g[i]) pixels.push(i);

  // Working pixel -> sample coordinates (pixel centres).
  const toSample = (i: number): P2 => [b.x + ((i % W) - 1 + 0.5) / s, b.y + (Math.floor(i / W) - 1 + 0.5) / s];
  const rAt = (p: P2) => sampleDist(dist, mask.width, mask.height, p);
  const capLen = 0.25 * b.h;

  const centre = (gr: Graph, id: number): P2 => {
    const pts = gr.nodes[id].pix.map(toSample);
    return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  };

  let graph = buildGraph(g, W, pixels);
  for (let iter = 0; iter < 8; iter++) {
    // Spurs: edges from a junction (3+ edges) to a free end that add little to the shape: the
    // discs along them reach hardly past the junction's own disc (a bump on the edge, the corner of
    // a square end). Never longer than a quarter of the letter.
    const deg = nodeDegrees(graph);
    const byNode = new Map<number, { e: Edge; len: number }[]>();
    for (const e of graph.edges) {
      const da = deg[e.a], db = deg[e.b];
      if (!((da === 1 && db >= 3) || (db === 1 && da >= 3))) continue;
      const jn = da >= 3 ? e.a : e.b;
      const J = centre(graph, jn);
      const rJ = rAt(J);
      const len = pixLength(e.pix, W) / s;
      if (len >= capLen) continue;
      let reach = 0;
      for (const p of e.pix) {
        if (graph.nodeOf[p] === jn) continue;
        const q = toSample(p);
        reach = Math.max(reach, Math.hypot(q[0] - J[0], q[1] - J[1]) + rAt(q));
      }
      if (reach - rJ < Math.max(2, 0.6 * rJ) || len < 3 / s) {
        if (!byNode.has(jn)) byNode.set(jn, []);
        byNode.get(jn)!.push({ e, len });
      }
    }
    if (!byNode.size) break;
    let removed = 0;
    for (const [jn, spurs] of byNode) {
      // Never strip a junction bare: keep the two longest arms if nothing else leaves it.
      spurs.sort((p, q) => q.len - p.len);
      const keep = deg[jn] - spurs.length >= 1 ? 0 : 2;
      for (const { e } of spurs.slice(keep)) {
        for (const p of e.pix) if (graph.nodeOf[p] !== jn) { g[p] = 0; removed++; }
      }
    }
    if (!removed) break;
    cleanStairs(g, W, pixels);
    pixels = pixels.filter((i) => g[i]);
    graph = buildGraph(g, W, pixels);
  }
  return chains(graph, (id) => centre(graph, id), s, toSample, rAt);
}

/** Edge ends at each node (a loop from a node back to itself counts twice). */
function nodeDegrees(gr: Graph): number[] {
  const deg = gr.nodes.map(() => 0);
  for (const e of gr.edges) { deg[e.a]++; deg[e.b]++; }
  return deg;
}

/**
 * Join edges into paths that run from junction (3+ edges) or free end to the next, passing
 * through nodes with exactly two edges; leftover rings become closed paths.
 */
function chains(gr: Graph, centre: (id: number) => P2, s: number, toSample: (i: number) => P2, rAt: (p: P2) => number): AxisPath[] {
  const tooSmall = (pts: P2[]) => {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return L < Math.max(6, 2 * rAt(pts[0]));
  };
  // A tiny loop from a node back into itself is a knot, not a counter: drop it before counting.
  gr = { ...gr, edges: gr.edges.filter((e) => e.a !== e.b || !tooSmall(e.pix.map(toSample))) };
  const deg = nodeDegrees(gr);
  const at = gr.nodes.map(() => [] as number[]);
  gr.edges.forEach((e, k) => { at[e.a].push(k); if (e.b !== e.a) at[e.b].push(k); });
  const used = new Uint8Array(gr.edges.length);
  const out: AxisPath[] = [];
  // Pixels of edge k walked away from node n, with the node centres at both ends.
  const walkFrom = (k: number, n: number): { pts: P2[]; other: number } => {
    const e = gr.edges[k];
    const fwd = e.a === n;
    const pix = fwd ? e.pix : [...e.pix].reverse();
    const pts = pix.map(toSample);
    const other = fwd ? e.b : e.a;
    pts[0] = centre(n);
    pts[pts.length - 1] = centre(other);
    return { pts, other };
  };
  const follow = (n0: number, k0: number): { pts: P2[]; end: number } => {
    let { pts, other } = walkFrom(k0, n0);
    used[k0] = 1;
    while (deg[other] === 2 && other !== n0) {
      const k = at[other].find((j) => !used[j]);
      if (k === undefined) break;
      used[k] = 1;
      const next = walkFrom(k, other);
      pts = pts.concat(next.pts.slice(1));
      other = next.other;
    }
    return { pts, end: other };
  };
  gr.nodes.forEach((_n, id) => {
    if (deg[id] === 2 || deg[id] === 0) return;
    for (const k of at[id]) {
      if (used[k]) continue;
      const { pts, end } = follow(id, k);
      // A tiny loop back into the same junction is a knot, not a counter.
      if (end === id && tooSmall(pts)) continue;
      out.push(finishPath(pts, false, deg[id] >= 3, deg[end] >= 3, s, rAt));
    }
  });
  // Rings made only of pass-through nodes (a counter whose junctions were pruned away).
  gr.edges.forEach((e, k) => {
    if (used[k]) return;
    const { pts } = follow(e.a, k);
    if (tooSmall(pts)) return;
    pts[pts.length - 1] = pts[0];
    out.push(finishPath(pts, true, false, false, s, rAt));
  });
  for (const loop of gr.loops) out.push(finishPath(loop.map(toSample), true, false, false, s, rAt));
  // Isolated dots (a single pixel or a tiny cluster with no edge).
  gr.nodes.forEach((_n, id) => {
    if (deg[id]) return;
    const c = centre(id);
    out.push({ points: [c], radius: [Math.max(0.5, rAt(c) - 0.25)], closed: false, startJunction: false, endJunction: false });
  });
  return out;
}

function pixLength(pix: number[], W: number): number {
  let L = 0;
  for (let k = 1; k < pix.length; k++) {
    const dx = (pix[k] % W) - (pix[k - 1] % W), dy = Math.floor(pix[k] / W) - Math.floor(pix[k - 1] / W);
    L += Math.hypot(dx, dy);
  }
  return L;
}

/** Smooth the pixel staircase, resample to STEP spacing and read the radius at each point. */
function finishPath(pts: P2[], closed: boolean, ja: boolean, jb: boolean, s: number, rAt: (p: P2) => number): AxisPath {
  const n = pts.length;
  const k = Math.max(1, Math.round(1.5 * Math.max(1, s)));
  let sm: P2[] = pts;
  if (n > 2) {
    sm = pts.map((p, i) => {
      if (!closed && (i === 0 || i === n - 1)) return p;
      let sx = 0, sy = 0, c = 0;
      for (let j = -k; j <= k; j++) {
        let t = i + j;
        if (closed) t = ((t % (n - 1)) + (n - 1)) % (n - 1);
        else if (t < 0 || t >= n) continue;
        // Shrink the window near the ends so they stay put.
        if (!closed && Math.abs(j) > Math.min(i, n - 1 - i)) continue;
        sx += pts[t][0]; sy += pts[t][1]; c++;
      }
      return [sx / c, sy / c];
    });
    if (closed) sm[n - 1] = sm[0];
  }
  const points = resample(sm, STEP);
  if (closed && points.length > 1) points[points.length - 1] = points[0];
  return { points, radius: points.map((p) => Math.max(0.5, rAt(p) - 0.25)), closed, startJunction: ja, endJunction: jb };
}

function resample(pts: P2[], step: number): P2[] {
  if (pts.length < 2) return pts.slice();
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1];
  if (L < 1e-9) return [pts[0]];
  const n = Math.max(1, Math.round(L / step));
  const out: P2[] = [];
  let j = 1;
  for (let i = 0; i <= n; i++) {
    const t = (L * i) / n;
    while (j < pts.length - 1 && cum[j] < t) j++;
    const seg = cum[j] - cum[j - 1] || 1;
    const u = Math.min(1, Math.max(0, (t - cum[j - 1]) / seg));
    out.push([pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * u, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * u]);
  }
  return out;
}

/** Bilinear distance-to-background at a continuous point (pixel centres at i + 0.5). */
function sampleDist(dist: Float32Array, W: number, H: number, p: P2): number {
  const x = p[0] - 0.5, y = p[1] - 0.5;
  const x0 = Math.max(0, Math.min(W - 1, Math.floor(x))), y0 = Math.max(0, Math.min(H - 1, Math.floor(y)));
  const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const tx = Math.min(1, Math.max(0, x - x0)), ty = Math.min(1, Math.max(0, y - y0));
  const a = dist[y0 * W + x0], bb = dist[y0 * W + x1], c = dist[y1 * W + x0], d = dist[y1 * W + x1];
  // On a ridge, a background neighbour would drag the value down: use the max of the 4 instead.
  if (!a || !bb || !c || !d) return Math.max(a, bb, c, d);
  return (a * (1 - tx) + bb * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/** Stroke width guess before the skeleton exists: a band of width W has mean distance ~W/4. */
function roughStroke(mask: Mask, dist: Float32Array, b: Box): number {
  let sum = 0, n = 0;
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
    const i = y * mask.width + x;
    if (mask.data[i]) { sum += dist[i]; n++; }
  }
  return n ? Math.max(2, (4 * sum) / n - 1) : 2;
}

// ---------- stroke statistics ----------

/** Arc length at each point. */
function arcLengths(pts: P2[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return cum;
}

/** Indices of path points clear of junctions (by `jk` radii) and free ends (by `ek` radii). */
function interior(p: AxisPath, jk: number, ek: number, extra = 0): number[] {
  const cum = arcLengths(p.points);
  const L = cum[cum.length - 1];
  const out: number[] = [];
  const r0 = p.radius[0], r1 = p.radius[p.radius.length - 1];
  for (let i = 0; i < p.points.length; i++) {
    if (p.closed) { out.push(i); continue; }
    const r = p.radius[i];
    const m0 = (p.startJunction ? jk * Math.max(r, r0) : ek * r) + extra;
    const m1 = (p.endJunction ? jk * Math.max(r, r1) : ek * r) + extra;
    if (cum[i] >= m0 && L - cum[i] >= m1) out.push(i);
  }
  return out;
}

function weightedMedian(vals: [number, number][]): number {
  if (!vals.length) return 0;
  vals.sort((a, b) => a[0] - b[0]);
  const total = vals.reduce((a, v) => a + v[1], 0);
  let acc = 0;
  for (const [v, w] of vals) {
    acc += w;
    if (acc >= total / 2) return v;
  }
  return vals[vals.length - 1][0];
}

/** Median of 2 x radius over path points away from junctions and ends (length-weighted). */
function typicalStroke(paths: AxisPath[], mask: Mask, dist: Float32Array, b: Box): number {
  const vals: [number, number][] = [];
  for (const p of paths) for (const i of interior(p, 1.5, 1)) vals.push([2 * p.radius[i], 1]);
  if (vals.length < 5) for (const p of paths) for (const r of p.radius) vals.push([2 * r, 1]);
  if (vals.length < 3) return roughStroke(mask, dist, b);
  return Math.max(1, weightedMedian(vals));
}

/** Point at arc length t along pts (cum = arc lengths). */
function pointAt(pts: P2[], cum: number[], t: number): P2 {
  let j = 1;
  while (j < pts.length - 1 && cum[j] < t) j++;
  const seg = cum[j] - cum[j - 1] || 1;
  const u = Math.min(1, Math.max(0, (t - cum[j - 1]) / seg));
  return [pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * u, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * u];
}

/** dx/dy of near-vertical straight stretches (length-weighted median), positive = leans right. */
function measureSlant(paths: AxisPath[], heightPx: number): number {
  const win = Math.max(8, 0.12 * heightPx);
  const vals: [number, number][] = [];
  for (const p of paths) {
    if (p.points.length < 3) continue;
    const cum = arcLengths(p.points);
    const L = cum[cum.length - 1];
    const s0 = p.startJunction ? 1.2 * p.radius[0] : 0;
    const s1 = L - (p.endJunction ? 1.2 * p.radius[p.radius.length - 1] : 0);
    for (let a = s0; a + win <= s1 + 1e-6; a += win / 2) {
      const A = pointAt(p.points, cum, a), B = pointAt(p.points, cum, a + win);
      const dx = B[0] - A[0], dy = B[1] - A[1];
      if (Math.abs(dy) < win * 0.5) continue;
      const t = dx / dy;
      if (Math.abs(t) > 0.3) continue;
      // Straight stretches only (not the side of a bowl).
      let dev = 0;
      const len = Math.hypot(dx, dy);
      for (let i = 0; i < p.points.length; i++) {
        if (cum[i] < a || cum[i] > a + win) continue;
        dev = Math.max(dev, Math.abs((p.points[i][0] - A[0]) * dy - (p.points[i][1] - A[1]) * dx) / len);
      }
      if (dev > 0.08 * win + 1) continue;
      vals.push([-t, win / 2]);
    }
  }
  const total = vals.reduce((a, v) => a + v[1], 0);
  if (total < 0.3 * heightPx) return 0;
  return weightedMedian(vals);
}

/**
 * Typical sideways wander of the stroke edges (centreline drift and thickness changes) away from
 * a smooth local fit, as a fraction of the letter height (as the amplitude of a sine wave).
 * The edges are found by casting rays sideways from the centreline (the distance transform alone
 * would smooth bumps away).
 */
function measureWobble(paths: AxisPath[], mask: Mask, heightPx: number): number {
  const half = Math.max(5, 0.12 * heightPx);
  const ink = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    return xi >= 0 && yi >= 0 && xi < mask.width && yi < mask.height && mask.data[yi * mask.width + xi] !== 0;
  };
  /** Distance from p along (nx, ny) to the edge, NaN if not found within max. */
  const edge = (p: P2, nx: number, ny: number, max: number) => {
    for (let t = 0.5; t <= max; t += 0.5) if (!ink(p[0] + nx * t, p[1] + ny * t)) return t - 0.25;
    return NaN;
  };
  const devs: number[] = [];
  for (const p of paths) {
    if (p.points.length < 8) continue;
    const cum = arcLengths(p.points);
    const L = cum[cum.length - 1];
    if (L < 0.1 * heightPx) continue;
    const pts = p.points, m = pts.length;
    const idx = (j: number) => (p.closed ? ((j % (m - 1)) + (m - 1)) % (m - 1) : Math.min(m - 1, Math.max(0, j)));
    // Left / right edge distances along a rough normal.
    const dl = new Float64Array(m), dr = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      const a = pts[idx(i - 3)], b = pts[idx(i + 3)];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-6) { dl[i] = dr[i] = NaN; continue; }
      const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
      const max = 3 * p.radius[i] + 4;
      dl[i] = edge(pts[i], nx, ny, max);
      dr[i] = edge(pts[i], -nx, -ny, max);
    }
    const span = Math.min(m, Math.ceil(half / STEP) + 3);
    for (const i of interior(p, 1.5, 1.5, 0.02 * heightPx)) {
      if (Number.isNaN(dl[i]) || Number.isNaN(dr[i])) continue;
      // Local quadratic fits against arc length over +-half.
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
      const bx = [0, 0, 0], by = [0, 0, 0], bl = [0, 0, 0], br = [0, 0, 0];
      for (let jj = -span; jj <= span; jj++) {
        let j = i + jj;
        let t: number;
        if (p.closed) {
          j = idx(j);
          t = jj * (L / (m - 1));
        } else {
          if (j < 0 || j >= m) continue;
          t = cum[j] - cum[i];
        }
        if (Math.abs(t) > half || Number.isNaN(dl[j]) || Number.isNaN(dr[j])) continue;
        const t2 = t * t;
        s0++; s1 += t; s2 += t2; s3 += t2 * t; s4 += t2 * t2;
        for (const [acc, v] of [[bx, pts[j][0]], [by, pts[j][1]], [bl, dl[j]], [br, dr[j]]] as const) {
          acc[0] += v; acc[1] += v * t; acc[2] += v * t2;
        }
      }
      if (s0 < 6) continue;
      const fx = quadFit(s0, s1, s2, s3, s4, bx), fy = quadFit(s0, s1, s2, s3, s4, by);
      const fl = quadFit(s0, s1, s2, s3, s4, bl), fr = quadFit(s0, s1, s2, s3, s4, br);
      if (!fx || !fy || !fl || !fr) continue;
      const tl = Math.hypot(fx[1], fy[1]) || 1;
      const dc = ((pts[i][0] - fx[0]) * -fy[1] + (pts[i][1] - fy[0]) * fx[1]) / tl;
      const eL = dc + (dl[i] - fl[0]), eR = dc - (dr[i] - fr[0]);
      devs.push(Math.abs(eL), Math.abs(eR));
    }
  }
  if (devs.length < 20) return 0;
  // Median, so joints and odd bits the fit cannot follow do not count; |sine| has median A / sqrt 2.
  devs.sort((a, b) => a - b);
  return (devs[devs.length >> 1] * Math.SQRT2) / Math.max(1, heightPx);
}

/** Value and slope at t = 0 of the least-squares quadratic a + b t + c t^2. */
function quadFit(s0: number, s1: number, s2: number, s3: number, s4: number, v: number[]): [number, number] | null {
  // Normal equations [s0 s1 s2; s1 s2 s3; s2 s3 s4] [a b c] = v, by Cramer's rule.
  const det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
  if (Math.abs(det) < 1e-9) return null;
  const a = (v[0] * (s2 * s4 - s3 * s3) - s1 * (v[1] * s4 - s3 * v[2]) + s2 * (v[1] * s3 - s2 * v[2])) / det;
  const bb = (s0 * (v[1] * s4 - v[2] * s3) - v[0] * (s1 * s4 - s3 * s2) + s2 * (s1 * v[2] - v[1] * s2)) / det;
  return [a, bb];
}

function meanColour(s: StyleSample, b: Box): [number, number, number] {
  const { width: w } = s.mask;
  let r = 0, g = 0, bl = 0, n = 0;
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
    const i = y * w + x;
    if (!s.mask.data[i]) continue;
    r += s.image.data[i * 4]; g += s.image.data[i * 4 + 1]; bl += s.image.data[i * 4 + 2]; n++;
  }
  n = Math.max(1, n);
  return [r / n, g / n, bl / n];
}
