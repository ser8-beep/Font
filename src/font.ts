import type { Mask } from './core/image';
import { cleanLetter, type CleanCache, type CleanResult } from './core/segment';
import { CAP_HEIGHT, contoursToSvg, maskToGlyph, type GlyphOutline } from './core/trace';
import { buildTTF, type FontGlyph } from './core/ttf';
import type { Letter, Photo } from './state';

export interface LetterGlyph {
  letterId: string;
  char: string;
  outline: GlyphOutline;
  /** SVG path data, font units, y up. */
  svg: string;
  clean: CleanResult;
  photo: Photo;
}

const distCache = new Map<string, CleanCache>();
const glyphCache = new Map<string, LetterGlyph | null>();
const materialCache = new Map<string, string>();

const key = (l: Letter) => `${l.id}|${l.rev}|${l.bolder.toFixed(3)}|${l.fillHoles ? 1 : 0}`;

export function letterGlyph(letter: Letter, photo: Photo): LetterGlyph | null {
  const k = key(letter);
  if (glyphCache.has(k)) return glyphCache.get(k)!;
  const ck = `${letter.id}|${letter.rev}`;
  let cache = distCache.get(ck);
  if (!cache) distCache.set(ck, (cache = {}));
  const clean = cleanLetter(photo.image, photo.analysis, letter.region, { bolder: letter.bolder, fillHoles: letter.fillHoles }, cache);
  const outline = maskToGlyph(clean.mask);
  const g = outline ? { letterId: letter.id, char: letter.char ?? '?', outline, svg: contoursToSvg(outline.contours), clean, photo } : null;
  if (glyphCache.size > 400) glyphCache.clear();
  glyphCache.set(k, g);
  return g;
}

/** The font so far: one glyph per character, newest letter wins. */
export function glyphMap(letters: Letter[], photos: Photo[]): Map<string, LetterGlyph> {
  const map = new Map<string, LetterGlyph>();
  for (const l of letters) {
    if (!l.char) continue;
    const p = photos.find((ph) => ph.id === l.photoId);
    if (!p) continue;
    const g = letterGlyph(l, p);
    if (g) map.set(l.char, { ...g, char: l.char });
  }
  return map;
}

/** The cropped photo, cut out along the cleaned letter shape, as a PNG data URL. */
export function materialImage(g: LetterGlyph): string {
  const k = `${g.letterId}|${g.svg.length}|${g.clean.box.x},${g.clean.box.y}|${g.outline.source.w}x${g.outline.source.h}`;
  const hit = materialCache.get(k);
  if (hit) return hit;
  const { clean, outline, photo } = g;
  const src = outline.source;
  const canvas = document.createElement('canvas');
  canvas.width = src.w;
  canvas.height = src.h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(src.w, src.h);
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
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL('image/png');
  if (materialCache.size > 200) materialCache.clear();
  materialCache.set(k, url);
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
export const LINE = 1000;

export interface Placed {
  ch: string;
  x: number;
  line: number;
  glyph: LetterGlyph | null;
  advance: number;
}

export function layoutText(text: string, map: Map<string, LetterGlyph>, maxWidth = Infinity): { items: Placed[]; lines: number; width: number } {
  const items: Placed[] = [];
  let line = 0, x = 0, width = 0;
  const adv = (ch: string) => {
    if (ch === ' ') return SPACE;
    const g = map.get(ch.toUpperCase());
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
        items.push({ ch, x, line, glyph: ch === ' ' ? null : map.get(ch.toUpperCase()) ?? null, advance: a });
        x += a;
      }
      width = Math.max(width, x);
    }
    line++;
    x = 0;
  }
  return { items, lines: Math.max(1, line), width };
}

export { CAP_HEIGHT };

// ---------- the .ttf ----------

export function buildFont(map: Map<string, LetterGlyph>, name: string, maker: string): Uint8Array {
  const glyphs: FontGlyph[] = [];
  for (const [ch, g] of map) {
    const cps = [ch.charCodeAt(0)];
    const lower = ch.toLowerCase();
    if (lower !== ch) cps.push(lower.charCodeAt(0));
    glyphs.push({ codepoints: cps, contours: g.outline.contours, advance: g.outline.advance });
  }
  return buildTTF({ familyName: name, designer: maker, glyphs });
}

export function safeFileName(name: string): string {
  return (name.trim() || 'my-font').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').slice(0, 60);
}
