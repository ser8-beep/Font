// Builds the letter library the app fills fonts from: real object alphabets, one per source set.
//
//   npm run library -- <folder> [more folders]
//
// Typically: the cut-out folder (object-alphabets/, not in git), then data/cutouts-extra and
// data/cutouts-generated, which use the same layout.
//
// The folder has manifest.json (one entry per cut-out letter: char, case, objects, construction,
// source, confidence, png) and <category>/<set>/<letter>_<case>.png cut-outs, transparent where
// the background was plain. For each set this writes one packed picture (WebP) to
// src/library/atlases/, and src/library/manifest.json with every letter's place in it, its
// outline in font units (traced from the cut-out, for the .ttf) and what it is made of.
// Only letters are kept; numbers and punctuation are skipped.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { looksOf } from '../src/core/alphabet/category';
import { verticalRange } from '../src/core/alphabet/letters';
import { makeMask, type Mask, type RGBAImage } from '../src/core/image';
import { components, maskBounds } from '../src/core/mask';
import { contoursToSvg, maskToGlyph } from '../src/core/trace';
import type { LibraryLetter, LibraryManifest, LibrarySet } from '../src/library-types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src', 'library');
const ATLAS_WIDTH = 2048;
const PAD = 2;
// Big cut-outs are scaled down to this height; font pictures go up to 256 px per em.
const MAX_H = 320;

const folders = process.argv.slice(2);
if (!folders.length) {
  console.error('usage: npm run library -- <folder with manifest.json> [more folders]');
  process.exit(1);
}

interface Entry { id: string; char: string; case: string; category: string; objects: string; construction: string; source: string; confidence: string; png: string; generated?: boolean; dir: string }
const entries = folders.flatMap((dir) => (JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Entry[]).map((e) => ({ ...e, dir }))).filter((e) => /^[A-Za-z]$/.test(e.char));
const repo = JSON.parse(readFileSync(join(ROOT, 'data', 'object-type-repository.json'), 'utf8')) as { sources: { id: string; description: string }[] };
const titles = new Map(repo.sources.map((s) => [s.id, s.description]));

function load(path: string): RGBAImage {
  const png = PNG.sync.read(readFileSync(path));
  return { width: png.width, height: png.height, data: png.data };
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
  if (opaque) return m; // a plain rectangular crop (book spines, matchsticks): the tile is the letter
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

const BUILD = new Set(['single', 'composite', 'repeated', 'formed']);
const sets = new Map<string, { category: string; folder: string; generated: boolean; letters: { e: Entry; img: RGBAImage; mask: Mask }[] }>();
let skipped = 0;
for (const e of entries) {
  const raw = load(join(e.dir, e.png));
  const m = letterMask(raw);
  const b = maskBounds(m);
  if (!b || b.w < 3 || b.h < 6) { skipped++; continue; }
  const { img, mask } = crop(raw, m, b, Math.min(1, MAX_H / b.h));
  const [category, setFolder] = e.png.split('/');
  const set = sets.get(e.source) ?? { category, folder: setFolder, generated: !!e.generated, letters: [] };
  set.letters.push({ e, img, mask });
  sets.set(e.source, set);
}

rmSync(join(OUT, 'atlases'), { recursive: true, force: true });
mkdirSync(join(OUT, 'atlases'), { recursive: true });
const manifest: LibraryManifest = { sets: [] };
for (const [id, set] of [...sets].sort((a, b) => a[0].localeCompare(b[0]))) {
  // Shelf-pack the letters into one picture.
  let x = 0, y = 0, shelf = 0;
  const placed = set.letters.map((l) => {
    if (x + l.img.width + PAD > ATLAS_WIDTH) { x = 0; y += shelf + PAD; shelf = 0; }
    const at = { x, y };
    x += l.img.width + PAD;
    shelf = Math.max(shelf, l.img.height);
    return at;
  });
  const atlas = new PNG({ width: ATLAS_WIDTH, height: y + shelf });
  const letters: LibraryLetter[] = [];
  set.letters.forEach((l, i) => {
    const o = maskToGlyph(l.mask, verticalRange(l.e.char));
    if (!o) return;
    // Only the traced part goes in (maskToGlyph drops specks), so the picture matches the outline.
    const s = o.source;
    for (let yy = 0; yy < s.h; yy++) {
      const src = ((s.y + yy) * l.img.width + s.x) * 4;
      atlas.data.set(l.img.data.subarray(src, src + s.w * 4), ((placed[i].y + yy) * ATLAS_WIDTH + placed[i].x) * 4);
    }
    letters.push({
      id: l.e.id,
      char: l.e.char,
      objects: l.e.objects,
      build: (BUILD.has(l.e.construction) ? l.e.construction : 'single') as LibraryLetter['build'],
      confident: l.e.confidence === 'high',
      rect: [placed[i].x, placed[i].y, s.w, s.h],
      svg: contoursToSvg(o.contours),
      advance: o.advance,
      lsb: o.lsb,
      inkWidth: o.inkWidth,
      bottom: o.bottom,
      top: o.top,
    });
  });
  const pngPath = join(OUT, 'atlases', `${id}.png`);
  writeFileSync(pngPath, PNG.sync.write(atlas));
  // WebP keeps photos with see-through edges about 5x smaller than PNG.
  execFileSync('python3', ['-I', '-c', 'import sys; from PIL import Image; Image.open(sys.argv[1]).save(sys.argv[2], "WEBP", quality=86, method=6)', pngPath, pngPath.replace(/\.png$/, '.webp')]);
  rmSync(pngPath);
  const L = looksOf(set.letters.map((l) => ({ char: l.e.char, image: l.img, mask: l.mask, raw: l.mask, porous: false, fillRadius: 0 })));
  const entry: LibrarySet = {
    id,
    category: set.category,
    title: titles.get(id) ?? set.folder,
    atlas: `${id}.webp`,
    looks: [L.metal, L.dark, L.green, L.brown, L.bright, Math.min(1, L.hues / 6)].map((v) => +v.toFixed(3)),
    ...(set.generated ? { generated: true } : {}),
    letters,
  };
  manifest.sets.push(entry);
  console.log(`${id.padEnd(6)} ${set.category.padEnd(14)} ${String(letters.length).padStart(3)} letters  ${ATLAS_WIDTH}x${y + shelf}`);
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest));
console.log(`${manifest.sets.length} sets, ${manifest.sets.reduce((s, x) => s + x.letters.length, 0)} letters (${skipped} skipped)`);
