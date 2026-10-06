import { svgToContours } from './core/trace';
import type { RGBAImage } from './core/image';
import type { LetterGlyph } from './font';
import type { LibraryLetter, LibraryManifest, LibrarySet } from './library-types';
import manifest from './library/manifest.json';

// The letter library: real object alphabets (one per source set, by category) that fill in every
// letter a kid didn't make. Built by scripts/library.ts from a folder of cut-outs.

const ATLAS_URLS = import.meta.glob('./library/atlases/*.webp', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export const SETS: LibrarySet[] = (manifest as LibraryManifest).sets;

/**
 * Where to look when a category has no alphabet of its own (yet): the closest kind of stuff.
 * Generated alphabets fill these gaps; this keeps the app working without them.
 */
const NEAREST: Record<string, string[]> = {
  leisure: ['household', 'stationery'],
  textiles: ['fashion', 'household'],
  hardware: ['tools', 'vehicle'],
  electronics: ['household', 'tools'],
  decor: ['household', 'nature'],
  packaging: ['household', 'stationery'],
  books: ['stationery', 'household'],
  nature: ['produce', 'found'],
  furniture: ['household', 'found'],
  vehicle: ['tools', 'hardware'],
  fashion: ['found', 'household'],
  found: ['tools', 'household'],
  art: ['stationery', 'household'],
  stationery: ['art', 'household'],
  produce: ['prepared_food', 'nature'],
  prepared_food: ['produce', 'household'],
  household: ['found', 'stationery'],
  tools: ['hardware', 'found'],
};

const has = (s: LibrarySet, ch: string) => s.letters.some((l) => l.char === ch);
const otherCase = (ch: string) => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase());

/**
 * The alphabets to fill this font from, best first: the category's own sets, ranked by how many
 * of the needed letters they have (in the right case) and then by how close their colours are to
 * the kid's letters; then the nearest categories' sets, for letters the category lacks.
 */
export function rankSets(category: string, chars: string[], looks: number[] | null): LibrarySet[] {
  const near = NEAREST[category] ?? [];
  const score = (s: LibrarySet) => {
    const exact = chars.filter((c) => has(s, c)).length;
    const either = chars.filter((c) => !has(s, c) && has(s, otherCase(c))).length;
    const look = looks ? Math.sqrt(s.looks.reduce((d, v, i) => d + (v - looks[i]) ** 2, 0)) : 0;
    // The category's own alphabets win unless they are mostly missing the letters needed (a
    // lowercase-only set for a capitals font): then a nearby category's full set does better.
    const own = s.category === category ? 0.3 * chars.length : -near.indexOf(s.category);
    return own + exact + 0.4 * either - 4 * look - (s.generated ? 0.5 : 0);
  };
  return SETS.filter((s) => s.category === category || near.includes(s.category))
    .map((s) => ({ s, v: score(s) }))
    .sort((a, b) => b.v - a.v)
    .map(({ s }) => s);
}

export interface Choice {
  set: LibrarySet;
  letter: LibraryLetter;
}

/**
 * Every way to fill ch, best first: each alphabet's own ch (in `sets` order), then the same letter
 * in the other case. "Try another" walks this list.
 */
export function optionsFor(ch: string, sets: LibrarySet[]): Choice[] {
  const out: Choice[] = [];
  for (const want of [ch, otherCase(ch)]) {
    for (const set of sets) for (const letter of set.letters) if (letter.char === want) out.push({ set, letter });
    // The other case only when nothing has the right one.
    if (out.length) break;
  }
  return out;
}

const atlases = new Map<string, Promise<RGBAImage>>();

/** The set's packed picture, decoded. Browser only. */
export function loadAtlas(set: LibrarySet): Promise<RGBAImage> {
  let p = atlases.get(set.id);
  if (!p) {
    p = new Promise<RGBAImage>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height);
        resolve({ width: d.width, height: d.height, data: d.data });
      };
      img.onerror = () => reject(new Error(`could not load the ${set.id} alphabet`));
      img.src = ATLAS_URLS[`./library/atlases/${set.atlas}`];
    });
    atlases.set(set.id, p);
    p.catch(() => atlases.delete(set.id));
  }
  return p;
}

const glyphs = new Map<string, LetterGlyph>();

/** A library letter as one of the font's letters, typed as `ch`. */
export function libraryGlyph({ set, letter }: Choice, atlas: RGBAImage, ch: string): LetterGlyph {
  const id = `lib|${letter.id}|${ch}`;
  const hit = glyphs.get(id);
  if (hit) return hit;
  const [x, y, w, h] = letter.rect;
  const image: RGBAImage = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  for (let r = 0; r < h; r++) {
    const s = ((y + r) * atlas.width + x) * 4;
    image.data.set(atlas.data.subarray(s, s + w * 4), r * w * 4);
  }
  const g: LetterGlyph = {
    id,
    char: ch,
    outline: {
      contours: svgToContours(letter.svg),
      advance: letter.advance,
      source: { x: 0, y: 0, w, h },
      lsb: letter.lsb,
      inkWidth: letter.inkWidth,
      bottom: letter.bottom,
      top: letter.top,
    },
    svg: letter.svg,
    generated: true,
    picture: { kind: 'art', image, objects: letter.objects, from: set.title },
  };
  glyphs.set(id, g);
  return g;
}
