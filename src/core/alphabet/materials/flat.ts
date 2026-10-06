import type { Measure, StyleSample } from '../types';

// Fallback material: the letter's average colour with soft rounded shading.
// Used when no richer material could be learned from the photo.

export interface FlatMaterial {
  kind: 'flat';
  colour: [number, number, number];
}

export function extractFlat(_sample: StyleSample, m: Measure): FlatMaterial {
  return { kind: 'flat', colour: m.colour };
}

