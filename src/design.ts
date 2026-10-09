// The poster a kid designs in the playground: a frame size, a background (colour or gradient), an
// optional pattern from their category, stickers, and their words in their photo letters.
// renderDesign draws it onto a canvas at any scale, so the preview and the saved picture match.
import { LINE, layoutText, materialCanvas, type LetterGlyph } from './font';
import type { Size } from './state';

// ---------- frames ----------

export type FrameId = 'phone' | 'ipad' | 'desktop' | 'a4' | 'a3';

export const FRAMES: Record<FrameId, { label: string; w: number; h: number; note: string }> = {
  phone: { label: 'Phone wallpaper', w: 1170, h: 2532, note: '1170 × 2532' },
  ipad: { label: 'iPad wallpaper', w: 2048, h: 2732, note: '2048 × 2732' },
  desktop: { label: 'Desktop wallpaper', w: 2560, h: 1440, note: '2560 × 1440' },
  a4: { label: 'A4 poster', w: 2480, h: 3508, note: 'prints at 300 dpi' },
  // 250 dpi: at 300 dpi an A3 picture is too big for phones and tablets to make.
  a3: { label: 'A3 poster', w: 2923, h: 4134, note: 'prints at 250 dpi' },
};
export const FRAME_IDS = Object.keys(FRAMES) as FrameId[];

// ---------- the design ----------

export type Fill =
  | { kind: 'solid'; colour: string }
  /** angle: CSS-style degrees (0 = upwards, 90 = to the right); radial ignores it. */
  | { kind: 'gradient'; type: 'linear' | 'radial'; from: string; to: string; angle: number };

export interface Sticker {
  id: string;
  shape: StickerShape;
  /** Centre, as a share of the frame's width and height. */
  x: number;
  y: number;
  /** Size, as a share of the frame's shorter side. */
  size: number;
  /** Degrees, clockwise. */
  rot: number;
  colour: string;
}

export interface Design {
  frame: FrameId;
  fill: Fill;
  /** A pattern id from PATTERNS, or null. */
  pattern: string | null;
  patternColour: string;
  patternOpacity: number;
  stickers: Sticker[];
  /** Centre of the words, as shares of the frame. */
  textX: number;
  textY: number;
}

export const DEFAULT_DESIGN: Design = {
  frame: 'desktop',
  fill: { kind: 'solid', colour: '#ffd23f' },
  pattern: null,
  patternColour: '#1b1b3a',
  patternOpacity: 0.16,
  stickers: [],
  textX: 0.5,
  textY: 0.5,
};

export const INK = '#1b1b3a';
export const PALETTE = ['#ffffff', '#fffaf0', '#ffd23f', '#ff8c42', '#ff5d8f', '#e63946', '#8338ec', '#3a86ff', '#4cc9f0', '#06d6a0', '#2d6a4f', '#8d5524', '#c9c9d6', INK];

// ---------- patterns ----------

/** Patterns draw one tile in units of u (about 3% of the frame's shorter side). */
interface PatternDef {
  id: string;
  label: string;
  /** Tile size in units. */
  tile: [number, number];
  draw: (ctx: CanvasRenderingContext2D, u: number, colour: string) => void;
}

// Fixed "random" spots, so patterns look scattered but never change.
const SPOTS = Array.from({ length: 24 }, (_, i) => ({ x: ((i * 0.618034) % 1), y: ((i * 0.381966 + 0.13) * 7.3) % 1, r: (i * 47) % 360 }));
const rad = (d: number) => (d * Math.PI) / 180;

function leaf(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, rot: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rad(rot));
  ctx.beginPath();
  ctx.moveTo(0, -len / 2);
  ctx.quadraticCurveTo(len * 0.42, 0, 0, len / 2);
  ctx.quadraticCurveTo(-len * 0.42, 0, 0, -len / 2);
  ctx.fill();
  ctx.restore();
}

function lines(ctx: CanvasRenderingContext2D, segs: [number, number, number, number][], width: number) {
  ctx.lineWidth = width;
  ctx.beginPath();
  for (const [a, b, c, d] of segs) {
    ctx.moveTo(a, b);
    ctx.lineTo(c, d);
  }
  ctx.stroke();
}

export const PATTERNS: Record<string, PatternDef[]> = {
  stationery: [
    { id: 'graph', label: 'Graph paper', tile: [2, 2], draw: (c, u) => lines(c, [[0, 0, 2 * u, 0], [0, 0, 0, 2 * u]], 0.08 * u) },
    { id: 'ruled', label: 'Notebook lines', tile: [4, 1.6], draw: (c, u) => lines(c, [[0, 1.5 * u, 4 * u, 1.5 * u]], 0.1 * u) },
    {
      id: 'dotgrid', label: 'Dot grid', tile: [1.6, 1.6], draw: (c, u) => {
        c.beginPath();
        c.arc(0.8 * u, 0.8 * u, 0.12 * u, 0, Math.PI * 2);
        c.fill();
      },
    },
  ],
  tools: [
    {
      id: 'blueprint', label: 'Blueprint', tile: [5, 5], draw: (c, u) => {
        lines(c, [1, 2, 3, 4].flatMap((i): [number, number, number, number][] => [[i * u, 0, i * u, 5 * u], [0, i * u, 5 * u, i * u]]), 0.05 * u);
        lines(c, [[0, 0, 5 * u, 0], [0, 0, 0, 5 * u]], 0.16 * u);
      },
    },
    {
      id: 'treadplate', label: 'Tread plate', tile: [3, 3], draw: (c, u) => {
        c.lineCap = 'round';
        lines(c, [[0.4 * u, 1.1 * u, 1.1 * u, 0.4 * u], [1.9 * u, 1.9 * u, 2.6 * u, 2.6 * u]], 0.32 * u);
      },
    },
    {
      id: 'nuts', label: 'Hex nuts', tile: [3, 3], draw: (c, u) => {
        c.lineWidth = 0.14 * u;
        c.beginPath();
        for (let i = 0; i <= 6; i++) {
          const a = rad(60 * i + 30);
          const px = 1.5 * u + Math.cos(a) * 0.95 * u, py = 1.5 * u + Math.sin(a) * 0.95 * u;
          if (i) c.lineTo(px, py);
          else c.moveTo(px, py);
        }
        c.stroke();
        c.beginPath();
        c.arc(1.5 * u, 1.5 * u, 0.42 * u, 0, Math.PI * 2);
        c.stroke();
      },
    },
  ],
  produce: [
    {
      id: 'gingham', label: 'Picnic check', tile: [2, 2], draw: (c, u) => {
        c.globalAlpha *= 0.55;
        c.fillRect(0, 0, u, 2 * u);
        c.fillRect(0, 0, 2 * u, u);
      },
    },
    { id: 'awning', label: 'Market stripes', tile: [2.4, 1], draw: (c, u) => c.fillRect(0, 0, 1.2 * u, u) },
    {
      id: 'seeds', label: 'Seeds', tile: [6, 6], draw: (c, u) => {
        for (const s of SPOTS.slice(0, 9)) {
          c.save();
          c.translate(s.x * 6 * u, s.y * 6 * u);
          c.rotate(rad(s.r));
          c.beginPath();
          c.ellipse(0, 0, 0.18 * u, 0.32 * u, 0, 0, Math.PI * 2);
          c.fill();
          c.restore();
        }
      },
    },
  ],
  food: [
    {
      id: 'checker', label: 'Tablecloth', tile: [2, 2], draw: (c, u) => {
        c.fillRect(0, 0, u, u);
        c.fillRect(u, u, u, u);
      },
    },
    {
      id: 'sprinkles', label: 'Sprinkles', tile: [6, 6], draw: (c, u) => {
        c.lineCap = 'round';
        c.lineWidth = 0.22 * u;
        SPOTS.slice(0, 14).forEach((s, i) => {
          c.strokeStyle = ['#ff5d8f', '#3a86ff', '#ffd23f', '#06d6a0', '#ff8c42', '#8338ec'][i % 6];
          const a = rad(s.r), x = s.x * 6 * u, y = s.y * 6 * u;
          c.beginPath();
          c.moveTo(x - Math.cos(a) * 0.35 * u, y - Math.sin(a) * 0.35 * u);
          c.lineTo(x + Math.cos(a) * 0.35 * u, y + Math.sin(a) * 0.35 * u);
          c.stroke();
        });
      },
    },
    {
      id: 'polka', label: 'Polka dots', tile: [2.4, 2.4], draw: (c, u) => {
        c.beginPath();
        c.arc(0.6 * u, 0.6 * u, 0.36 * u, 0, Math.PI * 2);
        c.arc(1.8 * u, 1.8 * u, 0.36 * u, 0, Math.PI * 2);
        c.fill();
      },
    },
  ],
  plants: [
    {
      id: 'leaves', label: 'Leaves', tile: [6, 6], draw: (c, u) => {
        for (const s of SPOTS.slice(0, 6)) leaf(c, s.x * 6 * u, s.y * 6 * u, 1.3 * u, s.r);
      },
    },
    {
      id: 'blossoms', label: 'Blossoms', tile: [5, 5], draw: (c, u) => {
        for (const [cx, cy] of [[1.2, 1.2], [3.7, 3.6]]) {
          for (let i = 0; i < 5; i++) {
            const a = rad(72 * i);
            c.beginPath();
            c.arc(cx * u + Math.cos(a) * 0.38 * u, cy * u + Math.sin(a) * 0.38 * u, 0.3 * u, 0, Math.PI * 2);
            c.fill();
          }
        }
      },
    },
    {
      id: 'grass', label: 'Grass', tile: [3, 2.4], draw: (c, u) => {
        c.lineWidth = 0.12 * u;
        c.lineCap = 'round';
        c.beginPath();
        for (const [x, h, lean] of [[0.5, 1.4, 0.3], [1.3, 1.9, -0.2], [2.2, 1.2, 0.25]]) {
          c.moveTo(x * u, 2.3 * u);
          c.quadraticCurveTo(x * u, (2.3 - h / 2) * u, (x + lean) * u, (2.3 - h) * u);
        }
        c.stroke();
      },
    },
  ],
};

export function patternById(id: string | null): PatternDef | null {
  if (!id) return null;
  for (const list of Object.values(PATTERNS)) for (const p of list) if (p.id === id) return p;
  return null;
}

const tileCache = new Map<string, HTMLCanvasElement>();

function patternTile(p: PatternDef, u: number, colour: string): HTMLCanvasElement {
  const key = `${p.id}|${u.toFixed(2)}|${colour}`;
  const hit = tileCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(p.tile[0] * u));
  c.height = Math.max(1, Math.round(p.tile[1] * u));
  const ctx = c.getContext('2d')!;
  // Draw on a tile exactly tile-units wide, so neighbouring tiles join up.
  ctx.scale(c.width / (p.tile[0] * u), c.height / (p.tile[1] * u));
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  p.draw(ctx, u, colour);
  if (tileCache.size > 40) tileCache.delete(tileCache.keys().next().value!);
  tileCache.set(key, c);
  return c;
}

// ---------- stickers ----------

export type StickerShape = 'star' | 'heart' | 'sparkle' | 'burst' | 'bubble' | 'arrow' | 'crown' | 'bolt' | 'smiley' | 'cloud' | 'flower' | 'sun';

function starPath(points: number, inner: number): string {
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? 46 * inner : 46;
    const a = rad((180 / points) * i - 90);
    d += `${i ? 'L' : 'M'}${(50 + Math.cos(a) * r).toFixed(1)} ${(52 + Math.sin(a) * r).toFixed(1)} `;
  }
  return d + 'Z';
}

/** An exact circle (or ellipse) as SVG path data: two half arcs. */
const ring = (cx: number, cy: number, rx: number, ry = rx) => `M${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} Z`;

/** Each sticker: SVG paths in a 100 x 100 box, filled with the sticker's colour (or a fixed one). */
export const STICKERS: { shape: StickerShape; label: string; colour: string; parts: { d: string; fill?: string; stroke?: boolean }[] }[] = [
  { shape: 'star', label: 'Star', colour: '#ffd23f', parts: [{ d: starPath(5, 0.45) }] },
  { shape: 'heart', label: 'Heart', colour: '#ff5d8f', parts: [{ d: 'M50 90 C20 68 4 50 4 31 C4 16 15 6 28 6 C38 6 46 12 50 21 C54 12 62 6 72 6 C85 6 96 16 96 31 C96 50 80 68 50 90 Z' }] },
  { shape: 'sparkle', label: 'Sparkle', colour: '#4cc9f0', parts: [{ d: 'M50 2 C54 34 66 46 98 50 C66 54 54 66 50 98 C46 66 34 54 2 50 C34 46 46 34 50 2 Z' }] },
  { shape: 'burst', label: 'Burst', colour: '#ff8c42', parts: [{ d: starPath(12, 0.72) }] },
  { shape: 'bubble', label: 'Speech bubble', colour: '#ffffff', parts: [{ d: 'M14 8 H86 Q96 8 96 18 V60 Q96 70 86 70 H46 L24 92 L28 70 H14 Q4 70 4 60 V18 Q4 8 14 8 Z' }] },
  { shape: 'arrow', label: 'Arrow', colour: '#06d6a0', parts: [{ d: 'M4 38 H56 V16 L96 50 L56 84 V62 H4 Z' }] },
  { shape: 'crown', label: 'Crown', colour: '#ffd23f', parts: [{ d: 'M10 82 L4 24 L30 48 L50 12 L70 48 L96 24 L90 82 Z' }] },
  { shape: 'bolt', label: 'Lightning', colour: '#ffd23f', parts: [{ d: 'M60 2 L14 58 H44 L34 98 L86 38 H54 L68 2 Z' }] },
  {
    shape: 'smiley', label: 'Smiley', colour: '#ffd23f', parts: [
      { d: ring(50, 50, 46) },
      { d: ring(35, 38, 6, 8) + ring(65, 38, 6, 8), fill: INK, stroke: false },
      { d: 'M28 58 Q50 82 72 58 Q50 72 28 58 Z', fill: INK },
    ],
  },
  { shape: 'cloud', label: 'Cloud', colour: '#ffffff', parts: [{ d: 'M26 80 Q4 80 4 62 Q4 44 22 42 Q24 20 46 20 Q62 20 70 34 Q96 30 96 56 Q96 80 72 80 Z' }] },
  {
    shape: 'flower', label: 'Flower', colour: '#ff5d8f', parts: [
      { d: [0, 72, 144, 216, 288].map((a) => ring(+(50 + Math.cos(rad(a - 90)) * 27).toFixed(1), +(50 + Math.sin(rad(a - 90)) * 27).toFixed(1), 20)).join(' ') },
      { d: ring(50, 50, 15), fill: '#ffd23f' },
    ],
  },
  {
    shape: 'sun', label: 'Sun', colour: '#ff8c42', parts: [
      { d: Array.from({ length: 12 }, (_, i) => { const a = rad(i * 30); const p = (r: number, da: number) => `${(50 + Math.cos(a + da) * r).toFixed(1)} ${(50 + Math.sin(a + da) * r).toFixed(1)}`; return `M${p(30, -0.2)} L${p(48, 0)} L${p(30, 0.2)} Z`; }).join(' ') },
      { d: ring(50, 50, 28), fill: '#ffd23f' },
    ],
  },
];

const pathCache = new Map<string, Path2D>();
const path = (d: string) => pathCache.get(d) ?? (pathCache.set(d, new Path2D(d)), pathCache.get(d)!);

/** Draws a sticker centred at (x, y), `size` pixels across. */
export function drawSticker(ctx: CanvasRenderingContext2D, s: Pick<Sticker, 'shape' | 'colour' | 'rot'>, x: number, y: number, size: number) {
  const def = STICKERS.find((d) => d.shape === s.shape);
  if (!def) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rad(s.rot));
  ctx.scale(size / 100, size / 100);
  ctx.translate(-50, -50);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5;
  ctx.strokeStyle = INK;
  for (const part of def.parts) {
    const p = path(part.d);
    ctx.fillStyle = part.fill ?? s.colour;
    ctx.fill(p);
    if (part.stroke !== false) ctx.stroke(p);
  }
  ctx.restore();
}

// ---------- the words ----------

/** How big the words are drawn, as a share of the biggest that fits. */
const SIZE_SHARE: Record<Size, number> = { S: 0.55, M: 0.78, L: 1 };

const glyphCanvases = new Map<string, HTMLCanvasElement>();
function glyphCanvas(g: LetterGlyph): HTMLCanvasElement {
  let c = glyphCanvases.get(g.id);
  if (!c) {
    c = materialCanvas(g);
    if (glyphCanvases.size > 300) glyphCanvases.delete(glyphCanvases.keys().next().value!);
    glyphCanvases.set(g.id, c);
  }
  return c;
}

export interface Box { x: number; y: number; w: number; h: number }

export interface RenderOptions {
  text: string;
  map: Map<string, LetterGlyph>;
  size: Size;
  /** Pixels per frame pixel (1 = the full-size picture). */
  scale: number;
  /** A small name tag at the bottom, for the saved poster. */
  caption?: string;
}

// Letter shadow: soft and short, and a deeper shade of whatever is behind the letters (colour,
// gradient or pattern) rather than a grey smudge over it, like real things lying on coloured paper.
const SHADOW = { blur: 14, dx: 7, dy: 11, strength: 0.5, shade: 0.6 };

/**
 * Draws the shadow of what `draw` paints (in frame units, `s` = letter scale) under it on `ctx`.
 * The background under the shadow is darkened and multiplied by itself, so it keeps its hue and gets
 * richer: on yellow the shadow is deep amber, on white a soft grey. Only the area around `box` is used.
 */
function drawShadow(ctx: CanvasRenderingContext2D, draw: (c: CanvasRenderingContext2D) => void, box: Box, s: number) {
  const t = ctx.getTransform();
  const k = t.a * s;
  const blur = SHADOW.blur * k, dx = SHADOW.dx * k, dy = SHADOW.dy * k;
  // The area the shadow can reach, in canvas pixels.
  const m = blur * 2 + Math.max(dx, dy);
  const x0 = Math.max(0, Math.floor(t.e + box.x * t.a - m)), y0 = Math.max(0, Math.floor(t.f + box.y * t.d - m));
  const x1 = Math.min(ctx.canvas.width, Math.ceil(t.e + (box.x + box.w) * t.a + m)), y1 = Math.min(ctx.canvas.height, Math.ceil(t.f + (box.y + box.h) * t.d + m));
  if (x1 <= x0 || y1 <= y0) return;
  const w = x1 - x0, h = y1 - y0;
  const layer = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return [c, c.getContext('2d')!];
  };
  // The shadow's shape: the letters, blurred and moved down-right. The letters themselves are drawn
  // off to the left, out of the picture, so only their shadow lands (no hard edge under soft letters).
  const [mask, mc] = layer();
  const away = w + m;
  mc.setTransform(t.a, t.b, t.c, t.d, t.e - x0 - away, t.f - y0);
  mc.shadowColor = '#000';
  mc.shadowBlur = blur;
  mc.shadowOffsetX = dx + away;
  mc.shadowOffsetY = dy;
  draw(mc);
  // The background under it, darkened, cut to the shadow's shape.
  const [tint, tc] = layer();
  tc.drawImage(ctx.canvas, x0, y0, w, h, 0, 0, w, h);
  tc.fillStyle = `rgba(0, 0, 0, ${1 - SHADOW.shade})`;
  tc.globalCompositeOperation = 'source-atop';
  tc.fillRect(0, 0, w, h);
  tc.globalCompositeOperation = 'destination-in';
  tc.globalAlpha = SHADOW.strength;
  tc.drawImage(mask, 0, 0);
  // Multiplied onto the background.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(tint, x0, y0);
  ctx.restore();
}

/** Draws the design. Returns where the words landed, in frame pixels. */
export function renderDesign(ctx: CanvasRenderingContext2D, d: Design, o: RenderOptions): { text: Box } {
  const { w: W, h: H } = FRAMES[d.frame];
  ctx.save();
  ctx.scale(o.scale, o.scale);

  // Background.
  if (d.fill.kind === 'solid') ctx.fillStyle = d.fill.colour;
  else if (d.fill.type === 'radial') {
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
    g.addColorStop(0, d.fill.from);
    g.addColorStop(1, d.fill.to);
    ctx.fillStyle = g;
  } else {
    // CSS-style angle: the gradient line runs through the centre and just reaches the corners.
    const a = rad(d.fill.angle), dx = Math.sin(a), dy = -Math.cos(a);
    const len = Math.abs(W * dx) + Math.abs(H * dy);
    const g = ctx.createLinearGradient(W / 2 - (dx * len) / 2, H / 2 - (dy * len) / 2, W / 2 + (dx * len) / 2, H / 2 + (dy * len) / 2);
    g.addColorStop(0, d.fill.from);
    g.addColorStop(1, d.fill.to);
    ctx.fillStyle = g;
  }
  ctx.fillRect(0, 0, W, H);

  // Pattern, drawn at device resolution so it stays sharp.
  const pat = patternById(d.pattern);
  if (pat && d.patternOpacity > 0) {
    const u = (Math.min(W, H) / 32) * o.scale;
    const tile = patternTile(pat, u, d.patternColour);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = d.patternOpacity;
    ctx.fillStyle = ctx.createPattern(tile, 'repeat')!;
    ctx.fillRect(0, 0, W * o.scale, H * o.scale);
    ctx.restore();
  }

  // The words: wrapped to suit the frame's shape, as big as the size setting allows.
  const content = o.text.trim() || 'PLAY';
  const aspect = W / H;
  const lay = layoutText(content, o.map, 6400 * Math.min(1.2, Math.max(0.42, aspect / 1.6)));
  const textH = (lay.lines - 1) * LINE + lay.top - lay.bottom + 40;
  const fit = Math.min((W * 0.86) / Math.max(lay.width, 1), (H * 0.7) / textH);
  const s = fit * SIZE_SHARE[o.size];
  const tw = lay.width * s, th = textH * s;
  const ox = d.textX * W - tw / 2, oy = d.textY * H - th / 2;
  /** Draws the letters on `c`; `boxes`: also the grey boxes for characters the font doesn't have. */
  const letters = (c: CanvasRenderingContext2D, boxes: boolean) => {
    for (const it of lay.items) {
      if (it.ch === ' ') continue;
      const x = ox + it.x * s;
      const base = oy + (it.line * LINE + lay.top) * s;
      if (!it.glyph) {
        if (boxes) {
          c.fillStyle = '#d6d6e0';
          c.fillRect(x + 40 * s, base - 700 * s, (it.advance - 80) * s, 700 * s);
        }
        continue;
      }
      const g = it.glyph.outline;
      c.imageSmoothingQuality = 'high';
      c.drawImage(glyphCanvas(it.glyph), x + g.lsb * s, base - g.top * s, g.inkWidth * s, (g.top - g.bottom) * s);
    }
  };
  drawShadow(ctx, (c) => letters(c, false), { x: ox, y: oy, w: tw, h: th }, s);
  letters(ctx, true);

  // Stickers, on top.
  const short = Math.min(W, H);
  for (const st of d.stickers) drawSticker(ctx, st, st.x * W, st.y * H, st.size * short);

  if (o.caption) {
    const fs = short * 0.028;
    ctx.font = `800 ${fs}px "Arial Rounded MT Bold", "Trebuchet MS", sans-serif`;
    const tw2 = ctx.measureText(o.caption).width;
    const px = fs * 0.8, py = fs * 0.5;
    const bx = W - tw2 - px * 2 - fs, by = H - fs * 2.4;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, tw2 + px * 2, fs + py * 2, fs);
    else ctx.rect(bx, by, tw2 + px * 2, fs + py * 2);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.textBaseline = 'middle';
    ctx.fillText(o.caption, bx + px, by + py + fs / 2);
  }
  ctx.restore();
  return { text: { x: ox, y: oy, w: tw, h: th } };
}

/** The design as a full-size picture (or scaled to `width` pixels across). */
export function designCanvas(d: Design, o: Omit<RenderOptions, 'scale'>, width?: number): HTMLCanvasElement {
  const f = FRAMES[d.frame];
  const scale = width ? width / f.w : 1;
  const c = document.createElement('canvas');
  c.width = Math.round(f.w * scale);
  c.height = Math.round(f.h * scale);
  renderDesign(c.getContext('2d')!, d, { ...o, scale });
  return c;
}

/** A small square sample of a pattern on a background, for the pattern picker. */
export function drawPatternSample(c: HTMLCanvasElement, id: string, colour: string, background: string, opacity: number) {
  const p = patternById(id);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, c.width, c.height);
  if (!p) return;
  ctx.globalAlpha = Math.max(0.35, opacity);
  ctx.fillStyle = ctx.createPattern(patternTile(p, c.width / 7, colour), 'repeat')!;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalAlpha = 1;
}

/** The fill as a CSS background, for buttons and samples. */
export function fillCss(f: Fill): string {
  if (f.kind === 'solid') return f.colour;
  return f.type === 'radial' ? `radial-gradient(circle, ${f.from}, ${f.to})` : `linear-gradient(${f.angle}deg, ${f.from}, ${f.to})`;
}
