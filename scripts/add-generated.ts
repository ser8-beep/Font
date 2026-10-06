// Adds generated letter photographs to the alphabet repository, cut out like the rest.
//
//   npm run repository:add -- <folder of generated images> [--repo <copy of the repository>]
//
// Each image is named <category>_<LETTER>_<variation>.(png|jpg|webp), one row of
// alphabet-repository/generation_brief.csv. The letter is found on its plain background with the
// same segmentation the app uses for kids' photos, cut out with a 1px feathered edge (the
// background colour taken back out of edge pixels, so there is no white halo), and saved as
// <category>/<LETTER>/gen-<category>-<variation>_<LETTER>_upper.png with a manifest entry
// (source gen-<category>-<variation>, generated: true). coverage.csv is recounted.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import type { RGBAImage } from '../src/core/image';
import { analyse, cleanLetter } from '../src/core/segment';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
// --repo <dir> works on a copy, for trying things out.
const repoAt = args.indexOf('--repo');
const REPO = repoAt >= 0 ? args.splice(repoAt, 2)[1] : join(ROOT, 'alphabet-repository');
const folder = args[0];
if (!folder) {
  console.error('usage: npm run repository:add -- <folder of generated images> [--repo <dir>]');
  process.exit(1);
}

interface Entry { id: string; char: string; letter: string; case: string; category: string; objects: string; construction: string; source: string; confidence: string; file: string; primary: boolean; generated?: boolean }
const manifest = JSON.parse(readFileSync(join(REPO, 'manifest.json'), 'utf8')) as Entry[];
const brief = readFileSync(join(REPO, 'generation_brief.csv'), 'utf8');

/** The objects a brief prompt asks for: the bit in brackets after "built from real ...". */
function objectsOf(category: string, letter: string, variation: string): string {
  const line = brief.split('\n').find((l) => l.startsWith(`${category},${letter},${variation},`));
  const m = line?.match(/built from real ([^(]+)\(([^)]+)\)/);
  return m ? `${m[1].trim()} (${m[2].trim()})` : 'generated';
}

function load(path: string): RGBAImage {
  const buf = readFileSync(path);
  if (buf[0] === 0x89) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
  }
  const j = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 });
  return { width: j.width, height: j.height, data: j.data };
}

let added = 0;
for (const name of readdirSync(folder).sort()) {
  const m = name.match(/^([a-z_]+)_([A-Z])_(\d+)\.(png|jpe?g)$/);
  if (!m) continue;
  const [, category, letter, variation] = m;
  const img = load(join(folder, name));
  const an = analyse(img, { expected: 1 });
  const blob = an.blobs[0];
  if (!blob) {
    console.log(`${name}: no letter found, skipped`);
    continue;
  }
  const c = cleanLetter(img, an, blob, { bolder: 0, fillHoles: false });
  // The plain background colour, from the picture's border.
  let br = 0, bg = 0, bb = 0, bn = 0;
  for (let x = 0; x < img.width; x += 4) for (const y of [0, img.height - 1]) {
    const i = (y * img.width + x) * 4;
    br += img.data[i]; bg += img.data[i + 1]; bb += img.data[i + 2]; bn++;
  }
  br /= bn; bg /= bn; bb /= bn;
  const { x: bx, y: by, w, h } = c.box;
  const out = new PNG({ width: w, height: h });
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : c.mask.data[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // 1px feather: average the mask over the pixel and its neighbours.
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += at(x + dx, y + dy);
      const a = at(x, y) ? Math.max(s / 9, 0.5) : s / 18;
      const i = ((y + by) * img.width + x + bx) * 4, o = (y * w + x) * 4;
      // Take the background back out of partly covered pixels.
      const un = (v: number, b: number) => Math.max(0, Math.min(255, a > 0 ? (v - (1 - a) * b) / a : v));
      out.data[o] = un(img.data[i], br);
      out.data[o + 1] = un(img.data[i + 1], bg);
      out.data[o + 2] = un(img.data[i + 2], bb);
      out.data[o + 3] = Math.round(a * 255);
    }
  }
  const source = `gen-${category}-${variation}`;
  const file = `${category}/${letter}/${source}_${letter}_upper.png`;
  mkdirSync(join(REPO, category, letter), { recursive: true });
  writeFileSync(join(REPO, file), PNG.sync.write(out));
  const id = `${source}-${letter}`;
  const entry: Entry = {
    id,
    char: letter,
    letter,
    case: 'upper',
    category,
    objects: objectsOf(category, letter, variation),
    construction: 'composite',
    source,
    confidence: 'high',
    file,
    primary: manifest.filter((e) => e.category === category && e.letter === letter && e.primary).length < 4,
    generated: true,
  };
  const at2 = manifest.findIndex((e) => e.id === id);
  if (at2 >= 0) manifest[at2] = entry;
  else manifest.push(entry);
  added++;
  console.log(`${name} -> ${file} (${w}x${h})`);
}

writeFileSync(join(REPO, 'manifest.json'), JSON.stringify(manifest, null, 1));
// Recount coverage for the categories coverage.csv tracks (pictures per letter, both cases).
const rows = ['category,letter,have,need_to_reach_3'];
const cats = [...new Set(readFileSync(join(REPO, 'coverage.csv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split(',')[0]))];
for (const cat of cats) {
  for (const L of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const have = manifest.filter((e) => e.category === cat && e.letter === L).length;
    rows.push(`${cat},${L},${have},${Math.max(0, 3 - have)}`);
  }
}
writeFileSync(join(REPO, 'coverage.csv'), rows.join('\n') + '\n');
console.log(`${added} generated letters added`);
