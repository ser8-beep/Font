import type { GeneratedArt, MaterialProfile, StyleProfile } from './core/alphabet';
import { cropImage, type RGBAImage } from './core/image';
import { contoursToSvg, maskToGlyph, type GlyphOutline } from './core/trace';

/** A grown character as it travels from the worker: plain data only. */
export interface GrownData {
  outline: GlyphOutline;
  svg: string;
  /** The material painting cropped to outline.source (straight RGBA). */
  image: RGBAImage;
}

/**
 * Paint one character and trace it. The functions are passed in so this file stays free of the
 * heavy imports (the worker and the main-thread fallback both use it).
 */
export function grownGlyph(
  ch: string,
  style: StyleProfile,
  seed: number,
  category: string | undefined,
  render: (ch: string, style: StyleProfile, seed: number, category?: string) => GeneratedArt | null,
  material: (ch: string, style: StyleProfile, seed: number, category?: string) => MaterialProfile,
  range: (ch: string, weight?: number) => [number, number],
): GrownData | null {
  const art = render(ch, style, seed, category);
  if (!art) return null;
  const outline = maskToGlyph(art.mask, range(ch, material(ch, style, seed, category).weight));
  if (!outline) return null;
  return { outline, svg: contoursToSvg(outline.contours), image: cropImage(art.image, outline.source) };
}
