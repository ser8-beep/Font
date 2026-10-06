import { closePadded, fillHoles, keepBig } from '../mask';
import { buildFor, type Build } from './category';
import { buildField } from './field';
import { renderFlat } from './materials/flat';
import { renderGrid, type GridMaterial } from './materials/grid';
import { renderPieces, type PiecesMaterial } from './materials/pieces';
import { renderStrokes, type StrokesMaterial } from './materials/strokes';
import { hashString, makeRng } from './rng';
import { skeletonFor } from './skeletons';
import type { GeneratedArt, MaterialProfile, P2, Rng, Skeleton, StyleProfile } from './types';

const ORDER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** If the photo has no letter built the wanted way, the next best ways, in order. */
const NEXT_BEST: Record<Build, Build[]> = {
  single: ['single', 'composite', 'repeated', 'formed'],
  composite: ['composite', 'single', 'repeated', 'formed'],
  repeated: ['repeated', 'composite', 'formed', 'single'],
  formed: ['formed', 'repeated', 'composite', 'single'],
};

/**
 * Which captured letter's material a generated character borrows. Changes with the seed. With a
 * category, the character is built the way makers in that category built it (see category.ts),
 * using a captured letter built the same way when the photo has one.
 */
export function materialFor(ch: string, style: StyleProfile, seed: number, category?: string): MaterialProfile {
  const i = ORDER.indexOf(ch.toUpperCase());
  const base = i >= 0 ? i : hashString(ch);
  let from = style.materials;
  if (category) {
    const want = buildFor(ch, category, seed);
    for (const b of NEXT_BEST[want]) {
      const ms = style.materials.filter((m) => m.build === b);
      if (ms.length) {
        from = ms;
        break;
      }
    }
  }
  return from[(base + seed) % from.length];
}

/**
 * Paint one character in the kid's style. Null if there is no drawing for it. With a category
 * (from the object-type repository), the letter is built the way that category's makers built it:
 * one object, a mix of objects, copies of one object, or bent stuff.
 */
export function renderLetter(ch: string, style: StyleProfile, seed = 0, category?: string): GeneratedArt | null {
  const sk = skeletonFor(ch, style.geometry);
  if (!sk || !sk.strokes.length) return null;
  const mp = materialFor(ch, style, seed, category);
  const build: Build | undefined = category ? buildFor(ch, category, seed) : undefined;
  const rng = makeRng(hashString(ch) ^ Math.imul(seed + 1, 0x9e3779b1));
  const ppu = style.pxPerUnit;
  const w = Math.min(0.4, Math.max(0.03, mp.weight));
  // Stroke = weight x letter height, and letter height = ppu + stroke.
  const halfWidth = (w * ppu) / (2 * (1 - w));
  const relPx = ppu + 2 * halfWidth;
  const field = buildField(wobble(sk, style.wobble, rng), { pxPerUnit: ppu, halfWidth, margin: Math.ceil(halfWidth * 0.7 + 8) });

  let art: GeneratedArt;
  try {
    const m = mp.material;
    const pool = <T extends { kind: string }>(kind: T['kind']) => style.materials.map((x) => x.material).filter((x): x is T & typeof x => x.kind === kind);
    art =
      // Bent stuff in a row: pieces go single file along the strokes, like beads on a wire.
      m.kind === 'pieces' ? renderPieces(field, build === 'formed' && !m.single ? { ...m, single: true } : m, relPx, rng, pool<PiecesMaterial>('pieces'))
      : m.kind === 'grid' ? renderGrid(field, m, relPx, rng, pool<GridMaterial>('grid'))
      : m.kind === 'strokes' ? renderStrokes(field, m, relPx, rng, pool<StrokesMaterial>('strokes'), build)
      : renderFlat(field, m);
  } catch (e) {
    console.warn(`material renderer failed for ${ch}, using flat colour`, e);
    art = renderFlat(field, { kind: 'flat', colour: mp.colour });
  }

  if (mp.fillGaps && mp.fillRadius > 0) {
    let mask = closePadded(art.mask, mp.fillRadius * relPx);
    mask = fillHoles(mask, mask.width * mask.height * 0.012);
    art = { ...art, mask: keepBig(mask, 0.06) };
  }
  return art;
}

/** Hand-made wobble: smooth sideways drift along each stroke, pinned at the stroke ends. */
function wobble(sk: Skeleton, amp: number, rng: Rng): Skeleton {
  if (amp <= 0) return sk;
  return {
    strokes: sk.strokes.map((s) => {
      if (s.points.length < 2) return s;
      const pts = resample(s.points, 0.025);
      const L = pts.length - 1;
      const p1 = rng() * Math.PI * 2, p2 = rng() * Math.PI * 2;
      const out = pts.map((p, i): P2 => {
        if (i === 0 || i === L) return p;
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(L, i + 1)];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy) || 1;
        const t = i / L;
        const s0 = i * 0.025;
        const off = amp * Math.sin(Math.PI * t) * (0.65 * Math.sin(s0 * 9 + p1) + 0.35 * Math.sin(s0 * 21 + p2));
        return [p[0] - (dy / len) * off, p[1] + (dx / len) * off];
      });
      return { ...s, points: out };
    }),
  };
}

function resample(pts: P2[], step: number): P2[] {
  const out: P2[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}
