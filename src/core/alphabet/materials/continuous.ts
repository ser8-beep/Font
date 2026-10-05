import type { StrokeField } from '../field';
import type { GeneratedArt, Measure, Rng, StyleSample } from '../types';

// One continuous material: clay, wool, honey, straws, pipe cleaners, paint.
// STUB: extraction always fails. To be implemented.

export interface ContinuousMaterial {
  kind: 'continuous';
}

export function extractContinuous(_sample: StyleSample, _m: Measure): ContinuousMaterial | null {
  return null;
}

/** relPx: pixels per rel unit at the target size (the target letter's height in px). */
export function renderContinuous(_f: StrokeField, _mat: ContinuousMaterial, _relPx: number, _rng: Rng): GeneratedArt {
  throw new Error('renderContinuous not implemented');
}
