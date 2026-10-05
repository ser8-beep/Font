import type { GeometryParams, P2, Skeleton, Stroke } from './types';

// Centreline drawings of every character the station can grow, in skeleton units
// (x right, y up, baseline 0, cap height 1, x-height X_HEIGHT, descender DESCENDER).
// GeometryParams bend them toward the kid's hand: wider, slanted, bars lower, corners square...
//
// STUB: only a few letters so the rest of the pipeline can run. To be replaced by the full set.

export const X_HEIGHT = 0.7;
export const DESCENDER = -0.3;

/** Font-unit vertical extents (bottom, top) a glyph's ink is fitted to. Cap height = 700. */
const CAP = 700, XH = 490, DESC = -210;

export function verticalRange(ch: string): [number, number] {
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
    default: return [0, CAP]; // ! ? & + = # @ and anything else cap-height
  }
}

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const PUNCT = "!?.,'-&";

/** Characters to grow for a font whose captured letters include these cases. */
export function alphabetChars(cases: { upper: boolean; lower: boolean }): string[] {
  return [...(cases.upper || !cases.lower ? UPPER : ''), ...(cases.lower ? LOWER : ''), ...DIGITS, ...PUNCT];
}

/** Every character skeletonFor can draw. */
export function supportedChars(): string {
  return Object.keys(DRAW).join('');
}

// ---------- helpers ----------

const line = (x0: number, y0: number, x1: number, y1: number): Stroke => ({ points: [[x0, y0], [x1, y1]] });
const poly = (...pts: P2[]): Stroke => ({ points: pts });
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, steps = 24): Stroke {
  const pts: P2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return { points: pts };
}
const D = Math.PI / 180;

type Draw = (g: GeometryParams) => Stroke[];

const DRAW: Record<string, Draw> = {
  P: (g) => {
    const j = 0.5 + g.bowl;
    const r = (1 - j) / 2;
    return [line(0, 0, 0, 1), poly([0, 1], [0.32, 1]), arc(0.32, 1 - r, r, r, 90 * D, -90 * D), poly([0.32, j], [0, j])];
  },
  L: () => [poly([0, 1], [0, 0], [0.52, 0])],
  A: (g) => {
    const y = 0.33 + g.bar;
    return [poly([0, 0], [0.34, 1], [0.68, 0]), line(0.34 * (y / 1) * 0 + 0.34 * y, y, 0.68 - 0.34 * y, y)];
  },
  Y: (g) => {
    const j = 0.48 + g.fork;
    return [line(0, 1, 0.34, j), line(0.68, 1, 0.34, j), line(0.34, j, 0.34, 0)];
  },
  O: () => [arc(0.36, 0.5, 0.36, 0.5, 0, 2 * Math.PI, 48)],
  I: () => [line(0, 0, 0, 1)],
};

export function skeletonFor(ch: string, g: GeometryParams): Skeleton | null {
  const draw = DRAW[ch] ?? DRAW[ch.toUpperCase()];
  if (!draw) return null;
  const strokes = draw(g).map((s) => ({ points: s.points.map(([x, y]) => [x * g.width + g.slant * y, y] as P2) }));
  return { strokes };
}
