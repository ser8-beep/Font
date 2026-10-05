import { DEFAULT_GEOMETRY, type GeometryParams, type Measure, type StyleSample } from './types';

// Fit the shared letter geometry (width, slant, bar / bowl / fork heights, roundness) to the
// captured letters. STUB: returns the defaults. To be implemented.

export function fitGeometry(_samples: StyleSample[], _measures: Measure[]): GeometryParams {
  return { ...DEFAULT_GEOMETRY };
}
