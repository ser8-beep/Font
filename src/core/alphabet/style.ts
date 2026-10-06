import { buildOf } from './category';
import { fitGeometry } from './fit';
import { extractFlat } from './materials/flat';
import { detectGrid, gridFromPool, type GridMaterial } from './materials/grid';
import { extractPieces, type PiecesMaterial } from './materials/pieces';
import { extractStrokes } from './materials/strokes';
import { measureSample } from './measure';
import type { Material, MaterialProfile, Measure, StyleProfile, StyleSample } from './types';

/** Learn the kid's style from their captured letters. */
export function analyseStyle(samples: StyleSample[]): StyleProfile {
  if (!samples.length) throw new Error('analyseStyle needs at least one captured letter');
  const measures = samples.map(measureSample);
  const geometry = fitGeometry(samples, measures);
  const materials = samples.map((s, i) => profileMaterial(s, measures[i]));
  harmonise(materials, samples);
  for (const m of materials) m.build = buildOf(m);
  const heights = measures.map((m) => m.heightPx).sort((a, b) => a - b);
  const weights = materials.map((m) => m.weight).sort((a, b) => a - b);
  const w = weights[weights.length >> 1];
  // Render near the photo's own scale (materials look right), within limits that stay fast.
  const letterPx = Math.min(300, Math.max(150, heights[heights.length >> 1]));
  const wobbles = measures.map((m) => m.wobble).sort((a, b) => a - b);
  return {
    geometry,
    materials,
    pxPerUnit: letterPx * (1 - w),
    wobble: Math.min(0.03, wobbles[wobbles.length >> 1] ?? 0),
  };
}

/**
 * Letters of one photo are usually built the same way. When most are Lego, a letter the grid
 * detector missed (a thin L of single bricks) is built from bricks too; when most are pieces, a
 * porous letter that was not recognised borrows its neighbours' pieces.
 */
function harmonise(materials: MaterialProfile[], samples: StyleSample[]) {
  const grids = materials.map((m) => m.material).filter((m): m is GridMaterial => m.kind === 'grid');
  const pieces = materials.map((m) => m.material).filter((m): m is PiecesMaterial => m.kind === 'pieces');
  materials.forEach((mp, i) => {
    if (mp.material.kind === 'grid' || mp.material.kind === 'pieces') return;
    if (grids.length * 2 >= materials.length) {
      const g = gridFromPool(grids, mp.colour);
      if (g) mp.material = g;
    } else if (pieces.length * 2 >= materials.length && samples[i].porous) {
      mp.material = pieces[i % pieces.length];
    }
  });
}

export function profileMaterial(s: StyleSample, m: Measure): MaterialProfile {
  let material: Material | null = detectGrid(s, m);
  if (!material && s.porous) material = extractPieces(s, m);
  if (!material) material = extractStrokes(s, m);
  if (!material) material = extractFlat(s, m);
  return {
    source: s.char,
    weight: Math.min(0.4, Math.max(0.03, m.strokePx / Math.max(1, m.heightPx))),
    colour: m.colour,
    fillGaps: s.porous,
    fillRadius: s.porous ? s.fillRadius / Math.max(1, m.heightPx) : 0,
    material,
    build: 'single',
  };
}
