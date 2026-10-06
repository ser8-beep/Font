// Contact sheets of every letter skeleton, for checking the drawings by eye.
//
//   npx tsx scripts/skeleton-preview.ts                  # every variant, every character
//   npx tsx scripts/skeleton-preview.ts --chars=BRa8&    # only these characters
//   npx tsx scripts/skeleton-preview.ts w28 r0           # only variants whose name contains these words
//   npx tsx scripts/skeleton-preview.ts --ppu=160        # bigger glyphs (pixels per skeleton unit, default 72)
//
// Writes samples/_debug/skeletons-<variant>.png. Each glyph is the plain thick-stroke shape from
// buildField (field.ts) at the variant's stroke weight, coloured by stroke role:
//   line = blue, arc = green, bowl = orange, loop = purple, dot = red
// with the centrelines drawn thin and dark, bowl / loop circles as thin grey ellipses, and guide
// lines at the descender, baseline, x-height and cap height.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { buildField } from '../src/core/alphabet/field';
import { DESCENDER, X_HEIGHT, skeletonFor, supportedChars } from '../src/core/alphabet/skeletons';
import { DEFAULT_GEOMETRY, type GeometryParams, type Skeleton, type StrokeRole } from '../src/core/alphabet/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'samples', '_debug');
const args = process.argv.slice(2);
const chars = [...(args.find((a) => a.startsWith('--chars='))?.slice(8) ?? supportedChars())];
const filters = args.filter((a) => !a.startsWith('--'));

const ROLE: Record<StrokeRole, [number, number, number]> = {
  line: [38, 78, 170],
  arc: [24, 140, 84],
  bowl: [226, 122, 18],
  loop: [150, 56, 176],
  dot: [214, 40, 60],
};

interface Variant { name: string; weight: number; geo: Partial<GeometryParams> }
const VARIANTS: Variant[] = [
  { name: 'w05-r1', weight: 0.05, geo: {} },
  { name: 'w15-r1', weight: 0.15, geo: {} },
  { name: 'w28-r1', weight: 0.28, geo: {} },
  { name: 'w05-r0', weight: 0.05, geo: { round: 0 } },
  { name: 'w15-r0', weight: 0.15, geo: { round: 0 } },
  { name: 'w28-r0', weight: 0.28, geo: { round: 0 } },
  { name: 'w15-r05', weight: 0.15, geo: { round: 0.5 } },
  { name: 'w15-wide-slant', weight: 0.15, geo: { width: 1.25, slant: 0.2 } },
  { name: 'w15-params-up', weight: 0.15, geo: { bowl: 0.12, bar: 0.12, fork: 0.12 } },
  { name: 'w15-params-down', weight: 0.15, geo: { bowl: -0.12, bar: -0.12, fork: -0.12 } },
];

const PPU = Number(args.find((a) => a.startsWith('--ppu='))?.slice(6) ?? 72); // pixels per skeleton unit
const PER_ROW = 16;
const GAP = 8;

function render(v: Variant) {
  const geo: GeometryParams = { ...DEFAULT_GEOMETRY, ...v.geo };
  const hw = (v.weight * PPU) / (2 * (1 - v.weight));
  const sks = chars.map((ch) => ({ ch, sk: skeletonFor(ch, geo) })).filter((x): x is { ch: string; sk: Skeleton } => !!x.sk);
  const xs = sks.flatMap(({ sk }) => sk.strokes.flatMap((s) => s.points.map((p) => p[0])));
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const padX = Math.ceil(hw + 4 - Math.min(0, minX) * PPU);
  const cellW = Math.ceil((maxX - Math.min(0, minX)) * PPU + 2 * (hw + 4));
  const top = Math.ceil(hw + 6), base = top + PPU, cellH = Math.ceil(base - DESCENDER * PPU + hw + 6);
  const rows = Math.ceil(sks.length / PER_ROW);
  const W = Math.min(PER_ROW, sks.length) * (cellW + GAP) + GAP, H = rows * (cellH + GAP) + GAP;
  const png = new PNG({ width: W, height: H });
  png.data.fill(255);
  const blend = (x: number, y: number, c: [number, number, number], a: number) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
    const o = (y * W + x) * 4;
    for (let k = 0; k < 3; k++) png.data[o + k] = png.data[o + k] * (1 - a) + c[k] * a;
  };

  sks.forEach(({ sk }, n) => {
    const ox = GAP + (n % PER_ROW) * (cellW + GAP), oy = GAP + Math.floor(n / PER_ROW) * (cellH + GAP);
    // Cell background and guide lines.
    for (let y = 0; y < cellH; y++) for (let x = 0; x < cellW; x++) blend(ox + x, oy + y, [246, 245, 240], 1);
    for (const [gy, c] of [[0, [170, 170, 170]], [X_HEIGHT, [200, 210, 235]], [1, [200, 210, 235]], [DESCENDER, [235, 210, 200]]] as const) {
      for (let x = 0; x < cellW; x++) blend(ox + x, oy + base - gy * PPU, c as unknown as [number, number, number], 1);
    }
    const f = buildField(sk, { pxPerUnit: PPU, halfWidth: hw, margin: 2 });
    const px = (x: number) => ox + padX + (x - f.originX);
    const py = (y: number) => oy + base + (y - f.baselineY);
    for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) {
      const i = y * f.width + x;
      const c = f.coverage[i];
      if (c <= 0) continue;
      const role = f.strokes[f.stroke[i]]?.role ?? 'line';
      blend(px(x), py(y), ROLE[role], c * 0.8);
    }
    // Circles of bowls and loops.
    for (const s of f.strokes) {
      if (!s.circle) continue;
      const { cx, cy, rx, ry } = s.circle;
      const n = Math.max(24, Math.ceil(((rx + ry) * Math.PI) / 2));
      for (let k = 0; k < n; k++) if (k % 2 === 0) {
        const a = (k / n) * Math.PI * 2;
        blend(px(cx + rx * Math.cos(a)), py(cy + ry * Math.sin(a)), [90, 90, 90], 0.9);
      }
    }
    // Centrelines, and a tick at every stroke end.
    for (const s of f.strokes) {
      for (let k = 1; k < s.pts.length; k++) {
        const [ax, ay] = s.pts[k - 1], [bx, by] = s.pts[k];
        const m = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
        for (let t = 0; t <= m; t++) blend(px(ax + ((bx - ax) * t) / m), py(ay + ((by - ay) * t) / m), [20, 20, 20], 0.85);
      }
      for (const [ex, ey] of [s.pts[0], s.pts[s.pts.length - 1]]) {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) blend(px(ex) + dx, py(ey) + dy, [0, 0, 0], 1);
      }
    }
  });
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `skeletons-${v.name}.png`);
  writeFileSync(file, PNG.sync.write(png));
  console.log(`${file}  (${sks.length} glyphs: ${sks.map((s) => s.ch).join('')})`);
}

for (const v of VARIANTS) if (!filters.length || filters.some((f) => v.name.includes(f))) render(v);
