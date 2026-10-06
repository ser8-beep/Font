// Grows a whole alphabet from each sample photo and writes contact sheets for checking by eye.
//
//   npm run alphabet:samples                      # every photo in /samples, A-Z + digits + punctuation
//   npm run alphabet:samples -- lego clay         # only photos whose name contains these words
//   npm run alphabet:samples -- --chars=abcxyz    # choose the characters to grow
//   npm run alphabet:samples -- --seed=3          # another roll of the dice
//   npm run alphabet:samples -- --category=tools  # build letters the way that category does
//                                                 # (default: the category the photo matches)
//
// For each photo it writes samples/_debug/alphabet-<name>.png:
//   top block    : the kid's captured letters (thick bar under them), then every grown character
//                  in the photo's material, on a light background
//   bottom block : the same characters as the font will draw them (traced ink, black on white)
// and samples/_debug/alphabet-<name>.ttf with captured + grown letters.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { alphabetChars, analyseStyle, matchCategory, materialFor, renderLetter, verticalRange, type StyleSample } from '../src/core/alphabet';
import { cropImage, type Mask, type RGBAImage } from '../src/core/image';
import { maskBounds } from '../src/core/mask';
import { analyse, cleanLetter } from '../src/core/segment';
import { maskToGlyph, type GlyphOutline } from '../src/core/trace';
import { buildTTF } from '../src/core/ttf';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// --refs uses samples/_refs (local test photos made from reference alphabets; not committed).
const DIR = process.argv.includes('--refs') ? join(ROOT, 'samples', '_refs') : join(ROOT, 'samples');
const OUT = join(ROOT, 'samples', '_debug');
const args = process.argv.slice(2);
const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const filters = args.filter((a) => !a.startsWith('--'));
const seed = Number(opt('seed') ?? 0);
const CELL = 120;
const GAP = 12;
const PER_ROW = 12;

function load(path: string): RGBAImage {
  const j = jpeg.decode(readFileSync(path), { useTArray: true, maxMemoryUsageInMB: 1024 });
  return { width: j.width, height: j.height, data: j.data };
}

interface Cell {
  art: RGBAImage; // straight RGBA, alpha = coverage
  ink: Mask | null;
  captured: boolean;
}

/** Bilinear sample of straight RGBA, returned premultiplied. */
function sample(img: RGBAImage, x: number, y: number): [number, number, number, number] {
  const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(x))), y0 = Math.max(0, Math.min(img.height - 1, Math.floor(y)));
  const x1 = Math.min(img.width - 1, x0 + 1), y1 = Math.min(img.height - 1, y0 + 1);
  const tx = Math.min(1, Math.max(0, x - x0)), ty = Math.min(1, Math.max(0, y - y0));
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (const [xx, yy, w] of [[x0, y0, (1 - tx) * (1 - ty)], [x1, y0, tx * (1 - ty)], [x0, y1, (1 - tx) * ty], [x1, y1, tx * ty]] as const) {
    const i = (yy * img.width + xx) * 4;
    const a = (img.data[i + 3] / 255) * w;
    out[0] += img.data[i] * a; out[1] += img.data[i + 1] * a; out[2] += img.data[i + 2] * a; out[3] += a;
  }
  return out;
}

function drawCell(png: PNG, ox: number, oy: number, img: RGBAImage, bg: [number, number, number]) {
  const s = Math.min(CELL / img.width, CELL / img.height);
  const w = img.width * s, h = img.height * s;
  const dx = ox + (CELL - w) / 2, dy = oy + (CELL - h) / 2;
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const o = ((oy + y) * png.width + ox + x) * 4;
    let [r, g, b, a] = [0, 0, 0, 0];
    const sx = (ox + x - dx) / s, sy = (oy + y - dy) / s;
    if (sx >= 0 && sy >= 0 && sx < img.width && sy < img.height) [r, g, b, a] = sample(img, sx, sy);
    png.data[o] = r + bg[0] * (1 - a);
    png.data[o + 1] = g + bg[1] * (1 - a);
    png.data[o + 2] = b + bg[2] * (1 - a);
    png.data[o + 3] = 255;
  }
}

function maskToImage(m: Mask): RGBAImage {
  const b = maskBounds(m) ?? { x: 0, y: 0, w: m.width, h: m.height };
  const data = new Uint8ClampedArray(b.w * b.h * 4);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const o = (y * b.w + x) * 4;
    data[o + 3] = m.data[(y + b.y) * m.width + x + b.x] ? 255 : 0;
  }
  return { width: b.w, height: b.h, data };
}

function cutout(img: RGBAImage, m: Mask): RGBAImage {
  const b = maskBounds(m) ?? { x: 0, y: 0, w: m.width, h: m.height };
  const c = cropImage(img, b);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) c.data[(y * b.w + x) * 4 + 3] = m.data[(y + b.y) * m.width + x + b.x] ? 255 : 0;
  return c;
}

const files = readdirSync(DIR).filter((f) => /\.(jpe?g)$/i.test(f) && (!filters.length || filters.some((k) => f.includes(k)))).sort();
mkdirSync(OUT, { recursive: true });

for (const f of files) {
  const word = (basename(f).match(/__([A-Za-z0-9]+)\./)?.[1] ?? 'PLAY');
  const img = load(join(DIR, f));
  const an = analyse(img, { expected: word.length });
  const k = img.width / an.work.width;
  const samples: StyleSample[] = an.blobs.map((b, i) => {
    const c = cleanLetter(img, an, b, { bolder: 0, fillHoles: b.porous });
    return { char: word[i] ?? '?', image: cropImage(img, c.box), mask: c.mask, raw: c.raw, porous: b.porous, fillRadius: b.porous ? an.fillR * k : 0 };
  });

  const t0 = performance.now();
  const style = analyseStyle(samples);
  const tStyle = performance.now() - t0;
  const category = opt('category') ?? matchCategory(samples, style).ranked[0].id;
  const chars = opt('chars') ? [...opt('chars')!] : alphabetChars({ upper: word !== word.toLowerCase(), lower: word !== word.toUpperCase() });

  const cells: Cell[] = samples.map((s) => ({ art: cutout(s.image, s.mask), ink: s.mask, captured: true }));
  const glyphs: { ch: string; outline: GlyphOutline }[] = samples.flatMap((s) => {
    const o = maskToGlyph(s.mask, verticalRange(s.char));
    return o ? [{ ch: s.char, outline: o }] : [];
  });
  const t1 = performance.now();
  let made = 0;
  for (const ch of chars) {
    const art = renderLetter(ch, style, seed, category);
    if (!art) continue;
    made++;
    cells.push({ art: art.image, ink: art.mask, captured: false });
    if (!glyphs.some((g) => g.ch === ch)) {
      const o = maskToGlyph(art.mask, verticalRange(ch, materialFor(ch, style, seed, category).weight));
      if (o) glyphs.push({ ch, outline: o });
    }
  }
  const tGrow = performance.now() - t1;

  const rows = Math.ceil(cells.length / PER_ROW);
  const W = PER_ROW * (CELL + GAP) + GAP;
  const blockH = rows * (CELL + GAP) + GAP;
  const png = new PNG({ width: W, height: blockH * 2 + GAP });
  png.data.fill(255);
  cells.forEach((c, i) => {
    const x = GAP + (i % PER_ROW) * (CELL + GAP);
    const y = GAP + Math.floor(i / PER_ROW) * (CELL + GAP);
    drawCell(png, x, y, c.art, [236, 236, 230]);
    if (c.ink) drawCell(png, x, blockH + GAP + y, maskToImage(c.ink), [255, 255, 255]);
    if (c.captured) for (let yy = y + CELL; yy < y + CELL + 6; yy++) for (let xx = x; xx < x + CELL; xx++) png.data.set([255, 93, 143, 255], (yy * W + xx) * 4);
  });
  const name = basename(f).replace(/\.\w+$/, '');
  writeFileSync(join(OUT, `alphabet-${name}.png`), PNG.sync.write(png));

  const ttf = buildTTF({
    familyName: `Grown ${name}`,
    glyphs: glyphs.map((g) => ({
      codepoints: [g.ch.charCodeAt(0), ...(g.ch.toLowerCase() !== g.ch && !glyphs.some((o) => o.ch === g.ch.toLowerCase()) ? [g.ch.toLowerCase().charCodeAt(0)] : [])],
      contours: g.outline.contours,
      advance: g.outline.advance,
    })),
  });
  writeFileSync(join(OUT, `alphabet-${name}.ttf`), ttf);

  const kinds = style.materials.map((m) => `${m.source}:${m.material.kind}`).join(' ');
  console.log(
    `${name.padEnd(18)} ${category.padEnd(13)} style ${tStyle.toFixed(0).padStart(4)}ms  grew ${made}/${chars.length} in ${tGrow.toFixed(0).padStart(5)}ms` +
      `  materials [${kinds}]  weight ${style.materials.map((m) => m.weight.toFixed(2)).join('/')}  geometry ${JSON.stringify(style.geometry)}`,
  );
}
