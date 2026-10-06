import type { RGBAImage } from '../../image';
import { components, erode, type Component } from '../../mask';
import type { Measure, P2, StyleSample } from '../types';

// Letters made of many separate pieces: coffee beans, buttons, gummy bears, pasta, stars, coins,
// pencil shavings, eraser dots, beads.
//
// Extraction cuts every clean piece out of the photo (the separate blobs of the thresholded mask,
// before gaps were filled) and measures how the kid laid them: piece size, spacing, whether they
// sit single-file along the stroke (a row of stars or coins) or fill it (a pile of beans), and
// whether they point along the stroke (pasta) or every which way (gummy bears).
// Rendering lays the same pieces the same way along the new letter's strokes.

interface Sprite {
  /** Cut-out piece (straight RGBA, soft edge), centred. */
  img: RGBAImage;
  /** Principal-axis angle of the piece in the photo (radians, image coordinates). */
  angle: number;
}

export interface PiecesMaterial {
  kind: 'pieces';
  sprites: Sprite[];
  /** Source letter height, px (sprite pixels -> rel units). */
  heightPx: number;
  /** Typical centre-to-centre distance of neighbouring pieces, rel units. */
  spacingRel: number;
  /** Pieces sit in a single row along the stroke rather than filling it. */
  single: boolean;
  /** Pieces point along the stroke (angle offset alignOffset) rather than at random. */
  aligned: boolean;
  alignOffset: number;
}

const MAX_SPRITES = 60;

export function extractPieces(sample: StyleSample, m: Measure): PiecesMaterial | null {
  const H = m.heightPx;
  if (!H) return null;
  const raw = sample.raw;
  const minArea = Math.max(6, H * H * 0.0004);
  const sep = separate(raw, minArea, H);
  if (!sep) return null;
  const { labels, sized, clean, medArea } = sep;
  const typical = clean.map((c) => c.area).sort((a, b) => a - b)[clean.length >> 1];
  const pieceSize = Math.sqrt(typical);
  // A letter of a few big parts (three pencils) is not "pieces".
  if (pieceSize > H * 0.3) return null;
  void medArea;

  // Spacing from density: the pieces' own ink spread over the (gap-filled) letter area.
  let rawInk = 0, letterArea = 0;
  for (let i = 0; i < raw.data.length; i++) { rawInk += raw.data[i] ? 1 : 0; letterArea += sample.mask.data[i] ? 1 : 0; }
  const perPiece = rawInk > 0 ? (letterArea * typical) / rawInk : typical * 1.5;
  const spacing = Math.max(pieceSize * 0.8, Math.sqrt(perPiece));

  // Single-file or filling the stroke: how many pieces fit across it.
  const single = m.strokePx / pieceSize < 1.5;
  void sized;

  // Piece angles vs the local stroke direction.
  const pathPts = m.paths.flatMap((p) => p.points.map((q, i) => ({ q, dir: dirAt(p.points, i) })));
  const diffs: number[] = [];
  const sprites: Sprite[] = [];
  const step = Math.max(1, Math.floor(clean.length / MAX_SPRITES));
  clean.forEach((c, idx) => {
    const { angle, elong } = moments(labels, raw.width, c.label, c.box);
    if (elong > 1.5 && pathPts.length) {
      let best = Infinity, dir = 0;
      for (const p of pathPts) {
        const d = (p.q[0] - c.cx) ** 2 + (p.q[1] - c.cy) ** 2;
        if (d < best) { best = d; dir = p.dir; }
      }
      diffs.push(wrapHalf(angle - dir));
    }
    if (idx % step === 0 && sprites.length < MAX_SPRITES) sprites.push({ img: cutPiece(sample, labels, c.label, c.box), angle });
  });
  diffs.sort((a, b) => Math.abs(a) - Math.abs(b));
  const medDiff = diffs.length >= 4 ? diffs[diffs.length >> 1] : Math.PI / 2;
  const aligned = diffs.length >= 4 && Math.abs(medDiff) < (25 * Math.PI) / 180;

  return { kind: 'pieces', sprites, heightPx: H, spacingRel: spacing / H, single, aligned, alignOffset: aligned ? medDiff : 0 };
}

/**
 * Split touching pieces apart: shrink the mask a little at a time until it falls apart into the
 * most similar-sized blobs, then grow each blob back over its own pixels. Returns the labels and
 * the typical ("clean") pieces, or null when the letter is not made of pieces.
 */
function separate(raw: { width: number; height: number; data: Uint8Array }, minArea: number, H: number) {
  type Pick = { labels: Int32Array; comps: Component[]; r: number; score: number };
  let best: Pick | null = null;
  for (const k of [0, 0.006, 0.012, 0.02, 0.03, 0.045]) {
    const r = Math.round(H * k);
    if (k > 0 && r < 1) continue;
    const m = r ? erode(raw, r) : raw;
    const { labels, comps } = components(m);
    const sized = comps.filter((c) => c.area >= minArea * (r ? 0.3 : 1));
    if (sized.length < 6) continue;
    const areas = sized.map((c) => c.area).sort((a, b) => a - b);
    const med = areas[areas.length >> 1];
    const score = sized.filter((c) => c.area >= med * 0.35 && c.area <= med * 2.2).length;
    if (!best || score > best.score * 1.15) best = { labels, comps, r, score };
  }
  if (!best || best.score < 6) return null;
  // Grow the shrunken blobs back over the original mask (breadth first, r + 1 steps).
  const { width: w, height: h } = raw;
  const labels = best.labels.slice();
  let frontier: number[] = [];
  for (let i = 0; i < w * h; i++) if (labels[i]) frontier.push(i);
  for (let step = 0; step <= best.r && frontier.length; step++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % w, y = (i / w) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j < 0 || labels[j] || !raw.data[j]) continue;
        labels[j] = labels[i];
        next.push(j);
      }
    }
    frontier = next;
  }
  // Recount areas and boxes after growing.
  const stats = new Map<number, Component>();
  for (let i = 0; i < w * h; i++) {
    const l = labels[i];
    if (!l) continue;
    const x = i % w, y = (i / w) | 0;
    let c = stats.get(l);
    if (!c) stats.set(l, (c = { label: l, area: 0, box: { x, y, w: 1, h: 1 }, cx: 0, cy: 0, touchesEdge: false }));
    c.area++; c.cx += x; c.cy += y;
    const x2 = Math.max(c.box.x + c.box.w - 1, x), y2 = Math.max(c.box.y + c.box.h - 1, y);
    c.box.x = Math.min(c.box.x, x); c.box.y = Math.min(c.box.y, y);
    c.box.w = x2 - c.box.x + 1; c.box.h = y2 - c.box.y + 1;
  }
  const all = [...stats.values()].map((c) => ({ ...c, cx: c.cx / c.area, cy: c.cy / c.area }));
  const sized = all.filter((c) => c.area >= minArea);
  if (sized.length < 6) return null;
  const areas = sized.map((c) => c.area).sort((a, b) => a - b);
  const medArea = areas[areas.length >> 1];
  // Touching pieces still merged are bigger, crumbs are smaller: keep the typical ones.
  const clean = sized.filter((c) => c.area >= medArea * 0.35 && c.area <= medArea * 2.2);
  if (clean.length < 6) return null;
  return { labels, sized, clean, medArea };
}

function cutPiece(s: StyleSample, labels: Int32Array, label: number, box: { x: number; y: number; w: number; h: number }): RGBAImage {
  const pad = 2;
  const w = box.w + pad * 2, h = box.h + pad * 2;
  const img: RGBAImage = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  const W = s.raw.width;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < s.raw.height && labels[y * W + x] === label;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x + box.x - pad, sy = y + box.y - pad;
      // Soft edge: average of the 3x3 neighbourhood.
      let a = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) a += inside(sx + dx, sy + dy) ? 1 : 0;
      if (!a) continue;
      const cx = Math.min(s.image.width - 1, Math.max(0, sx)), cy = Math.min(s.image.height - 1, Math.max(0, sy));
      const si = (cy * s.image.width + cx) * 4, o = (y * w + x) * 4;
      img.data[o] = s.image.data[si];
      img.data[o + 1] = s.image.data[si + 1];
      img.data[o + 2] = s.image.data[si + 2];
      img.data[o + 3] = (a / 9) * 255;
    }
  }
  return img;
}

function moments(labels: Int32Array, W: number, label: number, box: { x: number; y: number; w: number; h: number }): { angle: number; elong: number } {
  let n = 0, sx = 0, sy = 0;
  for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) if (labels[y * W + x] === label) { n++; sx += x; sy += y; }
  const mx = sx / n, my = sy / n;
  let xx = 0, xy = 0, yy = 0;
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      if (labels[y * W + x] !== label) continue;
      xx += (x - mx) ** 2; xy += (x - mx) * (y - my); yy += (y - my) ** 2;
    }
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const tr = xx + yy, det = xx * yy - xy * xy;
  const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det)), l2 = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  return { angle, elong: Math.sqrt(l1 / Math.max(1e-6, l2)) };
}

function dirAt(pts: P2[], i: number): number {
  const a = pts[Math.max(0, i - 3)], b = pts[Math.min(pts.length - 1, i + 3)];
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

/** Wrap an angle difference of two undirected axes into (-pi/2, pi/2]. */
function wrapHalf(a: number): number {
  while (a > Math.PI / 2) a -= Math.PI;
  while (a <= -Math.PI / 2) a += Math.PI;
  return a;
}

