import { DEFAULT_GEOMETRY, type GeometryParams, type P2, type Skeleton, type Stroke, type StrokeRole } from './types';

// Centreline drawings of every character the station can grow, in skeleton units
// (x right, y up, baseline 0, cap height 1, x-height X_HEIGHT, descender DESCENDER).
//
// The design is a friendly, monoline, geometric sans built the way object alphabets are built:
// from STICKS (one 'line' stroke per straight object: pencil, wafer, pipe) and ROUND PARTS
// ('bowl' / 'loop' strokes that a renderer may swap for a whole ring, can or biscuit placed on
// their circle), joined by bent things ('arc': chain, cable, clay sausage). Strokes that meet share
// the exact join point; strokes may also cross (X, t, f, Q's tail).
//
// GeometryParams bend the drawings toward the kid's hand:
//   width / slant  applied to every point (and circle) in skeletonFor
//   bowl           where bowls join stems (P B R, p q, 6 9)
//   bar            crossbar heights (A E F G H e f t)
//   fork           arm junctions (K X Y k x y)
//   round          corner radius = round x natural radius: 1 = circles and semicircles,
//                  0 = square-cornered (Lego, boxes, books). Roles and circles stay meaningful.
// Every drawing is designed to keep its counters open up to a stroke weight of 0.28 of the
// letter height (B R a e g 6 8 9 &), which is what Lego, books and clay kids build.

export const X_HEIGHT = 0.7;
export const DESCENDER = -0.3;

/** Font-unit vertical extents (bottom, top) a glyph's ink is fitted to. Cap height = 700. */
const CAP = 700, XH = 490, DESC = -210;

/**
 * The font-unit [bottom, top] that the traced ink of ch is scaled into.
 *
 * Without a weight: the standard class of the character (caps and ascenders 0..700, x-height
 * 0..490, descenders down to -210, punctuation at its usual place). Use this for letters the kid
 * photographed.
 *
 * With a weight (stroke thickness / letter height, as MaterialProfile.weight): the exact range of
 * this drawing rendered at that weight, so a grown letter keeps the same stroke thickness as the
 * capitals (o and b line up at heavy weights, a period is as fat as the strokes, a hyphen keeps
 * its length). Capitals still get exactly 0..700.
 */
export function verticalRange(ch: string, weight?: number): [number, number] {
  if (weight !== undefined && Number.isFinite(weight)) {
    const e = extents(ch);
    if (e) {
      const w = Math.min(0.4, Math.max(0.03, weight));
      const t = w / (1 - w); // stroke thickness in skeleton units, as renderLetter draws it
      return [Math.round((CAP * e[0]) / (1 + t)), Math.round((CAP * (e[1] + t)) / (1 + t))];
    }
  }
  if (/[A-Z0-9]/.test(ch)) return [0, CAP];
  if ('acemnorsuvwxz'.includes(ch)) return [0, XH];
  if ('bdhkl'.includes(ch)) return [0, CAP];
  if (ch === 'f') return [0, CAP];
  if (ch === 't') return [0, 620];
  if (ch === 'i') return [0, 680];
  if ('gpqy'.includes(ch)) return [DESC, XH];
  if (ch === 'j') return [DESC, 680];
  switch (ch) {
    case '.': return [0, 130];
    case ',': return [-120, 130];
    case "'": return [470, CAP];
    case '"': return [470, CAP];
    case '-': return [250, 370];
    case ':': return [0, XH];
    case ';': return [-120, XH];
    case '+': return [90, 470];
    case '=': return [160, 430];
    default: return [0, CAP]; // ! ? & # @ and anything else cap-height
  }
}

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const PUNCT = "!?.,'-&\":;+=#";

/** Characters to grow for a font whose captured letters include these cases. */
export function alphabetChars(cases: { upper: boolean; lower: boolean }): string[] {
  return [...(cases.upper || !cases.lower ? UPPER : ''), ...(cases.lower ? LOWER : ''), ...DIGITS, ...PUNCT];
}

/** Every character skeletonFor can draw. */
export function supportedChars(): string {
  return Object.keys(DRAW).join('');
}

/** The drawing of ch bent by the geometry, or null if there is none. */
export function skeletonFor(ch: string, g: GeometryParams): Skeleton | null {
  const draw = DRAW[ch] ?? DRAW[ch.toUpperCase()];
  if (!draw) return null;
  const geo: Geo = { R: fin(g.round, 1, 0, 1), bowl: fin(g.bowl, 0, -0.5, 0.5), bar: fin(g.bar, 0, -0.5, 0.5), fork: fin(g.fork, 0, -0.5, 0.5) };
  const w = fin(g.width, 1, 0.2, 5), sl = fin(g.slant, 0, -2, 2);
  const strokes = draw(geo).map((s): Stroke => {
    const out: Stroke = { points: s.points.map(([x, y]): P2 => [x * w + sl * y, y]), role: s.role };
    if (s.circle) {
      const c = s.circle;
      out.circle = { cx: c.cx * w + sl * c.cy, cy: c.cy, rx: c.rx * w, ry: c.ry };
    }
    return out;
  });
  return { strokes };
}

const extentCache = new Map<string, [number, number] | null>();
/** Lowest and highest centreline y of ch at the default geometry. */
function extents(ch: string): [number, number] | null {
  let e = extentCache.get(ch);
  if (e === undefined) {
    const sk = skeletonFor(ch, DEFAULT_GEOMETRY);
    const ys = sk ? sk.strokes.flatMap((s) => s.points.map((p) => p[1])) : [];
    e = ys.length ? [Math.min(...ys), Math.max(...ys)] : null;
    extentCache.set(ch, e);
  }
  return e;
}

// ---------- geometry kit ----------

/** Largest spacing (skeleton units) between points on a curve. */
const STEP = 0.025;
const D = Math.PI / 180;
const XHU = X_HEIGHT, DS = DESCENDER;

const cl = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fin = (v: number, dflt: number, lo: number, hi: number) => cl(Number.isFinite(v) ? v : dflt, lo, hi);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type Circle = NonNullable<Stroke['circle']>;
const mk = (role: StrokeRole, points: P2[], circle?: Circle): Stroke => (circle ? { points, role, circle } : { points, role });
const ln = (...pts: P2[]): Stroke => mk('line', pts);
const arc = (pts: P2[]): Stroke => mk('arc', pts);
const dot = (x: number, y: number): Stroke => mk('dot', [[x, y]]);
const boxCircle = (x0: number, y0: number, x1: number, y1: number): Circle => ({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, rx: (x1 - x0) / 2, ry: (y1 - y0) / 2 });

type FV = [number, number, number?, number?];

/**
 * A polyline through vertices. A vertex [x, y, a, b] has its corner replaced by a fillet that
 * leaves the incoming edge a before the corner and meets the outgoing edge b after it (an affine
 * quarter circle: tangent to both edges; a circular arc when a = b at a right angle). With
 * endCut (0..1) the second-to-last vertex's fillet stops that far round and the last vertex
 * only gives the direction it was heading (a terminal that curls a little).
 */
function fpath(vs: FV[], endCut?: number): P2[] {
  const out: P2[] = [];
  const push = (x: number, y: number) => {
    const l = out[out.length - 1];
    if (!l || Math.abs(l[0] - x) > 1e-9 || Math.abs(l[1] - y) > 1e-9) out.push([x, y]);
  };
  const n = vs.length, last = endCut === undefined ? n - 1 : n - 2;
  for (let i = 0; i <= last; i++) {
    const [x, y, fa = 0, fb = 0] = vs[i];
    if (i === 0 || i === n - 1 || (fa <= 1e-9 && fb <= 1e-9)) { push(x, y); continue; }
    const [px, py] = vs[i - 1], [qx, qy] = vs[i + 1];
    const l1 = Math.hypot(px - x, py - y) || 1, l2 = Math.hypot(qx - x, qy - y) || 1;
    const t1x = x + ((px - x) / l1) * fa, t1y = y + ((py - y) / l1) * fa;
    const t2x = x + ((qx - x) / l2) * fb, t2y = y + ((qy - y) / l2) * fb;
    const ox = t1x + t2x - x, oy = t1y + t2y - y;
    const cut = i === last && endCut !== undefined ? endCut : 1;
    const steps = Math.max(1, Math.ceil(((Math.PI / 2) * Math.hypot(fa, fb) * cut) / Math.SQRT2 / STEP));
    for (let s = 0; s <= steps; s++) {
      const t = (s / steps) * cut * (Math.PI / 2);
      const c = Math.cos(t), sn = Math.sin(t);
      push(ox + (x - t2x) * c + (x - t1x) * sn, oy + (y - t2y) * c + (y - t1y) * sn);
    }
  }
  return out;
}

/**
 * A rounded box: the square [-1, 1]^2 with corner radius R (0 = square, 1 = circle), stretched
 * onto [x0, x1] x [y0, y1]. At R = 1 it is the inscribed ellipse; at R = 0 the rectangle. Points
 * on it are addressed by polar angle in the unstretched square, so 45 degrees is always the
 * top-right corner direction and terminals at the corner angles land exactly on corners.
 */
interface Box { cx: number; cy: number; hx: number; hy: number; R: number }
const box = (x0: number, y0: number, x1: number, y1: number, R: number): Box =>
  ({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hx: (x1 - x0) / 2, hy: (y1 - y0) / 2, R: cl(R, 0, 1) });
const circleOf = (b: Box): Circle => ({ cx: b.cx, cy: b.cy, rx: b.hx, ry: b.hy });

/** Point of the rounded unit square along the ray at angle a (radians). */
function rsq(a: number, R: number): P2 {
  const c = Math.cos(a), s = Math.sin(a);
  const ac = Math.abs(c), as = Math.abs(s), k = 1 - R;
  let t: number;
  if (ac > 1e-12 && as / ac <= k + 1e-12) t = 1 / ac; // left / right edge
  else if (as > 1e-12 && ac / as <= k + 1e-12) t = 1 / as; // top / bottom edge
  else {
    const m = k * (ac + as); // corner arc
    t = m + Math.sqrt(Math.max(0, m * m - 2 * k * k + R * R));
  }
  return [c * t, s * t];
}

function boxPt(b: Box, deg: number): P2 {
  const [u, v] = rsq(deg * D, b.R);
  return [b.cx + u * b.hx, b.cy + v * b.hy];
}

/** Polar angles (degrees, 0..360) of the curve sample points of a box outline. */
function boxSamples(b: Box): number[] {
  const R = b.R;
  if (R <= 1e-9) return [45, 135, 225, 315];
  const k = 1 - R;
  const len = (Math.PI / 2) * R * Math.sqrt((b.hx * b.hx + b.hy * b.hy) / 2);
  const n = Math.max(1, Math.ceil(len / STEP));
  const out: number[] = [];
  for (let q = 0; q < 4; q++) {
    const sx = q === 0 || q === 3 ? k : -k, sy = q < 2 ? k : -k;
    for (let i = 0; i <= n; i++) {
      const th = ((q + i / n) * Math.PI) / 2;
      let a = Math.atan2(sy + R * Math.sin(th), sx + R * Math.cos(th)) / D;
      if (a < 0) a += 360;
      out.push(a);
    }
  }
  return out;
}

/** The part of a box outline from polar angle a0 to a1 (degrees; a1 < a0 runs clockwise). `at`: angles to include exactly (joins). */
function boxArc(b: Box, a0: number, a1: number, at: number[] = []): P2[] {
  const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
  const angs = [lo, hi];
  for (const a of [...boxSamples(b), ...at]) {
    for (let m = -720; m <= 720; m += 360) if (a + m > lo + 1e-7 && a + m < hi - 1e-7) angs.push(a + m);
  }
  angs.sort((p, q) => p - q);
  const pts: P2[] = [];
  let prev = -Infinity;
  for (const a of angs) {
    if (a - prev < 1e-7) continue;
    prev = a;
    pts.push(boxPt(b, a));
  }
  return a1 < a0 ? pts.reverse() : pts;
}

/** The closed outline, starting and ending exactly at polar angle a0. */
function boxLoop(b: Box, a0: number, at: number[] = []): P2[] {
  const pts = boxArc(b, a0, a0 + 360, at);
  pts[pts.length - 1] = [pts[0][0], pts[0][1]];
  return pts;
}

/** Polar angle (degrees) of the outline point at height y, on the right (side 1) or left (side -1). */
function angleAtY(b: Box, y: number, side: 1 | -1): number {
  const v = cl((y - b.cy) / b.hy, -1, 1), k = 1 - b.R, av = Math.abs(v);
  const u = av <= k ? 1 : k + Math.sqrt(Math.max(0, b.R * b.R - (av - k) ** 2));
  return Math.atan2(v, side * u) / D;
}

/** Polar angle (degrees) of the outline point at x, on the top (side 1) or bottom (side -1). */
function angleAtX(b: Box, x: number, side: 1 | -1): number {
  const u = cl((x - b.cx) / b.hx, -1, 1), k = 1 - b.R, au = Math.abs(u);
  const v = au <= k ? 1 : k + Math.sqrt(Math.max(0, b.R * b.R - (au - k) ** 2));
  return Math.atan2(side * v, u) / D;
}

/** Polar angle (degrees) of the point where a box's straight edge on side (0 right, 90 top, ...) ends, going counter-clockwise. */
function edgeEnd(b: Box, side: 0 | 90 | 180 | 270, ccw: boolean): number {
  const k = 1 - b.R;
  const t = ccw ? k : -k; // along-edge coordinate of the end
  const [u, v] = side === 0 ? [1, t] : side === 90 ? [-t, 1] : side === 180 ? [-1, -t] : [t, -1];
  let a = Math.atan2(v, u) / D;
  if (a < 0) a += 360;
  return a;
}

/**
 * A round bowl hanging off a vertical stem at x = sx (the box overlaps the stem a little when
 * round): the part of the box outline on the far side of the stem, from its top join to its bottom
 * join. dir 1: bowl to the right of the stem (b p), -1: to the left (a d q g).
 */
function sideBowl(b: Box, sx: number, dir: 1 | -1): Stroke {
  const at = angleAtX(b, sx, 1);
  const pts = dir > 0 ? boxArc(b, at, -at) : boxArc(b, at, 360 - at);
  pts[0] = [sx, pts[0][1]];
  pts[pts.length - 1] = [sx, pts[pts.length - 1][1]];
  return mk('bowl', pts, circleOf(b));
}

/** A bowl off a stem at x = 0 reaching right to xr between heights y0 and y1 (a D: straight top and bottom, round right side). */
function dBowl(xr: number, y0: number, y1: number, R: number): Stroke {
  const h = y1 - y0, ry = (R * h) / 2, rx = R * Math.min(h / 2, xr - 0.04);
  return mk('bowl', fpath([[0, y1], [xr, y1, rx, ry], [xr, y0, ry, rx], [0, y0]]), boxCircle(0, y0, xr, y1));
}

/** The round top of n h m: from x0 over to x1, springing from top - r (r = round x half the width). */
function arch(x0: number, x1: number, top: number, R: number): P2[] {
  const r = (R * (x1 - x0)) / 2;
  return fpath([[x0, top - r], [x0, top, r, r], [x1, top, r, r], [x1, top - r]]);
}

/** The round bottom of U u: from x0 down and round to x1. */
function cup(x0: number, x1: number, bot: number, R: number): P2[] {
  const r = (R * (x1 - x0)) / 2;
  return fpath([[x0, bot + r], [x0, bot, r, r], [x1, bot, r, r], [x1, bot + r]]);
}

/** A hook at the foot of a stem at sx, curling left to x0 (J j g). The tip turns up `lip` beyond the curve. */
function hookLeft(sx: number, x0: number, bot: number, r: number, lip: number): P2[] {
  return fpath([[sx, bot + r], [sx, bot, r, r], [x0, bot, r, r], [x0, bot + Math.max(r, lip)]]);
}

/** A tail at the foot of a stem at sx, turning right to x1 and curling up a little (l t). */
function tailRight(sx: number, x1: number, r: number, r2: number): P2[] {
  return fpath([[sx, r], [sx, 0, r, r], [x1, 0, r2, r2], [x1, 1]], 0.5);
}

/** Two straight strokes of an X crossing at height y (h = full height, w = width). */
function cross(w: number, h: number, y: number): Stroke[] {
  const f = y / h;
  let a = 0, b = 0; // how far the top (a) or bottom (b) ends move in to raise / lower the crossing
  if (f > 0.5) a = (w * (f - 0.5)) / f;
  else b = (w * (0.5 - f)) / (1 - f);
  return [ln([a, h], [w - b, 0]), ln([w - a, h], [b, 0])];
}

/** Lower-case bowls: reach from the stem to the far side, and how much the round box overlaps the stem. */
const BW = 0.62, OV = 0.08;
const bowlRight = (sx: number, y0: number, y1: number, R: number) => sideBowl(box(sx - OV * R, y0, sx + BW, y1, R), sx, 1);
const bowlLeft = (sx: number, y0: number, y1: number, R: number) => sideBowl(box(sx - BW, y0, sx + OV * R, y1, R), sx, -1);

// ---------- the drawings ----------

interface Geo { R: number; bowl: number; bar: number; fork: number }
type Draw = (g: Geo) => Stroke[];

const DRAW: Record<string, Draw> = {
  // ----- capitals -----
  A: ({ bar }) => {
    const y = cl(0.33 + bar, 0.12, 0.68);
    return [ln([0, 0], [0.34, 1], [0.68, 0]), ln([0.34 * y, y], [0.68 - 0.34 * y, y])];
  },
  B: ({ R, bowl }) => {
    const j = cl(0.53 + 0.5 * bowl, 0.46, 0.6);
    const x1 = 0.5, x2 = 0.56, h1 = 1 - j, h2 = j;
    const rx1 = R * Math.min(h1 / 2, x1 - 0.04), ry1 = (R * h1) / 2;
    const upper = fpath([[0, 1], [x1, 1, rx1, ry1], [x1, j, ry1, rx1], [0, j]]);
    // The lower bowl starts where the upper one's straight bottom ends, so the middle bar is one object.
    const s = x1 - rx1;
    const rx2 = Math.min(R * Math.min(h2 / 2, x2 - 0.04), x2 - s), ry2 = (R * h2) / 2;
    const lower = fpath([[s, j], [x2, j, rx2, ry2], [x2, 0, ry2, rx2], [0, 0]]);
    return [ln([0, 0], [0, 1]), mk('bowl', upper, boxCircle(0, j, x1, 1)), mk('bowl', lower, boxCircle(0, 0, x2, j))];
  },
  C: ({ R }) => {
    const t = lerp(45, 40, R);
    return [arc(boxArc(box(0, 0, 0.76, 1, R), t, 360 - t))];
  },
  // D keeps a little rounding on its bowl even when square (clipped corners, as Lego D), so it never
  // collapses into the rectangle of O / 0.
  D: ({ R }) => [ln([0, 0], [0, 1]), dBowl(0.7, 0, 1, Math.max(R, 0.3))],
  E: ({ bar }) => {
    const m = cl(0.5 + bar, 0.36, 0.64);
    return [ln([0, 0], [0, 1]), ln([0, 1], [0.5, 1]), ln([0, m], [0.44, m]), ln([0, 0], [0.52, 0])];
  },
  F: ({ bar }) => {
    const m = cl(0.48 + bar, 0.34, 0.62);
    return [ln([0, 0], [0, 1]), ln([0, 1], [0.5, 1]), ln([0, m], [0.42, m])];
  },
  G: ({ R, bar }) => {
    const b = box(0, 0, 0.78, 1, R);
    const y = cl(0.46 + 0.5 * bar, 0.3, 0.56);
    const pts = boxArc(b, lerp(45, 40, R), 360 + angleAtY(b, y, 1));
    const end = pts[pts.length - 1];
    return [arc(pts), ln(end, [0.44, end[1]])];
  },
  H: ({ bar }) => {
    const y = cl(0.5 + bar, 0.3, 0.7);
    return [ln([0, 0], [0, 1]), ln([0.62, 0], [0.62, 1]), ln([0, y], [0.62, y])];
  },
  I: () => [ln([0, 0], [0, 1])],
  J: ({ R }) => {
    const x = 0.46, r = R * 0.23;
    return [ln([x, 1], [x, r]), arc(hookLeft(x, 0, 0, r, 0.12))];
  },
  K: ({ fork }) => {
    const j = cl(0.42 + fork, 0.25, 0.65);
    return [ln([0, 0], [0, 1]), ln([0.58, 1], [0, j]), ln([0, j], [0.6, 0])];
  },
  L: () => [ln([0, 1], [0, 0], [0.52, 0])],
  M: () => [ln([0, 0], [0, 1], [0.42, 0.2], [0.84, 1], [0.84, 0])],
  N: () => [ln([0, 0], [0, 1], [0.64, 0], [0.64, 1])],
  O: ({ R }) => {
    const b = box(0, 0, 0.86, 1, R);
    return [mk('loop', boxLoop(b, 90), circleOf(b))];
  },
  P: ({ R, bowl }) => {
    const j = cl(0.5 + bowl, 0.3, 0.72);
    return [ln([0, 0], [0, 1]), dBowl(0.57, j, 1, R)];
  },
  Q: ({ R }) => {
    const b = box(0, 0, 0.86, 1, R);
    return [mk('loop', boxLoop(b, 90), circleOf(b)), ln([0.52, 0.24], [0.88, 0])];
  },
  R: ({ R, bowl }) => {
    const j = cl(0.5 + bowl, 0.3, 0.72);
    const bw = dBowl(0.57, j, 1, R);
    // The leg leaves the straight part of the bowl's bottom (under where a ring would sit).
    const x = Math.min(0.24, 0.57 - R * Math.min((1 - j) / 2, 0.53));
    return [ln([0, 0], [0, 1]), bw, ln([x, j], [0.62, 0])];
  },
  S: ({ R }) => sShape(0.03, 0.55, 0.58, 0.52, 1, R),
  T: () => [ln([0, 1], [0.6, 1]), ln([0.3, 1], [0.3, 0])],
  U: ({ R }) => {
    const w = 0.62, r = (R * w) / 2;
    return [ln([0, 1], [0, r]), arc(cup(0, w, 0, R)), ln([w, r], [w, 1])];
  },
  V: () => [ln([0, 1], [0.34, 0], [0.68, 1])],
  W: () => [ln([0, 1], [0.24, 0], [0.5, 0.8], [0.76, 0], [1, 1])],
  X: ({ fork }) => cross(0.64, 1, cl(0.5 + fork, 0.3, 0.7)),
  Y: ({ fork }) => {
    const j = cl(0.48 + fork, 0.2, 0.8);
    return [ln([0, 1], [0.34, j]), ln([0.68, 1], [0.34, j]), ln([0.34, j], [0.34, 0])];
  },
  Z: () => [ln([0, 1], [0.58, 1], [0, 0], [0.6, 0])],

  // ----- lower case: x-height 0.7, round bowls on sticks, single-storey a and g -----
  a: ({ R }) => [bowlLeft(BW, 0, XHU, R), ln([BW, XHU], [BW, 0])],
  b: ({ R }) => [ln([0, 1], [0, 0]), bowlRight(0, 0, XHU, R)],
  c: ({ R }) => {
    const t = lerp(45, 40, R);
    return [arc(boxArc(box(0, 0, 0.62, XHU, R), t, 360 - t))];
  },
  d: ({ R }) => [bowlLeft(BW, 0, XHU, R), ln([BW, 1], [BW, 0])],
  e: ({ R, bar }) => {
    const b = box(0, 0, 0.66, XHU, R);
    // Low bar: the eye stays open even for the fattest materials.
    const y = cl(0.25 + 0.5 * bar, 0.2, 0.3);
    const ar = angleAtY(b, y, 1), al = angleAtY(b, y, -1);
    const pts = boxArc(b, ar, 360 - lerp(45, 50, R), [al]);
    return [ln(boxPt(b, al), pts[0]), arc(pts)];
  },
  f: ({ R, bar }) => {
    const sx = 0.16, r = R * 0.2;
    const y = cl(XHU + 0.3 * bar, 0.6, 0.78);
    return [ln([sx, 0], [sx, 1 - r]), arc(fpath([[sx, 1 - r], [sx, 1, r, r], [0.56, 1, r, r], [0.56, 0]], 0.5)), ln([0, y], [0.44, y])];
  },
  g: ({ R }) => {
    const r = R * 0.2;
    return [bowlLeft(BW, 0, XHU, R), ln([BW, XHU], [BW, DS + r]), arc(hookLeft(BW, 0.04, DS, r, 0.08))];
  },
  h: ({ R }) => [ln([0, 1], [0, 0]), arc(arch(0, 0.6, XHU, R)), ln([0.6, XHU - R * 0.3], [0.6, 0])],
  i: () => [ln([0, XHU], [0, 0]), dot(0, 1)],
  j: ({ R }) => {
    const sx = 0.24, r = R * 0.12;
    return [ln([sx, XHU], [sx, DS + r]), arc(hookLeft(sx, 0, DS, r, 0.08)), dot(sx, 1)];
  },
  k: ({ fork }) => {
    const j = cl(0.28 + 0.7 * fork, 0.12, 0.5);
    return [ln([0, 1], [0, 0]), ln([0.5, XHU], [0, j]), ln([0, j], [0.54, 0])];
  },
  l: ({ R }) => {
    const r = R * 0.14;
    return [ln([0, 1], [0, r]), arc(tailRight(0, 0.24, r, R * 0.1))];
  },
  m: ({ R }) => {
    const r = R * 0.24;
    // Both arches are one stroke: one straight bar when square, split at the middle cusp when round.
    return [
      ln([0, XHU], [0, 0]),
      arc([...arch(0, 0.48, XHU, R), ...arch(0.48, 0.96, XHU, R).slice(1)]),
      ln([0.48, XHU - r], [0.48, 0]),
      ln([0.96, XHU - r], [0.96, 0]),
    ];
  },
  n: ({ R }) => [ln([0, XHU], [0, 0]), arc(arch(0, 0.6, XHU, R)), ln([0.6, XHU - R * 0.3], [0.6, 0])],
  o: ({ R }) => {
    const b = box(0, 0, 0.68, XHU, R);
    return [mk('loop', boxLoop(b, 90), circleOf(b))];
  },
  p: ({ R, bowl }) => [ln([0, XHU], [0, DS]), bowlRight(0, cl(0.7 * bowl, -0.15, 0.2), XHU, R)],
  q: ({ R, bowl }) => [bowlLeft(BW, cl(0.7 * bowl, -0.15, 0.2), XHU, R), ln([BW, XHU], [BW, DS])],
  r: ({ R }) => {
    const r1 = R * 0.26, r2 = R * 0.18;
    return [ln([0, XHU], [0, 0]), arc(fpath([[0, XHU - r1], [0, XHU, r1, r1], [0.44, XHU, r2, r2], [0.44, 0]], 0.45))];
  },
  s: ({ R }) => sShape(0.03, 0.49, 0.52, 0.36, XHU, R),
  t: ({ R, bar }) => {
    const sx = 0.16, r = R * 0.16;
    const y = cl(XHU + 0.3 * bar, 0.58, 0.78);
    return [ln([sx, 0.9], [sx, r]), arc(tailRight(sx, 0.42, r, R * 0.1)), ln([0, y], [0.42, y])];
  },
  u: ({ R }) => {
    const r = R * 0.3;
    return [ln([0, XHU], [0, r]), arc(cup(0, 0.6, 0, R)), ln([0.6, XHU], [0.6, 0])];
  },
  v: () => [ln([0, XHU], [0.31, 0], [0.62, XHU])],
  w: () => [ln([0, XHU], [0.22, 0], [0.45, 0.56], [0.68, 0], [0.9, XHU])],
  x: ({ fork }) => cross(0.6, XHU, cl(0.35 + 0.7 * fork, 0.2, 0.5)),
  y: ({ fork }) => {
    const w = 0.62, yj = cl(0.7 * fork, -0.1, 0.35);
    // The right arm runs straight on into the descender; the left arm stops on it.
    const xAt = (yy: number) => w / 2 + (yy / XHU) * (w / 2);
    return [ln([0, XHU], [xAt(yj), yj]), ln([w, XHU], [xAt(DS), DS])];
  },
  z: () => [ln([0, XHU], [0.54, XHU], [0, 0], [0.56, 0])],

  // ----- digits: cap height; 0 is a narrower oval than O, 1 has a flag -----
  '0': ({ R }) => {
    const b = box(0, 0, 0.6, 1, R);
    return [mk('loop', boxLoop(b, 90), circleOf(b))];
  },
  '1': () => [ln([0.3, 1], [0.3, 0]), ln([0.3, 1], [0, 0.74])],
  '2': ({ R }) => {
    const b = box(0.02, 0.48, 0.58, 1, R);
    const pts = boxArc(b, lerp(135, 155, R), -lerp(45, 30, R));
    return [arc(pts), ln(pts[pts.length - 1], [0, 0], [0.62, 0])];
  },
  '3': ({ R }) => {
    const ym = 0.53;
    const up = box(0.04, ym, 0.56, 1, R), lo = box(0, 0, 0.6, ym, R);
    const t = lerp(135, 155, R);
    const upper = [...boxArc(up, t, -90), [0.16, ym] as P2];
    // The lower bowl starts where the upper one's straight bottom ends (one middle bar when square).
    const s = up.cx + up.hx * (1 - up.R);
    return [arc(upper), arc(boxArc(lo, angleAtX(lo, s, 1), -t))];
  },
  '4': () => [ln([0.5, 1], [0.5, 0]), ln([0.5, 1], [0, 0.3], [0.68, 0.3])],
  '5': ({ R }) => {
    const b = box(0, 0, 0.6, 0.62, R);
    const [x, y] = boxPt(b, 135);
    return [ln([0.56, 1], [x, 1], [x, y]), arc(boxArc(b, 135, -lerp(135, 150, R)))];
  },
  '6': ({ R, bowl }) => {
    const top = cl(0.62 - 0.5 * bowl, 0.54, 0.7);
    const ring = box(0, 0, 0.6, top, R), hook = box(0, 0.4, 0.56, 1, R);
    // The back rises from the top of the ring's straight left side (its tangent point when round).
    const a = edgeEnd(ring, 180, false);
    const start = boxPt(ring, a);
    const back = [start, ...boxArc(hook, 180, lerp(45, 30, R)).filter((p) => p[1] > start[1] + 1e-9)];
    return [mk('bowl', boxLoop(ring, a), circleOf(ring)), arc(back)];
  },
  '7': () => [ln([0, 1], [0.6, 1], [0.18, 0])],
  '8': ({ R }) => {
    const ym = 0.54;
    const up = box(0.06, ym, 0.54, 1, R), lo = box(0, 0, 0.6, ym, R);
    // Upper ring stands on the lower one: closed when round, open where it would double the middle bar when square.
    const upper = up.R >= 1 - 1e-9 ? boxLoop(up, 270) : boxArc(up, edgeEnd(up, 270, true), edgeEnd(up, 270, false) + 360);
    return [mk('loop', upper, circleOf(up)), mk('loop', boxLoop(lo, 90), circleOf(lo))];
  },
  '9': ({ R, bowl }) => {
    const bot = cl(0.38 + 0.5 * bowl, 0.3, 0.46);
    const ring = box(0, bot, 0.6, 1, R), hook = box(0.04, 0, 0.6, 0.6, R);
    const a = edgeEnd(ring, 0, false);
    const start = boxPt(ring, a);
    const back = [start, ...boxArc(hook, 0, -lerp(135, 150, R)).filter((p) => p[1] < start[1] - 1e-9)];
    return [mk('bowl', boxLoop(ring, a), circleOf(ring)), arc(back)];
  },

  // ----- punctuation -----
  '!': () => [ln([0, 1], [0, 0.38]), dot(0, 0)],
  '?': ({ R }) => {
    const b = box(0, 0.5, 0.56, 1, R);
    const pts = boxArc(b, lerp(135, 160, R), -90);
    const end = pts[pts.length - 1];
    return [arc(pts), ln(end, [end[0], 0.36]), dot(end[0], 0)];
  },
  '.': () => [dot(0, 0)],
  ',': () => [ln([0.06, 0.04], [0, -0.18])],
  "'": () => [ln([0, 1], [0, 0.7])],
  '"': () => [ln([0, 1], [0, 0.7]), ln([0.22, 1], [0.22, 0.7])],
  '-': () => [ln([0, 0.42], [0.36, 0.42])],
  ':': () => [dot(0, XHU), dot(0, 0)],
  ';': () => [dot(0.06, XHU), ln([0.06, 0.04], [0, -0.18])],
  '+': () => [ln([0, 0.4], [0.52, 0.4]), ln([0.26, 0.66], [0.26, 0.14])],
  '=': () => [ln([0, 0.6], [0.5, 0.6]), ln([0, 0.24], [0.5, 0.24])],
  '#': () => [ln([0.22, 1], [0.14, 0]), ln([0.52, 1], [0.44, 0]), ln([0, 0.68], [0.66, 0.68]), ln([0, 0.32], [0.66, 0.32])],
  '&': ({ R }) => {
    // Small top loop; a big lower bowl reached by a diagonal from the loop's lower right; a leg from
    // the loop's lower left kicking out to the bottom right, crossing the bowl near its right side.
    const top = box(0.1, 0.5, 0.62, 1, R), low = box(0, 0, 0.66, 0.6, R);
    const aLeg = 205, aBowl = -40;
    const legStart = boxPt(top, aLeg), bowlStart = boxPt(top, aBowl);
    return [
      mk('loop', boxLoop(top, 270, [aLeg, aBowl]), circleOf(top)),
      ln(legStart, [0.88, 0]),
      arc([bowlStart, ...boxArc(low, 145, 385)]),
    ];
  },
};

/** An S: upper box arc from the top-right terminal round to the middle, then the lower box down to the bottom-left terminal. */
function sShape(x0u: number, x1u: number, x1l: number, ym: number, top: number, R: number): Stroke[] {
  // Both boxes share a centre line so the spine is continuous; the lower one is a little wider.
  const cx = (x0u + x1u) / 2;
  const up = box(x0u, ym, x1u, top, R), lo = box(cx - (x1l - cx), 0, x1l, ym, R);
  // Terminals stop short of the corners even when square: little hooks that tell S from 5.
  const t = lerp(34, 32, R);
  const a = boxArc(up, t, 270), b = boxArc(lo, 90, -180 + t);
  return [arc([...a, ...b.slice(1)])];
}
