// Measures the captured letters of each sample photo and fits the shared letter geometry, for
// checking measure.ts and fit.ts by eye.
//
//   npm exec tsx scripts/measure-samples.ts                 # every photo in /samples
//   npm exec tsx scripts/measure-samples.ts -- --refs       # samples/_refs (realistic test photos)
//   npm exec tsx scripts/measure-samples.ts -- --all        # both
//   npm exec tsx scripts/measure-samples.ts -- clay wool    # only photos whose name contains these words
//
// Prints per-letter measurements and the fitted geometry, and writes samples/_debug/measure-<name>.png:
//   top row    : each mask (grey) with its medial-axis paths (one colour per path, a red dot where
//                paths meet, a green dot at a free stroke end)
//   bottom row : the mask (grey) under the fitted skeleton drawn with the measured weight (blue),
//                both cropped to their ink and scaled to the same height, as the fit compares them
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import type { StyleSample } from '../src/core/alphabet';
import { endSquareness, fitGeometry, letterScore, prepareTarget, renderSkeleton, roundFromEnds } from '../src/core/alphabet/fit';
import { medialAxis, measureSample } from '../src/core/alphabet/measure';
import type { GeometryParams } from '../src/core/alphabet/types';
import { DEFAULT_GEOMETRY } from '../src/core/alphabet/types';
import { cropImage, type RGBAImage } from '../src/core/image';
import { analyse, cleanLetter } from '../src/core/segment';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const filters = args.filter((a) => !a.startsWith('--'));
const dirs = args.includes('--all') ? ['samples', 'samples/_refs'] : args.includes('--refs') ? ['samples/_refs'] : ['samples'];
const OUT = join(ROOT, 'samples', '_debug');
const CELL = 240, GAP = 10;
const COLOURS: [number, number, number][] = [[230, 40, 70], [30, 120, 230], [20, 160, 70], [240, 140, 0], [150, 50, 200], [0, 170, 170], [200, 170, 0], [120, 70, 30]];

function load(path: string): RGBAImage {
  const j = jpeg.decode(readFileSync(path), { useTArray: true, maxMemoryUsageInMB: 1024 });
  return { width: j.width, height: j.height, data: j.data };
}

function samplesOf(path: string, word: string): StyleSample[] {
  const img = load(path);
  const an = analyse(img, { expected: word.length });
  const k = img.width / an.work.width;
  return an.blobs.map((b, i) => {
    const c = cleanLetter(img, an, b, { bolder: 0, fillHoles: b.porous });
    return { char: word[i] ?? '?', image: cropImage(img, c.box), mask: c.mask, raw: c.raw, porous: b.porous, fillRadius: b.porous ? an.fillR * k : 0 };
  });
}

function dot(png: PNG, x: number, y: number, r: number, c: [number, number, number]) {
  for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
    if (xx < 0 || yy < 0 || xx >= png.width || yy >= png.height || (xx - x) ** 2 + (yy - y) ** 2 > r * r) continue;
    png.data.set([...c, 255], (yy * png.width + xx) * 4);
  }
}

const fmt = (v: number, d = 2) => (v >= 0 ? ' ' : '') + v.toFixed(d);
const geo = (g: GeometryParams) => `width ${g.width.toFixed(2)} slant ${fmt(g.slant)} bowl ${fmt(g.bowl)} bar ${fmt(g.bar)} fork ${fmt(g.fork)} round ${g.round.toFixed(2)}`;

mkdirSync(OUT, { recursive: true });
for (const dir of dirs) {
  const full = join(ROOT, dir);
  if (!existsSync(full)) continue;
  const files = readdirSync(full).filter((f) => /\.jpe?g$/i.test(f) && (!filters.length || filters.some((k) => f.includes(k)))).sort();
  for (const f of files) {
    const word = basename(f).match(/__([A-Za-z0-9]+)\./)?.[1] ?? 'PLAY';
    const samples = samplesOf(join(full, f), word);
    const name = basename(f).replace(/\.\w+$/, '');
    console.log(`\n${name}`);
    const measures = samples.map((s) => {
      const t0 = performance.now();
      const m = measureSample(s);
      const ms = performance.now() - t0;
      console.log(
        `  ${s.char} ${String(m.heightPx).padStart(4)}x${String(m.widthPx).padEnd(4)} ${ms.toFixed(1).padStart(5)}ms  stroke ${m.strokePx.toFixed(1).padStart(5)}px` +
          ` (${(m.strokePx / m.heightPx).toFixed(3)} h)  slant ${fmt(m.slant, 3)}  wobble ${m.wobble.toFixed(4)}  paths ${m.paths.length}` +
          `  colour ${m.colour.map((c) => Math.round(c)).join(',')}${s.porous ? '  porous' : ''}`,
      );
      return m;
    });
    const t0 = performance.now();
    const g = fitGeometry(samples, measures);
    const tFit = performance.now() - t0;
    console.log(`  fit ${tFit.toFixed(0)}ms  ${geo(g)}`);
    console.log(`  square ends: ${samples.map((s, i) => `${s.char} [${endSquareness(s.mask, measures[i]).map((v) => v.toFixed(2)).join(' ')}]`).join('  ')}  -> round prior ${roundFromEnds(samples, measures).toFixed(2)}`);
    const scores = samples.map((s, i) => [letterScore(s, measures[i], DEFAULT_GEOMETRY), letterScore(s, measures[i], g)]);
    console.log(`  1-IoU default -> fitted: ${samples.map((s, i) => `${s.char} ${scores[i][0]?.toFixed(3) ?? '-'} -> ${scores[i][1]?.toFixed(3) ?? '-'}`).join('  ')}`);

    // ---------- picture ----------
    const W = GAP + samples.length * (CELL + GAP);
    const png = new PNG({ width: W, height: 2 * CELL + 3 * GAP });
    png.data.fill(255);
    samples.forEach((s, li) => {
      const m = measures[li];
      const b = m.bounds;
      const k = Math.min(CELL / b.h, CELL / b.w);
      const ox = GAP + li * (CELL + GAP) + (CELL - b.w * k) / 2, oy = GAP + (CELL - b.h * k) / 2;
      for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
        const sx = Math.floor((x + GAP + li * (CELL + GAP) - ox) / k) + b.x, sy = Math.floor((y + GAP - oy) / k) + b.y;
        if (sx < b.x || sy < b.y || sx >= b.x + b.w || sy >= b.y + b.h || !s.mask.data[sy * s.mask.width + sx]) continue;
        png.data.set([205, 205, 205, 255], ((y + GAP) * W + x + GAP + li * (CELL + GAP)) * 4);
      }
      const axis = medialAxis(s.mask, m.dist, b);
      axis.forEach((p, pi) => {
        const c = COLOURS[pi % COLOURS.length];
        const P = p.points.map(([x, y]) => [ox + (x - b.x) * k, oy + (y - b.y) * k]);
        for (let i = 0; i < P.length; i++) {
          const a = P[i], q = P[Math.min(P.length - 1, i + 1)];
          const n = Math.ceil(Math.hypot(q[0] - a[0], q[1] - a[1]));
          for (let t = 0; t <= n; t++) dot(png, a[0] + ((q[0] - a[0]) * t) / Math.max(1, n), a[1] + ((q[1] - a[1]) * t) / Math.max(1, n), 1.3, c);
        }
        if (!p.closed && P.length) {
          dot(png, P[0][0], P[0][1], 3.5, p.startJunction ? [220, 0, 0] : [0, 170, 0]);
          dot(png, P[P.length - 1][0], P[P.length - 1][1], 3.5, p.endJunction ? [220, 0, 0] : [0, 170, 0]);
        }
      });
      // Bottom: target vs fitted skeleton, as the fit sees them.
      const tgt = prepareTarget(s.mask, b, m.strokePx / Math.max(1, m.heightPx));
      const sk = renderSkeleton(s.char, g, tgt);
      if (!sk) return;
      const c = tgt.canvas;
      // Show the part of the canvas around the letter.
      const cx0 = Math.max(0, Math.floor(tgt.x - tgt.grow - 0.3 * c.h)), cx1 = Math.min(c.w, Math.ceil(tgt.x + tgt.w + tgt.grow + 0.3 * c.h));
      const kk = Math.min(CELL / c.h, CELL / (cx1 - cx0));
      const bx0 = GAP + li * (CELL + GAP), by0 = 2 * GAP + CELL;
      for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
        const u = Math.floor(x / kk) + cx0, v = Math.floor(y / kk);
        if (v >= c.h || u >= cx1) continue;
        const a = c.data[v * c.w + u], bb = sk.data[v * c.w + u];
        const o = ((by0 + y) * W + bx0 + x) * 4;
        const grey = 255 - 70 * a;
        png.data[o] = grey * (1 - 0.6 * bb);
        png.data[o + 1] = grey * (1 - 0.35 * bb);
        png.data[o + 2] = grey;
      }
    });
    writeFileSync(join(OUT, `measure-${name}.png`), PNG.sync.write(png));
  }
}
