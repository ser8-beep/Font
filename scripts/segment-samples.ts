// Runs letter segmentation on every photo in /samples and reports how many letters were found.
//
//   npm run samples:test            # report
//   npm run samples:test -- --debug # also write overlay images to samples/_debug
//
// Photos are expected to spell PLAY (4 letters). Name a photo like `wool__SAM.jpg` to say it
// spells something else. Exits with code 1 if any photo finds the wrong number of letters.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import type { RGBAImage } from '../src/core/image';
import { analyse, cleanLetter } from '../src/core/segment';
import { maskToGlyph, type GlyphOutline } from '../src/core/trace';
import { buildTTF } from '../src/core/ttf';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// --refs uses samples/_refs (local test photos made from reference alphabets; not committed).
const DIR = process.argv.includes('--refs') ? join(ROOT, 'samples', '_refs') : join(ROOT, 'samples');
const debug = process.argv.includes('--debug');

function load(path: string): RGBAImage {
  const buf = readFileSync(path);
  if (extname(path).toLowerCase() === '.png') {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
  }
  const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 });
  return { width: img.width, height: img.height, data: img.data };
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f.startsWith('_') || f.startsWith('.')) return [];
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(jpe?g|png)$/i.test(f) ? [p] : [];
  });
}

function writeDebug(path: string, img: RGBAImage, an: ReturnType<typeof analyse>) {
  const { work, fg, blobs } = an;
  const png = new PNG({ width: work.width, height: work.height });
  for (let i = 0; i < work.width * work.height; i++) {
    const on = fg.data[i];
    png.data[i * 4] = on ? 255 : work.data[i * 4] * 0.5;
    png.data[i * 4 + 1] = on ? work.data[i * 4 + 1] * 0.5 : work.data[i * 4 + 1] * 0.5;
    png.data[i * 4 + 2] = work.data[i * 4 + 2] * 0.5;
    png.data[i * 4 + 3] = 255;
  }
  for (const b of blobs) {
    for (let x = b.box.x; x < b.box.x + b.box.w; x++) for (const y of [b.box.y, b.box.y + b.box.h - 1]) png.data.set([0, 255, 255, 255], (y * work.width + x) * 4);
    for (let y = b.box.y; y < b.box.y + b.box.h; y++) for (const x of [b.box.x, b.box.x + b.box.w - 1]) png.data.set([0, 255, 255, 255], (y * work.width + x) * 4);
  }
  void img;
  writeFileSync(path, PNG.sync.write(png));
}

if (!existsSync(DIR)) {
  console.error('No samples folder. Run `npm run samples:make` or add photos to /samples.');
  process.exit(1);
}
const files = walk(DIR).sort();
const DEBUG_DIR = join(ROOT, 'samples', '_debug');
if (debug) mkdirSync(DEBUG_DIR, { recursive: true });

let failures = 0;
const rows: string[][] = [['photo', 'expected', 'found', 'glyphs', 'time', '']];
for (const f of files) {
  const word = (basename(f).match(/__([A-Za-z0-9]+)\./)?.[1] ?? 'PLAY').toUpperCase();
  const img = load(f);
  const t0 = performance.now();
  const an = analyse(img, { expected: word.length });
  // Also run the per-letter clean-up and tracing so the timing covers the whole pipeline.
  const glyphs: GlyphOutline[] = [];
  for (const b of an.blobs) {
    const c = cleanLetter(img, an, b, { bolder: 0, fillHoles: process.argv.includes('--fill') || b.porous });
    const g = maskToGlyph(c.mask);
    if (g) glyphs.push(g);
  }
  const traced = glyphs.length;
  const ttf = buildTTF({
    familyName: 'Sample ' + basename(f),
    glyphs: glyphs.map((g, i) => ({ codepoints: word[i] ? [word.charCodeAt(i), word.toLowerCase().charCodeAt(i)] : [], contours: g.contours, advance: g.advance })),
  });
  const ms = performance.now() - t0;
  const ok = an.blobs.length === word.length && traced === word.length;
  if (!ok) failures++;
  rows.push([relative(DIR, f), String(word.length), String(an.blobs.length), String(traced), `${ms.toFixed(0)}ms`, ok ? 'ok' : 'MISMATCH']);
  if (debug) {
    writeDebug(join(DEBUG_DIR, basename(f).replace(/\.\w+$/, '.png')), img, an);
    writeFileSync(join(DEBUG_DIR, basename(f).replace(/\.\w+$/, '.ttf')), ttf);
  }
}

const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
for (const r of rows) console.log(r.map((c, i) => c.padEnd(widths[i])).join('  '));
console.log(`\n${files.length - failures}/${files.length} photos found the right number of letters.`);
process.exit(failures ? 1 : 0);
