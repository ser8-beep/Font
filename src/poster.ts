import { LINE, layoutText, materialImage, type LetterGlyph } from './font';

const W = 1600, H = 1000;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

/** A colour-block poster of whatever they typed, in their photo letters, on the background they chose. */
export async function renderPoster(text: string, map: Map<string, LetterGlyph>, fontName: string, maker: string, backdrop = '#ffd23f'): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Colour blocks.
  ctx.fillStyle = '#fffaf0';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, W, 760);
  const strip = ['#ff5d8f', '#3a86ff', '#06d6a0', '#ff8c42'];
  strip.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect((W / 4) * i, 760, W / 4, 34);
  });
  ctx.fillStyle = '#1b1b3a';
  ctx.fillRect(0, 794, W, H - 794);

  // The text, fitted into the yellow block.
  const content = text.trim() || 'PLAY';
  const lay = layoutText(content, map, 5600);
  const boxW = W - 160, boxH = 620;
  // From the top of the tallest letter on the first line to the lowest tail on the last.
  const textH = (lay.lines - 1) * LINE + lay.top - lay.bottom + 40;
  const s = Math.min(boxW / Math.max(lay.width, 1), boxH / textH, 0.6);
  const ox = (W - lay.width * s) / 2;
  const oy = 70 + (boxH - textH * s) / 2;
  const images = new Map<string, HTMLImageElement>();
  for (const it of lay.items) if (it.glyph && !images.has(it.glyph.id)) images.set(it.glyph.id, await loadImage(materialImage(it.glyph)));
  for (const it of lay.items) {
    if (it.ch === ' ') continue;
    const x = ox + it.x * s;
    const base = oy + (it.line * LINE + lay.top) * s;
    if (!it.glyph) {
      ctx.fillStyle = '#d6d6e0';
      ctx.strokeStyle = '#a5a5b8';
      ctx.lineWidth = Math.max(2, 14 * s);
      ctx.setLineDash([40 * s, 30 * s]);
      roundRect(ctx, x + 40 * s, base - 700 * s, (it.advance - 80) * s, 700 * s, 40 * s);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }
    const o = it.glyph.outline;
    // Soft shadow, like real things lying on a table.
    ctx.save();
    ctx.shadowColor = 'rgba(27, 27, 58, 0.35)';
    ctx.shadowBlur = 24 * s;
    ctx.shadowOffsetX = 14 * s;
    ctx.shadowOffsetY = 20 * s;
    ctx.drawImage(images.get(it.glyph.id)!, x + o.lsb * s, base - o.top * s, o.inkWidth * s, (o.top - o.bottom) * s);
    ctx.restore();
  }

  // Footer.
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 64px "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(fontName || 'My Font', 70, 870, W - 140);
  ctx.font = '700 34px "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';
  ctx.fillStyle = '#ffd23f';
  ctx.fillText(`${maker ? `Made by ${maker} · ` : ''}Typography Type Play`, 70, 940, W - 140);
  return canvas;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
