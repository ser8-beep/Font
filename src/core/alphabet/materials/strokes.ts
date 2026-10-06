import { makeMask, type RGBAImage } from '../../image';
import type { StrokeField } from '../field';
import { medialAxis, type AxisPath } from '../measure';
import type { Build } from '../category';
import type { GeneratedArt, Measure, P2, Rng, StyleSample } from '../types';

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

// ---------- rendering ----------

interface TargetPart {
  pts: P2[];
  straight: boolean;
  bend: number;
  length: number;
}

/**
 * relPx: pixels per rel unit at the target size (the target letter's height in px).
 * pool: every strokes material learned from this photo (including mat), for borrowing a part
 * mat lacks (e.g. a round part for a bowl when this letter only had straight sticks).
 */
export function renderStrokes(f: StrokeField, mat: StrokesMaterial, relPx: number, rng: Rng, pool: StrokesMaterial[], build?: Build): GeneratedArt {
  const W = f.width, Hh = f.height;
  const acc = new Float32Array(W * Hh * 4);
  const mask = makeMask(W, Hh);
  const others = pool.filter((p) => p !== mat);
  let strips = [...mat.strips.map((p) => ({ p, own: true })), ...others.flatMap((o) => o.strips.map((p) => ({ p, own: false })))];
  let rounds = [...mat.rounds.map((p) => ({ p, own: true })), ...others.flatMap((o) => o.rounds.map((p) => ({ p, own: false })))];
  if (!strips.length && !rounds.length) throw new Error('no parts');
  // How the category's makers build this letter (object-type repository):
  //   repeated   copies of one object all the way round (a P of pencils)
  //   single     one object per stroke, stretched to fit, kept from the letter's own objects
  //   composite  a mix: every stroke a different object, borrowed from other letters too
  // Without a build the parts are picked by fit alone.
  const own = strips.filter((x) => x.own);
  if (build === 'repeated' && strips.length) {
    // A whole object, not a scrap: one of the longer sticks (the roll picks which, so "Try
    // another" can try a different object).
    const from = own.length ? own : strips;
    const byLen = [...from].sort((a, b) => b.p.lengthRel - a.p.lengthRel);
    // Long thin things (pencils, sticks) line up well; chunky ones (a glass) pile up, so they
    // are only used when there is nothing thinner.
    const whole0 = byLen.filter((x) => x.p.lengthRel >= 0.3);
    const thin = whole0.filter((x) => x.p.img.width >= x.p.img.height * 3);
    const whole = thin.length ? thin : whole0;
    const choices = whole.length ? whole.slice(0, Math.ceil(whole.length / 2)) : byLen.slice(0, 1);
    strips = [choices[Math.floor(rng() * choices.length)]];
    // Bowls and loops too are built from that object, as chords.
    rounds = [];
  }
  const ownPenalty = build === 'composite' ? 0.05 : build === 'single' ? 0.6 : 0.35;
  const reusePenalty = build === 'composite' ? 0.6 : build === 'repeated' ? 0 : 0.3;
  const used = new Map<StripPart, number>();
  const hw = f.halfWidth;
  // Bendy stuff (clay, wool, cable, chain) is swept round curves; rigid objects (pencils, wafers,
  // books) build curves from short straight sticks, as real object alphabets do.
  const bendy = strips.some(({ p }) => bentPart(p)) || (build === 'formed' && strips.some(({ p }) => !p.straight));

  type Job = { order: number; draw: () => void };
  const jobs: Job[] = [];

  for (const st of f.strokes) {
    // Dots: a small round object, or a short cut piece of stick.
    if (st.pts.length < 2 || st.role === 'dot') {
      const [x, y] = st.pts[0];
      const rp = pickRound(rounds, rng);
      if (rp) jobs.push({ order: 3, draw: () => drawRound(acc, mask, W, Hh, rp, x, y, hw * 1.25, hw * 1.25, rng() * Math.PI * 2, null) });
      else if (strips.length) {
        const sp = strips[Math.floor(rng() * strips.length)].p;
        jobs.push({ order: 3, draw: () => drawStrip(acc, mask, W, Hh, sp, [[x - hw * 0.6, y], [x + hw * 0.6, y]], hw * 1.2, relPx, false) });
      }
      continue;
    }
    // Bowls and loops: a whole round object when the photo has one.
    // Loops (O o 0) prefer rings; a solid disc only fits a round loop. The ink keeps a counter
    // either way, so the font still reads as O and not as a dot.
    if ((st.role === 'bowl' || st.role === 'loop') && st.circle) {
      const c = st.circle;
      const ratio = Math.max(c.rx, c.ry) / Math.max(1, Math.min(c.rx, c.ry));
      const rings = rounds.filter((r) => r.p.ring);
      const fits = st.role === 'bowl' ? rounds : rings.length ? rings : ratio < 1.25 ? rounds : [];
      if (fits.length && ratio < 1.5) {
        const rp = pickRound(fits, rng)!;
        const ox = c.rx + hw, oy = c.ry + hw;
        const k = rp.ring ? 0.58 : 0.42;
        jobs.push({ order: 2, draw: () => drawRound(acc, mask, W, Hh, rp, c.cx, c.cy, ox, oy, (rng() - 0.5) * 0.6, { rx: Math.max(1, Math.min(c.rx - hw * 0.5, ox * k)), ry: Math.max(1, Math.min(c.ry - hw * 0.5, oy * k)) }) });
        continue;
      }
    }
    const parts = splitTarget(st.pts).flatMap((t) => (t.straight || bendy ? [t] : chords(t)));
    for (const part of parts) {
      if (!strips.length) continue;
      const sp = pickStrip(strips, part, relPx, used, rng, bendy, ownPenalty, reusePenalty);
      used.set(sp, (used.get(sp) ?? 0) + 1);
      const flip = !sp.straight && !part.straight ? Math.sign(sp.bend) !== Math.sign(part.bend) : rng() < 0.5;
      // Object length vs the stroke: stretch a little, or line up several copies end to end.
      // One-object letters stretch instead; repeated ones line up copies more readily.
      const natural = (sp.lengthRel * relPx) / part.length;
      const copies = build === 'single' ? 1 : build === 'repeated' ? Math.max(1, Math.min(6, Math.round(1 / natural))) : natural < 0.68 ? Math.min(4, Math.round(1 / natural)) : 1;
      jobs.push({
        order: part.straight ? rng() : 1 + rng(),
        draw: () => {
          for (let k = 0; k < copies; k++) {
            const piece = copies === 1 ? part.pts : slicePolyline(part.pts, (k / copies) * part.length, ((k + 1) / copies) * part.length);
            drawStrip(acc, mask, W, Hh, sp, piece, 0, relPx, flip);
          }
        },
      });
    }
  }
  jobs.sort((a, b) => a.order - b.order).forEach((j) => j.draw());

  const data = new Uint8ClampedArray(W * Hh * 4);
  for (let i = 0; i < W * Hh; i++) {
    const a = acc[i * 4 + 3];
    if (a <= 0.004) continue;
    data[i * 4] = acc[i * 4] / a;
    data[i * 4 + 1] = acc[i * 4 + 1] / a;
    data[i * 4 + 2] = acc[i * 4 + 2] / a;
    data[i * 4 + 3] = Math.min(1, a) * 255;
  }
  return { image: { width: W, height: Hh, data }, mask };
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

function pickRound(rounds: { p: RoundPart; own: boolean }[], rng: Rng): RoundPart | null {
  if (!rounds.length) return null;
  const own = rounds.filter((r) => r.own);
  const from = own.length && rng() < 0.75 ? own : rounds;
  return from[Math.floor(rng() * from.length)].p;
}

function pickStrip(strips: { p: StripPart; own: boolean }[], t: TargetPart, relPx: number, used: Map<StripPart, number>, rng: Rng, bendy: boolean, ownPenalty: number, reusePenalty: number): StripPart {
  let best = strips[0].p, bestScore = Infinity;
  const tRel = t.length / relPx;
  for (const { p, own } of strips) {
    let s = Math.abs(Math.log(Math.max(0.05, p.lengthRel) / Math.max(0.05, tRel)));
    // Bendy stuff can be bent or straightened freely, so keeping the letter's own colour matters more.
    if (t.straight !== p.straight) s += bendy ? 0.12 : t.straight ? 0.7 : 0.45;
    if (!own) s += ownPenalty;
    s += (used.get(p) ?? 0) * reusePenalty;
    s += rng() * 0.35;
    if (s < bestScore) { bestScore = s; best = p; }
  }
  return best;
}

/** Replace a curve by a few straight chords (about one per 55 degrees of turn). */
function chords(t: TargetPart): TargetPart[] {
  const k = Math.max(2, Math.min(8, Math.ceil(absTurn(t.pts) / ((55 * Math.PI) / 180))));
  const out: TargetPart[] = [];
  for (let i = 0; i < k; i++) {
    const seg = slicePolyline(t.pts, (i / k) * t.length, ((i + 1) / k) * t.length);
    const a = seg[0], b = seg[seg.length - 1];
    out.push({ pts: [a, b], straight: true, bend: 0, length: Math.hypot(b[0] - a[0], b[1] - a[1]) });
  }
  return out;
}

/** Split a target stroke at sharp corners into parts. */
function splitTarget(pts: P2[]): TargetPart[] {
  const parts: P2[][] = [];
  let cur: P2[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    cur.push(pts[i]);
    if (i < pts.length - 1) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      const t = Math.abs(angleBetween([b[0] - a[0], b[1] - a[1]], [c[0] - b[0], c[1] - b[1]]));
      if (t > (50 * Math.PI) / 180) { parts.push(cur); cur = [pts[i]]; }
    }
  }
  parts.push(cur);
  return parts
    .filter((p) => p.length >= 2 && arcLength(p) > 1)
    .map((p) => {
      const bend = totalTurn(p);
      const len = arcLength(p);
      const straight = p.length === 2 || (Math.abs(bend) < (30 * Math.PI) / 180 && maxDeviation(p) < len * 0.06);
      return { pts: straight ? [p[0], p[p.length - 1]] : p, straight, bend, length: len };
    });
}

/**
 * Lay a strip along a target polyline: the strip's core spans the polyline; its extra columns
 * (the object's real ends) run past the polyline ends. Across, the object keeps its own width
 * relative to the letter (scale relPx / source height), or `width` px if given.
 */
function drawStrip(acc: Float32Array, mask: { data: Uint8Array }, W: number, H: number, sp: StripPart, rawPts: P2[], width: number, relPx: number, flip: boolean) {
  const pts = simplify(rawPts, 0.6);
  const len = arcLength(pts);
  if (len < 0.5) return;
  const coreLen = sp.core[1] - sp.core[0];
  const along = len / Math.max(1, coreLen); // target px per source column
  const across = width > 0 ? width / sp.img.height : relPx / sp.heightPx;
  const ext0 = sp.core[0] * along, ext1 = (sp.img.width - sp.core[1]) * along;
  const side = (sp.img.height / 2) * across + 1.5;
  const reach = side + Math.max(ext0, ext1) + 1;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const bx0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0])) - reach));
  const by0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1])) - reach));
  const bx1 = Math.min(W - 1, Math.ceil(Math.max(...pts.map((p) => p[0])) + reach));
  const by1 = Math.min(H - 1, Math.ceil(Math.max(...pts.map((p) => p[1])) + reach));
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
  if (bw <= 0 || bh <= 0) return;
  // Nearest point on the polyline for every pixel, segment by segment (ends extend straight on).
  const bd = new Float32Array(bw * bh).fill(Infinity);
  const bs = new Float32Array(bw * bh);
  const bv = new Float32Array(bw * bh);
  const n = pts.length - 1;
  for (let k = 0; k < n; k++) {
    const a = pts[k], b = pts[k + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    const first = k === 0, last = k === n - 1;
    const ex0 = first ? ext0 : 0, ex1 = last ? ext1 : 0;
    const sx0 = Math.max(bx0, Math.floor(Math.min(a[0] - ux * ex0, b[0] + ux * ex1) - side));
    const sx1 = Math.min(bx1, Math.ceil(Math.max(a[0] - ux * ex0, b[0] + ux * ex1) + side));
    const sy0 = Math.max(by0, Math.floor(Math.min(a[1] - uy * ex0, b[1] + uy * ex1) - side));
    const sy1 = Math.min(by1, Math.ceil(Math.max(a[1] - uy * ex0, b[1] + uy * ex1) + side));
    for (let y = sy0; y <= sy1; y++) {
      const py = y + 0.5;
      for (let x = sx0; x <= sx1; x++) {
        const px = x + 0.5;
        let t = (px - a[0]) * ux + (py - a[1]) * uy;
        if (!(first && t < 0) && !(last && t > L)) t = Math.min(L, Math.max(0, t));
        const qx = a[0] + ux * t, qy = a[1] + uy * t;
        const d = Math.hypot(px - qx, py - qy);
        const j = (y - by0) * bw + (x - bx0);
        if (d >= bd[j]) continue;
        bd[j] = d;
        bs[j] = cum[k] + t;
        bv[j] = ux * (py - qy) - uy * (px - qx);
      }
    }
  }
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      const j = (y - by0) * bw + (x - bx0);
      if (bd[j] > side) continue;
      const col = sp.core[0] + bs[j] / along - 0.5;
      const row = sp.mid + (flip ? -bv[j] : bv[j]) / across;
      if (col < -0.5 || col > sp.img.width - 0.5 || row < -0.5 || row > sp.img.height - 0.5) continue;
      const smp = samplePremul(sp.img, col, row);
      if (smp[3] <= 0.01) continue;
      over(acc, (y * W + x) * 4, smp);
      if (smp[3] > 0.5) mask.data[y * W + x] = 1;
    }
  }
}

/** Ramer-Douglas-Peucker on an open polyline. */
function simplify(pts: P2[], eps: number): P2[] {
  if (pts.length <= 2) return pts;
  const a0 = pts[0], z = pts[pts.length - 1];
  if (Math.hypot(z[0] - a0[0], z[1] - a0[1]) < eps * 2) {
    // A closed loop: its chord is zero, so simplify the two halves either side of the far point.
    let far = 1, fd = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.hypot(pts[i][0] - a0[0], pts[i][1] - a0[1]);
      if (d > fd) { fd = d; far = i; }
    }
    if (fd < eps) return [a0, z];
    return [...simplify(pts.slice(0, far + 1), eps).slice(0, -1), ...simplify(pts.slice(far), eps)];
  }
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const a = pts[i], b = pts[j];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    let md = -1, mk = -1;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((pts[k][0] - a[0]) * dy - (pts[k][1] - a[1]) * dx) / L;
      if (d > md) { md = d; mk = k; }
    }
    if (md > eps) { keep[mk] = 1; stack.push([i, mk], [mk, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Place a round object on an ellipse (outer radii rx, ry), optionally keeping a hole in the ink mask. */
function drawRound(acc: Float32Array, mask: { data: Uint8Array }, W: number, H: number, rp: RoundPart, cx: number, cy: number, rx: number, ry: number, rot: number, hole: { rx: number; ry: number } | null) {
  const sx = rx / rp.radius, sy = ry / rp.radius;
  const c = Math.cos(rot), s = Math.sin(rot);
  const half = rp.img.width / 2;
  const reach = Math.max(rx, ry) * 1.25 + 2;
  for (let y = Math.max(0, Math.floor(cy - reach)); y <= Math.min(H - 1, Math.ceil(cy + reach)); y++) {
    for (let x = Math.max(0, Math.floor(cx - reach)); x <= Math.min(W - 1, Math.ceil(cx + reach)); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      // Target -> object pixel: undo the ellipse scaling, then the rotation.
      const ex = dx / sx, ey = dy / sy;
      const ox = ex * c + ey * s, oy = -ex * s + ey * c;
      const sp = samplePremul(rp.img, ox + half - 0.5, oy + half - 0.5);
      if (sp[3] <= 0.01) continue;
      over(acc, (y * W + x) * 4, sp);
      const inHole = hole ? (dx / hole.rx) ** 2 + (dy / hole.ry) ** 2 < 1 : false;
      if (sp[3] > 0.5 && !inHole) mask.data[y * W + x] = 1;
    }
  }
}

// ---------- small helpers ----------

function over(acc: Float32Array, o: number, s: [number, number, number, number]) {
  const k = 1 - s[3];
  acc[o] = s[0] + acc[o] * k;
  acc[o + 1] = s[1] + acc[o + 1] * k;
  acc[o + 2] = s[2] + acc[o + 2] * k;
  acc[o + 3] = s[3] + acc[o + 3] * k;
}

/** Bilinear sample of straight RGBA, returned premultiplied with alpha in 0..1. */
function samplePremul(img: RGBAImage, x: number, y: number): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0];
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const tx = x - x0, ty = y - y0;
  for (let j = 0; j < 2; j++) {
    const yy = y0 + j;
    if (yy < 0 || yy >= img.height) continue;
    const wy = j ? ty : 1 - ty;
    for (let i = 0; i < 2; i++) {
      const xx = x0 + i;
      if (xx < 0 || xx >= img.width) continue;
      const w = (i ? tx : 1 - tx) * wy;
      const o = (yy * img.width + xx) * 4;
      const a = (img.data[o + 3] / 255) * w;
      out[0] += img.data[o] * a; out[1] += img.data[o + 1] * a; out[2] += img.data[o + 2] * a; out[3] += a;
    }
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

function slicePolyline(pts: P2[], s0: number, s1: number): P2[] {
  const walk = walker(pts);
  const n = Math.max(2, Math.ceil((s1 - s0) / 3));
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const [x, y] = walk(s0 + ((s1 - s0) * i) / n);
    out.push([x, y]);
  }
  return out;
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

function absTurn(pts: P2[]): number {
  let t = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    t += Math.abs(angleBetween([b[0] - a[0], b[1] - a[1]], [c[0] - b[0], c[1] - b[1]]));
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
