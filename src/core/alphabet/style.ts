import { buildOf } from './category';
import { extractFlat } from './materials/flat';
import { detectGrid, gridFromPool, type GridMaterial } from './materials/grid';
import { extractPieces, type PiecesMaterial } from './materials/pieces';
import { extractStrokes } from './materials/strokes';
import { measureSample } from './measure';
import type { Material, MaterialProfile, Measure, StyleProfile, StyleSample } from './types';

/** What the kid's captured letters are made of (one profile per letter). */
export function analyseStyle(samples: StyleSample[]): StyleProfile {
  if (!samples.length) throw new Error('analyseStyle needs at least one captured letter');
  const measures = samples.map(measureSample);
  const materials = samples.map((s, i) => profileMaterial(s, measures[i]));
  harmonise(materials, samples);
  for (const m of materials) m.build = buildOf(m);
  return { materials };
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
