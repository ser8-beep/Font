import type { GlyphPicture } from './colourfont';
import type { RGBAImage } from './image';
import { encodePNG, resampleRGBA } from './png';
import type { GlyphOutline } from './trace';

/**
 * Picture sizes stored in the font, in pixels per em. The small one suits Android/Windows (their
 * format can't go much bigger) and small text; the big one keeps posters and headings sharp.
 */
export const PICTURE_SIZES = [128, 256];

/**
 * The letter's photo as font pictures. `img` is the material cut-out (straight alpha) covering
 * outline.source, which the outline maps onto [lsb, lsb+inkWidth] x [bottom, top].
 */
export function glyphPicture(img: RGBAImage, o: GlyphOutline, sizes = PICTURE_SIZES): Omit<GlyphPicture, 'advance' | 'outlineMin'> {
  const h = o.top - o.bottom;
  return {
    x: o.lsb,
    y: o.bottom,
    w: o.inkWidth,
    h,
    strikes: sizes.map((ppem) => {
      const width = Math.max(1, Math.round((o.inkWidth * ppem) / 1000));
      const height = Math.max(1, Math.round((h * ppem) / 1000));
      return { ppem, png: encodePNG(resampleRGBA(img, width, height)), width, height };
    }),
  };
}
