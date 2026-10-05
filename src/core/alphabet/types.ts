// Shared types for growing a whole alphabet from the few letters a kid photographed.
//
// Pipeline:
//   captured letters (StyleSample[])
//     -> measure each (measure.ts)          stroke width, skeleton paths, slant, wobble
//     -> fit letter geometry (fit.ts)       how wide / slanted / where bars and bowls sit
//     -> profile each letter's material     pieces | grid | continuous | flat (materials/*)
//   = StyleProfile
//   renderLetter(char, style, seed)
//     -> skeleton for char (skeletons.ts) with the fitted geometry
//     -> rasterised stroke field (field.ts)
//     -> material renderer paints it       -> GeneratedArt (RGBA picture + ink mask)
//
// Coordinate systems:
//   - Skeleton units: x right, y UP, baseline y = 0, cap height y = 1, x-height 0.7,
//     descender y = -0.3. Strokes are centrelines; stroke thickness is added at render time.
//   - Pixels: x right, y DOWN, as in every image in this codebase.
//   - Material measurements are stored relative to the source letter's height ("rel" units:
//     1 = the height of the letter they were measured on) so they scale to any render size.

import type { Mask, RGBAImage } from '../image';
import type { ContinuousMaterial } from './materials/continuous';
import type { FlatMaterial } from './materials/flat';
import type { GridMaterial } from './materials/grid';
import type { PiecesMaterial } from './materials/pieces';

export type P2 = [number, number];

/** An open polyline in skeleton units. A closed loop repeats its first point at the end. A single point is a dot. */
export interface Stroke {
  points: P2[];
}

export interface Skeleton {
  strokes: Stroke[];
}

/** Letter-shape settings shared by the whole alphabet, fitted to the captured letters. */
export interface GeometryParams {
  /** Horizontal scale (1 = reference proportions). */
  width: number;
  /** Shear applied after width scaling: x += slant * y. Positive leans right. */
  slant: number;
  /** Added to the height (skeleton units) where bowls join stems: P, B, R and similar. */
  bowl: number;
  /** Added to crossbar heights: A, H, E, F, e, t and similar. */
  bar: number;
  /** Added to junction heights where arms meet: Y, K, X, k, y and similar. */
  fork: number;
  /** 0 = square corners on bowls and round letters (blocky), 1 = fully round. */
  round: number;
}

export const DEFAULT_GEOMETRY: GeometryParams = { width: 1, slant: 0, bowl: 0, bar: 0, fork: 0, round: 1 };

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

export type Material = PiecesMaterial | GridMaterial | ContinuousMaterial | FlatMaterial;

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
}

export interface StyleProfile {
  geometry: GeometryParams;
  /** One per captured letter, in capture order. Generated letters cycle through them. */
  materials: MaterialProfile[];
  /** Render scale: pixels per skeleton unit (about the captured letters' height). */
  pxPerUnit: number;
  /** Centreline wobble amplitude, skeleton units. */
  wobble: number;
}

/** A generated letter: a picture made of the kid's material, plus the ink mask for the font. */
export interface GeneratedArt {
  /** Straight (not premultiplied) RGBA; alpha = how much material covers the pixel. */
  image: RGBAImage;
  /** 0/1 ink mask on the same grid, already gap-filled when the material needs it. Trace this. */
  mask: Mask;
}

/** Deterministic random numbers in [0, 1). */
export type Rng = () => number;
