// Builds the letter library the app fills fonts from: real object alphabets, from the alphabet
// repository (alphabet-repository/: <category>/<LETTER>/<source>_<char>_<case>.png cut-outs with a
// transparent background, listed in manifest.json).
//
//   npm run library
//
// Letters of one source within one category make one alphabet (set), so a font can stay with one
// maker's style. Each category's letters are packed into one picture (WebP) in src/library/atlases/;
// src/library/manifest.json lists every set and letter: where it sits in the picture, its outline
// in font units (traced from the cut-out, for the .ttf) and what it is made of.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { CATEGORY_LABELS, looksOf } from '../src/core/alphabet/category';
import { groupOf } from '../src/core/alphabet/groups';
import { verticalRange } from '../src/core/alphabet/letters';
import { makeMask, type Mask, type RGBAImage } from '../src/core/image';
import { components, maskBounds } from '../src/core/mask';
import { contoursToSvg, maskToGlyph } from '../src/core/trace';
import type { LibraryLetter, LibraryManifest, LibrarySet } from '../src/library-types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src', 'library');
const ATLAS_WIDTH = 2048;
// Phones (iOS Safari above all) refuse canvases much over 16 million pixels: a category's letters
// go on several pictures of at most 2048 x 4096.
const ATLAS_MAX_H = 4096;
const PAD = 2;
// Cut-outs are scaled down to this height; font pictures go up to 256 px per em (a capital about
// 180 px), and the playground shows letters bigger than that.
const MAX_H = Number(process.env.LIBRARY_MAX_H ?? 360);
// High-resolution originals (this tall or more, not enlarged) keep up to HIRES_MAX_H, so posters stay sharp.
const HIRES_FROM = 360;
const HIRES_MAX_H = Number(process.env.LIBRARY_HIRES_MAX_H ?? 640);

const REPO = join(ROOT, 'alphabet-repository');
// Sharpened copies of small cut-outs (scripts/upscale-repository.py), used when present.
const UPSCALED = join(REPO, '_upscaled');
interface Entry { id: string; char: string; case: string; category: string; objects: string; construction: string; source: string; confidence: string; file: string; primary?: boolean; generated?: boolean }
const entries = (JSON.parse(readFileSync(join(REPO, 'manifest.json'), 'utf8')) as Entry[])
  .filter((e) => /^[A-Za-z]$/.test(e.char) && e.category in CATEGORY_LABELS)
  // Primary picks first, so they come first wherever the app offers a choice.
  .sort((a, b) => Number(b.primary !== false) - Number(a.primary !== false));
const catalogue = JSON.parse(readFileSync(join(ROOT, 'data', 'object-type-repository.json'), 'utf8')) as { sources: { id: string; description: string; default_category: string }[] };
const sourceInfo = new Map(catalogue.sources.map((s) => [s.id, s]));
/** The source picture's description, when that picture is mostly this category (else it misleads). */
const titleOf = (source: string, category: string) => {
  const s = sourceInfo.get(source);
  return s && groupOf(s.default_category) === category ? tidy(s.description) : undefined;
};

function load(path: string): RGBAImage {
  const png = PNG.sync.read(readFileSync(path));
  return { width: png.width, height: png.height, data: png.data };
}

// Halo-free copies (scripts/clean-repository.py), and the letters still haloed after cleaning.
const CLEAN = join(REPO, '_clean');
const EXCLUDED = new Set<string>(existsSync(join(CLEAN, 'excluded.json')) ? JSON.parse(readFileSync(join(CLEAN, 'excluded.json'), 'utf8')) : []);

function loadWebp(path: string): RGBAImage {
  const png = execFileSync('python3', ['-I', '-c', 'import io, sys; from PIL import Image; b = io.BytesIO(); Image.open(sys.argv[1]).convert("RGBA").save(b, "PNG"); sys.stdout.buffer.write(b.getvalue())', path], { maxBuffer: 1 << 28 });
  const p = PNG.sync.read(png);
  return { width: p.width, height: p.height, data: p.data };
}

/** The best picture of a cut-out: halo-free, else sharpened, else the original. */
function loadBest(file: string): { image: RGBAImage; upscaled: boolean } {
  const webp = file.replace(/\.png$/, '.webp');
  const up = join(UPSCALED, webp), clean = join(CLEAN, webp);
  if (existsSync(clean)) return { image: loadWebp(clean), upscaled: existsSync(up) };
  if (existsSync(up)) return { image: loadWebp(up), upscaled: true };
  return { image: load(join(REPO, file)), upscaled: false };
}

/** The letter's shape: the opaque part of the cut-out, minus specks left from neighbours. */
function letterMask(img: RGBAImage): Mask {
  const m = makeMask(img.width, img.height);
  let opaque = true;
  for (let i = 0; i < m.data.length; i++) {
    const a = img.data[i * 4 + 3];
    m.data[i] = a >= 128 ? 1 : 0;
    if (a < 250) opaque = false;
  }
  if (opaque) return m; // no see-through pixels at all: use the whole picture
  const { labels, comps } = components(m);
  const total = comps.reduce((s, c) => s + c.area, 0);
  const keep = new Set(comps.filter((c) => c.area >= total * 0.02).map((c) => c.label));
  for (let i = 0; i < m.data.length; i++) if (m.data[i] && !keep.has(labels[i])) m.data[i] = 0;
  return m;
}

function crop(img: RGBAImage, m: Mask, b: { x: number; y: number; w: number; h: number }, scale: number): { img: RGBAImage; mask: Mask } {
  const w = Math.max(1, Math.round(b.w * scale)), h = Math.max(1, Math.round(b.h * scale));
  const out: RGBAImage = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  const mask = makeMask(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Box-average the source pixels this one covers (scale <= 1), keeping only the letter.
      const x0 = b.x + Math.floor(x / scale), x1 = b.x + Math.max(Math.floor(x / scale) + 1, Math.floor((x + 1) / scale));
      const y0 = b.y + Math.floor(y / scale), y1 = b.y + Math.max(Math.floor(y / scale) + 1, Math.floor((y + 1) / scale));
      let r = 0, g = 0, bl = 0, a = 0, n = 0, on = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = yy * img.width + xx;
        n++;
        if (!m.data[i]) continue;
        on++;
        const al = img.data[i * 4 + 3];
        r += img.data[i * 4] * al; g += img.data[i * 4 + 1] * al; bl += img.data[i * 4 + 2] * al; a += al;
      }
      const o = (y * w + x) * 4;
      if (a > 0) {
        out.data[o] = r / a; out.data[o + 1] = g / a; out.data[o + 2] = bl / a; out.data[o + 3] = a / n;
      }
      mask.data[y * w + x] = on * 2 >= n ? 1 : 0;
    }
  }
  return { img: out, mask };
}

/** A catalogue description as a short name: no notes in brackets, quotes or second sentences. */
function tidy(d: string | undefined): string | undefined {
  if (!d) return undefined;
  const t = d.replace(/\s*\([^)]*\)/g, '').split(/\.\s/)[0].replace(/['"\u2018\u2019]/g, '').replace(/,\s*lowercase$/i, '').trim();
  return t || undefined;
}

const BUILD = new Set(['single', 'composite', 'repeated', 'formed']);
/** native: the original cut-out's height in pixels, before any sharpening (how much detail it really has). */
type Cut = { e: Entry; img: RGBAImage; mask: Mask; native: number };
const byCategory = new Map<string, Map<string, Cut[]>>();
let skipped = 0, sharpened = 0;
for (const e of entries) {
  if (EXCLUDED.has(e.file)) { skipped++; continue; }
  const { image: raw, upscaled } = loadBest(e.file);
  if (upscaled) sharpened++;
  const native = upscaled ? PNG.sync.read(readFileSync(join(REPO, e.file))).height : raw.height;
  const m = letterMask(raw);
  const b = maskBounds(m);
  if (!b || b.w < 3 || b.h < 6) { skipped++; continue; }
  const { img, mask } = crop(raw, m, b, Math.min(1, (native >= HIRES_FROM ? HIRES_MAX_H : MAX_H) / b.h));
  const sets = byCategory.get(e.category) ?? new Map<string, Cut[]>();
  sets.set(e.source, [...(sets.get(e.source) ?? []), { e, img, mask, native }]);
  byCategory.set(e.category, sets);
}

rmSync(join(OUT, 'atlases'), { recursive: true, force: true });
mkdirSync(join(OUT, 'atlases'), { recursive: true });
const manifest: LibraryManifest = { sets: [] };
for (const [category, sets] of [...byCategory].sort((a, b) => a[0].localeCompare(b[0]))) {
  // Shelf-pack the category's letters, one set after another; a set that would run past
  // ATLAS_MAX_H starts a new picture, so every set lives in one picture.
  type Page = { name: string; height: number; cuts: Cut[] };
  const pages: Page[] = [];
  const placed = new Map<Cut, { x: number; y: number; page: Page }>();
  const ordered = [...sets].sort((a, b) => b[1].length - a[1].length);
  let page: Page | null = null, x = 0, y = 0, shelf = 0;
  for (const [, list] of ordered) {
    // Where this set would end on the current page.
    let tx = x, ty = y, tshelf = shelf;
    for (const c of list) {
      if (tx + c.img.width + PAD > ATLAS_WIDTH) { tx = 0; ty += tshelf + PAD; tshelf = 0; }
      tx += c.img.width + PAD;
      tshelf = Math.max(tshelf, c.img.height);
    }
    if (!page || (ty + tshelf > ATLAS_MAX_H && page.cuts.length)) {
      if (page) page.height = y + shelf;
      page = { name: `${category}-${pages.length + 1}.webp`, height: 0, cuts: [] };
      pages.push(page);
      x = 0; y = 0; shelf = 0;
    }
    for (const c of list) {
      if (x + c.img.width + PAD > ATLAS_WIDTH) { x = 0; y += shelf + PAD; shelf = 0; }
      placed.set(c, { x, y, page });
      page.cuts.push(c);
      x += c.img.width + PAD;
      shelf = Math.max(shelf, c.img.height);
    }
  }
  if (page) page.height = y + shelf;
  const pictures = new Map(pages.map((p) => [p, new PNG({ width: ATLAS_WIDTH, height: Math.max(1, p.height) })]));

  let unnamed = 0;
  for (const [source, list] of ordered) {
    const letters: LibraryLetter[] = [];
    let atlasName = '';
    for (const c of list) {
      const o = maskToGlyph(c.mask, verticalRange(c.e.char));
      if (!o) continue;
      // Only the traced part goes in (maskToGlyph drops specks), so the picture matches the outline.
      const s = o.source, at = placed.get(c)!;
      const atlas = pictures.get(at.page)!;
      atlasName = at.page.name;
      for (let yy = 0; yy < s.h; yy++) {
        const src = ((s.y + yy) * c.img.width + s.x) * 4;
        atlas.data.set(c.img.data.subarray(src, src + s.w * 4), ((at.y + yy) * ATLAS_WIDTH + at.x) * 4);
      }
      letters.push({
        id: c.e.id,
        char: c.e.char,
        objects: c.e.objects,
        build: (BUILD.has(c.e.construction) ? c.e.construction : 'single') as LibraryLetter['build'],
        confident: c.e.confidence === 'high',
        rect: [at.x, at.y, s.w, s.h],
        svg: contoursToSvg(o.contours),
        advance: o.advance,
        lsb: o.lsb,
        inkWidth: o.inkWidth,
        bottom: o.bottom,
        top: o.top,
      });
    }
    if (!letters.length) continue;
    const L = looksOf(list.map((c) => ({ char: c.e.char, image: c.img, mask: c.mask, raw: c.mask, porous: false, fillRadius: 0 })));
    const generated = list.some((c) => c.e.generated) || source.startsWith('gen-');
    const entry: LibrarySet = {
      id: `${category}/${source}`,
      category,
      // The catalogue describes the reference sets; newer and generated ones get a plain name.
      title: titleOf(source, category) ?? `${CATEGORY_LABELS[category].label} alphabet ${++unnamed}`,
      atlas: atlasName,
      looks: [L.metal, L.dark, L.green, L.brown, L.bright, Math.min(1, L.hues / 6)].map((v) => +v.toFixed(3)),
      ...(generated ? { generated: true } : {}),
      native: [...list.map((c) => c.native)].sort((a, b) => a - b)[list.length >> 1],
      letters,
    };
    manifest.sets.push(entry);
  }
  for (const [p, atlas] of pictures) {
    const pngPath = join(OUT, 'atlases', p.name.replace(/\.webp$/, '.png'));
    writeFileSync(pngPath, PNG.sync.write(atlas));
    // WebP keeps photos with see-through edges about 5x smaller than PNG.
    execFileSync('python3', ['-I', '-c', 'import sys; from PIL import Image; Image.open(sys.argv[1]).save(sys.argv[2], "WEBP", quality=int(sys.argv[3]), method=6)', pngPath, join(OUT, 'atlases', p.name), process.env.LIBRARY_QUALITY ?? '80']);
    rmSync(pngPath);
  }
  console.log(`${category.padEnd(14)} ${String(placed.size).padStart(3)} letters in ${sets.size} sets on ${pages.length} picture${pages.length > 1 ? 's' : ''}`);
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest));
console.log(`${manifest.sets.length} sets, ${manifest.sets.reduce((s, x) => s + x.letters.length, 0)} letters (${sharpened} sharpened, ${skipped} skipped)`);
