import type { StrokeField } from '../field';
import type { GeneratedArt, Measure, Rng, StyleSample } from '../types';

// Blocks on a grid: Lego bricks, square tiles, pixel art.
// STUB: detection always fails. To be implemented.

export interface GridMaterial {
  kind: 'grid';
}

export function detectGrid(_sample: StyleSample, _m: Measure): GridMaterial | null {
  return null;
}

/** relPx: pixels per rel unit at the target size (the target letter's height in px). */
export function renderGrid(_f: StrokeField, _mat: GridMaterial, _relPx: number, _rng: Rng): GeneratedArt {
  throw new Error('renderGrid not implemented');
}
