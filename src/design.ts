// The poster or card a kid designs in the playground: a frame size, a background (colour, gradient or
// picture, party cards for birthday invitations among them), an optional pattern from their
// category, their big words in their photo letters, and text boxes in a handwritten or easy-to-read
// font, each with its own size, colour and place.
// renderDesign draws it onto a canvas at any scale, so the preview and the saved picture match.
import { backgroundById, backgroundImage, loadBackground } from './backgrounds';
import { LINE, layoutText, materialCanvas, type Layout, type LetterGlyph } from './font';
import { bodyFont, loadBodyFonts, type BodyFont } from './fonts';
import { FRAMES, type FixedFrame, type Frame, type FrameId } from './frames';
import type { Size } from './state';

// ---------- frames ----------

export { FRAME_IDS, FRAMES, type FixedFrame, type Frame, type FrameId } from './frames';

/** The design's size: a 'picture' frame takes the picture's own shape (a party card's is an invitation). */
export function frameOf(d: Design): Frame {
  const pic = d.fill.kind === 'picture' ? backgroundById(d.fill.id) : null;
  if (d.frame === 'picture' || !(d.frame in FRAMES)) {
    return pic ? { label: pic.groups.includes('party') ? 'Invitation' : 'Poster', w: pic.w, h: pic.h, note: pic.label } : FRAMES.phone;
  }
  return FRAMES[d.frame as FixedFrame];
}

// ---------- the design ----------

export type Fill =
  | { kind: 'solid'; colour: string }
  /** angle: CSS-style degrees (0 = upwards, 90 = to the right); radial ignores it. */
  | { kind: 'gradient'; type: 'linear' | 'radial'; from: string; to: string; angle: number }
  /** A picture from src/backgrounds, covering the frame. */
  | { kind: 'picture'; id: string };

/** A box of text in a simple font: a message, or a party's details. */
export interface TextBox {
  id: string;
  /** A line each. */
  text: string;
  font: BodyFont;
  /** Letter size as a share of the frame's height. */
  size: number;
  /** null: what reads best on the background. */
  colour: string | null;
  /** Where (x, y) is on the text: its left edge, middle or right edge; y is its middle. */
  align: 'left' | 'center' | 'right';
  /** Shares of the frame. */
  x: number;
  y: number;
}

export interface Design {
  frame: FrameId;
  fill: Fill;
  /** A pattern id from PATTERNS, or null. */
  pattern: string | null;
  patternColour: string;
  patternOpacity: number;
  /** Centre of the big words, as shares of the frame. */
  textX: number;
  textY: number;
  /** Text boxes, drawn over the background in this order. */
  boxes: TextBox[];
}

export const DEFAULT_DETAILS = "You're invited to my birthday party!\nSaturday 14 June, 2 to 5 pm\n12 Cherry Lane\nPlease tell us if you can come";

/** Text size choices go between these (shares of the frame's height). */
export const BOX_SIZES = { min: 0.018, max: 0.12, normal: 0.04 };

export const DEFAULT_DESIGN: Design = {
  frame: 'desktop',
  fill: { kind: 'solid', colour: '#f0b819' },
  pattern: null,
  patternColour: '#1b1b3a',
  patternOpacity: 0.16,
  textX: 0.5,
  textY: 0.5,
  boxes: [],
};

export const INK = '#1b1b3a';
/** Colours to pick from: the brand's four first, then a few more for posters and cards. */
export const PALETTE = ['#ffffff', '#fffaf0', '#f0b819', '#eb362d', '#23b56e', '#80b6e4', '#ff8c42', '#ff5d8f', '#8338ec', '#2d6a4f', '#8d5524', '#c9c9d6', INK];

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
          c.strokeStyle = ['#eb362d', '#80b6e4', '#f0b819', '#23b56e'][i % 4];
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

/** Draws a picture to cover W × H (cropped evenly on the long side). */
function cover(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, W: number, H: number) {
  const k = Math.max(W / img.width, H / img.height);
  const w = img.width * k, h = img.height * k;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

/** Paper colour shown while a picture background loads. */
const PAPER = '#f4efe6';

/**
 * Draws the words in photo letters with their soft shadow, `s` frame pixels per font unit, the
 * first line's top-left at (ox, oy). Characters the font doesn't have: grey boxes, or in `fallback`
 * (an invitation's "7" or "!", in a text font and colour).
 */
function drawWords(ctx: CanvasRenderingContext2D, lay: Layout, ox: number, oy: number, s: number, tw: number, th: number, fallback?: { font: BodyFont; colour: string }) {
  const letters = (c: CanvasRenderingContext2D, all: boolean) => {
    for (const it of lay.items) {
      if (it.ch === ' ') continue;
      const x = ox + it.x * s;
      const base = oy + (it.line * LINE + lay.top) * s;
      if (!it.glyph) {
        if (!all) continue;
        if (fallback) {
          c.font = bodyFont(fallback.font, 900 * s);
          c.fillStyle = fallback.colour;
          c.textAlign = 'center';
          c.textBaseline = 'alphabetic';
          c.fillText(it.ch, x + (it.advance * s) / 2, base);
        } else {
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
}

/** Splits text into lines that fit `width` in the current font. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > width) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Where things landed, in frame pixels: the big words, and each text box by id. */
export interface Placed { text: Box; boxes: Record<string, Box> }

/** Draws the design. Returns where the words and text boxes landed, in frame pixels. */
export function renderDesign(ctx: CanvasRenderingContext2D, d: Design, o: RenderOptions): Placed {
  const { w: W, h: H } = frameOf(d);
  const pic = d.fill.kind === 'picture' ? backgroundById(d.fill.id) : null;
  ctx.save();
  ctx.scale(o.scale, o.scale);

  // Background.
  if (d.fill.kind === 'picture') ctx.fillStyle = PAPER;
  else if (d.fill.kind === 'solid') ctx.fillStyle = d.fill.colour;
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
  const img = pic && backgroundImage(pic.id);
  if (img) cover(ctx, img, W, H);

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

  // The big words: in the background's calm middle (a picture's) or inside the margins, on as many
  // lines as makes them biggest, as big as the size setting allows, centred on (textX, textY).
  const S = textArea(d, W, H);
  const fitted = [Infinity, 6400, 5200, 4000, 3000, 2200].map((wrap) => {
    const lay = layoutText(o.text.trim() || 'PLAY', o.map, wrap);
    const textH = (lay.lines - 1) * LINE + lay.top - lay.bottom + 40;
    return { lay, textH, fit: Math.min(S.w / Math.max(lay.width, 1), (S.h * 0.5) / textH) };
  });
  const { lay, textH, fit } = fitted.reduce((x, y) => (y.fit > x.fit * 1.05 ? y : x));
  const s = fit * SIZE_SHARE[o.size];
  const tw = lay.width * s, th = textH * s;
  const ox = d.textX * W - tw / 2, oy = d.textY * H - th / 2;
  drawWords(ctx, lay, ox, oy, s, tw, th, { font: 'hand', colour: inkFor(d) });

  // Text boxes, on top.
  const boxes: Record<string, Box> = {};
  for (const b of d.boxes) boxes[b.id] = drawBox(ctx, d, b, S.w, W, H);

  const short = Math.min(W, H);
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
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(o.caption, bx + px, by + py + fs / 2);
  }
  ctx.restore();
  return { text: { x: ox, y: oy, w: tw, h: th }, boxes };
}

/** Draws a text box (wrapped to `width`) and returns where it landed. */
function drawBox(ctx: CanvasRenderingContext2D, d: Design, b: TextBox, width: number, W: number, H: number): Box {
  const fs = b.size * H;
  const lineH = fs * 1.3;
  ctx.font = bodyFont(b.font, fs);
  const lines = wrapLines(ctx, b.text.trim() || ' ', width);
  const widest = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
  const h = lines.length * lineH;
  const ax = b.x * W, top = b.y * H - h / 2;
  ctx.fillStyle = b.colour ?? inkFor(d);
  ctx.textAlign = b.align;
  ctx.textBaseline = 'alphabetic';
  lines.forEach((line, i) => ctx.fillText(line, ax, top + i * lineH + fs * 1.02));
  const x = b.align === 'left' ? ax : b.align === 'right' ? ax - widest : ax - widest / 2;
  return { x, y: top, w: widest, h };
}

/** Where words and text go, in frame pixels: a picture's calm middle (where the frame crops it), else inside the margins. */
export function textArea(d: Design, W: number, H: number): Box {
  const pic = d.fill.kind === 'picture' ? backgroundById(d.fill.id) : null;
  if (!pic) return { x: W * 0.08, y: H * 0.1, w: W * 0.84, h: H * 0.8 };
  const k = Math.max(W / pic.w, H / pic.h);
  const ox = (W - pic.w * k) / 2, oy = (H - pic.h * k) / 2;
  const [sx, sy, sw, sh] = pic.safe;
  const x0 = Math.max(W * 0.04, ox + sx * pic.w * k), y0 = Math.max(H * 0.04, oy + sy * pic.h * k);
  const x1 = Math.min(W * 0.96, ox + (sx + sw) * pic.w * k), y1 = Math.min(H * 0.96, oy + (sy + sh) * pic.h * k);
  return { x: x0, y: y0, w: Math.max(W * 0.3, x1 - x0), h: Math.max(H * 0.3, y1 - y0) };
}

/** Ink on light colours, white on dark ones. */
function inkOn(hex: string): string {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return INK;
  const [r, g, b] = m.slice(1).map((v) => parseInt(v, 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 120 ? '#ffffff' : INK;
}

/** The text colour that reads best on the design's background. */
export function inkFor(d: Design): string {
  if (d.fill.kind === 'picture') return backgroundById(d.fill.id)?.ink ?? INK;
  return inkOn(d.fill.kind === 'solid' ? d.fill.colour : d.fill.from);
}

/**
 * Where to put things in the background's calm middle, as shares of the frame: the big words in
 * its upper part, a first text box under them, and the nine places a text box can be put
 * (columns left, middle, right; rows top, middle, bottom).
 */
export function spotsFor(d: Design): {
  words: { x: number; y: number };
  /** Under the big words, for a few lines. */
  below: { x: number; y: number; align: TextBox['align'] };
  box: (col: 0 | 1 | 2, row: 0 | 1 | 2) => { x: number; y: number; align: TextBox['align'] };
} {
  const { w: W, h: H } = frameOf(d);
  const S = textArea(d, W, H);
  return {
    words: { x: (S.x + S.w / 2) / W, y: (S.y + S.h * 0.27) / H },
    below: { x: (S.x + S.w / 2) / W, y: (S.y + S.h * 0.775) / H, align: 'center' },
    box: (col, row) => ({
      x: (S.x + (S.w * col) / 2) / W,
      y: (S.y + S.h * [0.14, 0.5, 0.82][row]) / H,
      align: (['left', 'center', 'right'] as const)[col],
    }),
  };
}

/**
 * A text size (share of the frame's height) at which `text` fits under the big words: in the
 * lower part of the background's calm middle, at most the normal size.
 */
export function fitBoxSize(d: Design, text: string, font: BodyFont): number {
  const { w: W, h: H } = frameOf(d);
  const S = textArea(d, W, H);
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return BOX_SIZES.normal;
  for (let size = BOX_SIZES.normal; size > BOX_SIZES.min; size *= 0.92) {
    ctx.font = bodyFont(font, size * H);
    if (wrapLines(ctx, text, S.w).length * size * H * 1.3 <= S.h * 0.42) return size;
  }
  return BOX_SIZES.min;
}

/** Loads what the design needs before it can be drawn in full (its picture, the body text's fonts). */
export async function designReady(d: Design): Promise<void> {
  await Promise.all([d.fill.kind === 'picture' ? loadBackground(d.fill.id).catch(() => undefined) : undefined, loadBodyFonts()]);
}

/** The design as a full-size picture (or scaled to `width` pixels across). */
export function designCanvas(d: Design, o: Omit<RenderOptions, 'scale'>, width?: number): HTMLCanvasElement {
  const f = frameOf(d);
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
  if (f.kind === 'picture') return PAPER;
  return f.type === 'radial' ? `radial-gradient(circle, ${f.from}, ${f.to})` : `linear-gradient(${f.angle}deg, ${f.from}, ${f.to})`;
}
