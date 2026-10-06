// Shared types for reading the letters a kid photographed.
//
//   captured letters (StyleSample[])
//     -> measure each (measure.ts)          stroke width, medial-axis paths, colour
//     -> profile each letter's material     grid | pieces | strokes | flat (materials/*)
//   = StyleProfile, which category.ts matches to the object-type repository.
//
// Pixels: x right, y DOWN, as in every image in this codebase. Material measurements are stored
// relative to the source letter's height ("rel" units: 1 = the height of the letter).

import type { Mask, RGBAImage } from '../image';
import type { FlatMaterial } from './materials/flat';
import type { GridMaterial } from './materials/grid';
import type { PiecesMaterial } from './materials/pieces';
import type { StrokesMaterial } from './materials/strokes';

export type P2 = [number, number];

/** One captured letter, ready for style analysis. All images share the same pixel grid. */
export interface StyleSample {
  /** The character as captured ('P' or 'p'). */
  char: string;
  /** Photo crop around the letter. */
  image: RGBAImage;
  /** Cleaned letter mask (0/1), same size as image. This is what the font outline was traced from. */
  mask: Mask;
  /** Thresholded mask before closing and gap filling: separate beans / buttons stay separate. */
  raw: Mask;
  /** The letter is made of separate pieces ("fill the gaps" was on). */
  porous: boolean;
  /** Closing radius (px, this sample's scale) used to fuse pieces when filling gaps; 0 if not porous. */
  fillRadius: number;
}

/** Measurements of one captured letter (pixels at the sample's scale unless noted). */
export interface Measure {
  /** Height of the letter's ink bounds, px. */
  heightPx: number;
  /** Width of the letter's ink bounds, px. */
  widthPx: number;
  /** Ink bounds within the sample, px. */
  bounds: { x: number; y: number; w: number; h: number };
  /** Typical stroke thickness, px (median of 2 x distance-to-edge along the medial axis). */
  strokePx: number;
  /** Euclidean distance from each ink pixel to the nearest background pixel (0 outside). */
  dist: Float32Array;
  /** Medial-axis paths, px, ordered along the stroke, each point 1-2 px apart. */
  paths: SkeletonPath[];
  /** Lean of near-vertical strokes: dx/dy (positive leans right), 0 if none. */
  slant: number;
  /** Typical sideways wander of the stroke centreline, in rel units (fraction of letter height). */
  wobble: number;
  /** Average colour of the ink pixels. */
  colour: [number, number, number];
}

export interface SkeletonPath {
  /** Points in px (x right, y down). */
  points: P2[];
  /** Distance to edge at each point, px (half the local stroke width). */
  radius: number[];
}

export type Material = PiecesMaterial | GridMaterial | StrokesMaterial | FlatMaterial;

/** The look of one captured letter, reusable to paint any other letter. */
export interface MaterialProfile {
  /** Which captured character this came from. */
  source: string;
  /** Stroke thickness / letter height of the source letter. */
  weight: number;
  /** Average ink colour. */
  colour: [number, number, number];
  /** Fuse pieces when making the font outline (same as "fill the gaps"). */
  fillGaps: boolean;
  /** Closing radius for fillGaps, rel units. */
  fillRadius: number;
  material: Material;
  /** How the source letter is built, in the object-type repository's words (see category.ts). */
  build: 'single' | 'composite' | 'repeated' | 'formed';
}

export interface StyleProfile {
  /** One per captured letter, in capture order. */
  materials: MaterialProfile[];
}

