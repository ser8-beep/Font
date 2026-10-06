import { verticalRange } from './core/alphabet';
import type { Mask, RGBAImage } from './core/image';
import { cleanLetter, type CleanCache, type CleanResult } from './core/segment';
import { CAP_HEIGHT, contoursToSvg, maskToGlyph, type GlyphOutline } from './core/trace';
import { buildTTF, type FontGlyph } from './core/ttf';
import type { Letter, Photo } from './state';

/** Where a letter's colourful picture comes from. */
export type Picture =
  /** A letter the kid made: cut out of their photo along the cleaned letter shape. */
  | { kind: 'photo'; photo: Photo; clean: CleanResult; letter: Letter }
  /** A grown letter: the material painting, already cropped to outline.source (straight RGBA). */
  | { kind: 'art'; image: RGBAImage };

export interface LetterGlyph {
  /** Unique per look: changes whenever the outline or picture would change. */
  id: string;
  char: string;
  outline: GlyphOutline;
  /** SVG path data, font units, y up. */
  svg: string;
  /** Grown by the app (false = the kid made it and photographed it). */
  generated: boolean;
  picture: Picture;
}

const distCache = new Map<string, CleanCache>();
const glyphCache = new Map<string, LetterGlyph | null>();
const materialCache = new Map<string, string>();

const key = (l: Letter) => `${l.id}|${l.rev}|${l.bolder.toFixed(3)}|${l.fillHoles ? 1 : 0}|${l.char ?? ''}`;

export function letterGlyph(letter: Letter, photo: Photo): LetterGlyph | null {
  const k = key(letter);
  if (glyphCache.has(k)) return glyphCache.get(k)!;
  const ck = `${letter.id}|${letter.rev}`;
  let cache = distCache.get(ck);
  if (!cache) distCache.set(ck, (cache = {}));
  const clean = cleanLetter(photo.image, photo.analysis, letter.region, { bolder: letter.bolder, fillHoles: letter.fillHoles }, cache);
  const char = letter.char ?? '?';
  // Small letters keep their shape: p and y hang below the line, a and o are shorter than l.
  const outline = maskToGlyph(clean.mask, verticalRange(char));
  const g: LetterGlyph | null = outline
    ? { id: k, char, outline, svg: contoursToSvg(outline.contours), generated: false, picture: { kind: 'photo', photo, clean, letter } }
    : null;
  if (glyphCache.size > 400) glyphCache.clear();
  glyphCache.set(k, g);
  return g;
}

/** The letters the kid made: one glyph per character (case kept), newest letter wins. */
export function glyphMap(letters: Letter[], photos: Photo[]): Map<string, LetterGlyph> {
  const map = new Map<string, LetterGlyph>();
  for (const l of letters) {
    if (!l.char) continue;
    const p = photos.find((ph) => ph.id === l.photoId);
    if (!p) continue;
    const g = letterGlyph(l, p);
    if (g) map.set(l.char, g);
  }
  return map;
}

/** 'a' <-> 'A'; anything without a case comes back unchanged. */
export function otherCase(ch: string): string {
  const up = ch.toUpperCase();
  return up !== ch ? up : ch.toLowerCase();
}

/** The glyph to draw for a typed character: the exact one, else the same letter in the other case. */
export function lookup(map: Map<string, LetterGlyph>, ch: string): LetterGlyph | null {
  return map.get(ch) ?? map.get(otherCase(ch)) ?? null;
}

/** Which cases the kid photographed. */
export function casesOf(chars: Iterable<string>): { upper: boolean; lower: boolean } {
  let upper = false, lower = false;
  for (const c of chars) {
    if (/^[A-Z]$/.test(c)) upper = true;
    if (/^[a-z]$/.test(c)) lower = true;
  }
  return { upper, lower };
}

/** The letter's material picture as a PNG data URL, sized to outline.source. Browser only. */
export function materialImage(g: LetterGlyph): string {
  const hit = materialCache.get(g.id);
  if (hit) return hit;
  const src = g.outline.source;
  const canvas = document.createElement('canvas');
  canvas.width = src.w;
  canvas.height = src.h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(src.w, src.h);
  if (g.picture.kind === 'art') {
    img.data.set(g.picture.image.data.subarray(0, src.w * src.h * 4));
  } else {
    const { clean, photo } = g.picture;
    const soft = softAlpha(clean.mask, src.x, src.y, src.w, src.h);
    for (let y = 0; y < src.h; y++) {
      const py = clean.box.y + src.y + y;
      for (let x = 0; x < src.w; x++) {
        const px = clean.box.x + src.x + x;
        const s = (py * photo.image.width + px) * 4;
        const o = (y * src.w + x) * 4;
        img.data[o] = photo.image.data[s];
        img.data[o + 1] = photo.image.data[s + 1];
        img.data[o + 2] = photo.image.data[s + 2];
        img.data[o + 3] = soft[y * src.w + x];
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL('image/png');
  if (materialCache.size > 300) materialCache.delete(materialCache.keys().next().value!);
  materialCache.set(g.id, url);
  return url;
}

function softAlpha(m: Mask, x0: number, y0: number, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + x0 + dx, yy = y + y0 + dy;
        if (xx >= 0 && yy >= 0 && xx < m.width && yy < m.height) s += m.data[yy * m.width + xx];
      }
      out[y * w + x] = (s / 9) * 255;
    }
  }
  return out;
}

// ---------- text layout ----------

export const SPACE = 300;
export const PLACEHOLDER = 520;
/** Baseline to baseline. Ink spans at most [-210, 700], so lines never touch. */
export const LINE = 1050;

export interface Placed {
  ch: string;
  x: number;
  line: number;
  glyph: LetterGlyph | null;
  advance: number;
}

export interface Layout {
  items: Placed[];
  lines: number;
  width: number;
  /** Highest ink above the baseline (at least the capital height), font units. */
  top: number;
  /** Lowest ink: 0, or below 0 when a letter has a tail (g, p, y...). */
  bottom: number;
}

export function layoutText(text: string, map: Map<string, LetterGlyph>, maxWidth = Infinity): Layout {
  const items: Placed[] = [];
  let line = 0, x = 0, width = 0, top = CAP_HEIGHT, bottom = 0;
  const adv = (ch: string) => {
    if (ch === ' ') return SPACE;
    const g = lookup(map, ch);
    return g ? g.outline.advance : PLACEHOLDER;
  };
  for (const raw of text.split('\n')) {
    // Greedy word wrap.
    const words = raw.split(/( )/);
    for (const word of words) {
      const w = [...word].reduce((s, ch) => s + adv(ch), 0);
      if (x > 0 && x + w > maxWidth && word !== ' ') { line++; x = 0; }
      if (x === 0 && word === ' ') continue;
      for (const ch of word) {
        const a = adv(ch);
        const glyph = ch === ' ' ? null : lookup(map, ch);
        if (glyph) {
          top = Math.max(top, glyph.outline.top);
          bottom = Math.min(bottom, glyph.outline.bottom);
        }
        items.push({ ch, x, line, glyph, advance: a });
        x += a;
      }
      width = Math.max(width, x);
    }
    line++;
    x = 0;
  }
  return { items, lines: Math.max(1, line), width, top, bottom };
}

export { CAP_HEIGHT };

// ---------- the .ttf ----------

/**
 * Every letter the font has, made or grown. A letter also answers for its other case when the
 * font has nothing of its own there, so a capitals-only font types capitals for small keys.
 */
export function fontGlyphs(map: Map<string, LetterGlyph>): FontGlyph[] {
  const glyphs: FontGlyph[] = [];
  for (const [ch, g] of map) {
    const cps = [ch.codePointAt(0)!];
    const other = otherCase(ch);
    if (other !== ch && [...other].length === 1 && !map.has(other)) cps.push(other.codePointAt(0)!);
    glyphs.push({ codepoints: cps, contours: g.outline.contours, advance: g.outline.advance });
  }
  return glyphs;
}

export function buildFont(map: Map<string, LetterGlyph>, name: string, maker: string): Uint8Array {
  return buildTTF({ familyName: name, designer: maker, glyphs: fontGlyphs(map) });
}

export function safeFileName(name: string): string {
  return (name.trim() || 'my-font').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').slice(0, 60);
}
