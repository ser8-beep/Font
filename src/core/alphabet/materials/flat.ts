import { makeMask } from '../../image';
import type { StrokeField } from '../field';
import type { GeneratedArt, Measure, StyleSample } from '../types';

// Fallback material: the letter's average colour with soft rounded shading.
// Used when no richer material could be learned from the photo.

export interface FlatMaterial {
  kind: 'flat';
  colour: [number, number, number];
}

export function extractFlat(_sample: StyleSample, m: Measure): FlatMaterial {
  return { kind: 'flat', colour: m.colour };
}

export function renderFlat(f: StrokeField, mat: FlatMaterial): GeneratedArt {
  const n = f.width * f.height;
  const data = new Uint8ClampedArray(n * 4);
  const mask = makeMask(f.width, f.height);
  const [r, g, b] = mat.colour;
  for (let i = 0; i < n; i++) {
    const c = f.coverage[i];
    if (c <= 0) continue;
    // Darker towards the edge, like a rounded sausage of clay.
    const t = Math.min(1, f.dist[i] / Math.max(1, f.halfWidth));
    const shade = 1 - 0.28 * t * t;
    data[i * 4] = r * shade;
    data[i * 4 + 1] = g * shade;
    data[i * 4 + 2] = b * shade;
    data[i * 4 + 3] = c * 255;
    mask.data[i] = c >= 0.5 ? 1 : 0;
  }
  return { image: { width: f.width, height: f.height, data }, mask };
}
