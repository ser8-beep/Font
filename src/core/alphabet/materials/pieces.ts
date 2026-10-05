import type { StrokeField } from '../field';
import type { GeneratedArt, Measure, Rng, StyleSample } from '../types';

// Separate pieces: coffee beans, buttons, gummy bears, pasta, pom-poms.
// STUB: extraction always fails, so the flat fallback is used. To be implemented.

export interface PiecesMaterial {
  kind: 'pieces';
}

export function extractPieces(_sample: StyleSample, _m: Measure): PiecesMaterial | null {
  return null;
}

/** relPx: pixels per rel unit at the target size (the target letter's height in px). */
export function renderPieces(_f: StrokeField, _mat: PiecesMaterial, _relPx: number, _rng: Rng): GeneratedArt {
  throw new Error('renderPieces not implemented');
}
