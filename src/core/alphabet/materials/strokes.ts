import type { StrokeField } from '../field';
import type { GeneratedArt, Measure, Rng, StyleSample } from '../types';

// Letters built from a few whole objects or continuous lengths of stuff: markers, pencils, books,
// wafers, carabiners, chains, straws, rope, clay sausages, wool, honey. Each part of the captured
// letter (between joints and corners) is cut out along its centreline and re-used whole - ends
// included - for the strokes of new letters. Round parts (tape rolls, biscuits, cans, an orange)
// can fill bowls and loops.
// STUB: extraction always fails, so the flat fallback is used. To be implemented.

export interface StrokesMaterial {
  kind: 'strokes';
}

export function extractStrokes(_sample: StyleSample, _m: Measure): StrokesMaterial | null {
  return null;
}

/**
 * relPx: pixels per rel unit at the target size (the target letter's height in px).
 * pool: every strokes material learned from this photo (including mat), for borrowing a part
 * mat lacks (e.g. a round part for a bowl when this letter only had straight sticks).
 */
export function renderStrokes(_f: StrokeField, _mat: StrokesMaterial, _relPx: number, _rng: Rng, _pool: StrokesMaterial[]): GeneratedArt {
  throw new Error('renderStrokes not implemented');
}
