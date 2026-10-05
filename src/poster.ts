import { CAP_HEIGHT, LINE, layoutText, materialImage, type LetterGlyph } from './font';

const W = 1600, H = 1000;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

/** A colour-block poster of whatever they typed, in their font. */
export async function renderPoster(text: string, map: Map<string, LetterGlyph>, material: boolean, fontName: string, maker: string): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Colour blocks.
  ctx.fillStyle = '#fffaf0';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffd23f';
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
  const textH = lay.lines * LINE - (LINE - CAP_HEIGHT) + 40;
  const s = Math.min(boxW / Math.max(lay.width, 1), boxH / textH, 0.6);
  const ox = (W - lay.width * s) / 2;
  const oy = 70 + (boxH - textH * s) / 2;
  const images = new Map<string, HTMLImageElement>();
  if (material) {
    for (const it of lay.items) if (it.glyph && !images.has(it.glyph.letterId)) images.set(it.glyph.letterId, await loadImage(materialImage(it.glyph)));
  }
  for (const it of lay.items) {
    if (it.ch === ' ') continue;
    const x = ox + it.x * s;
    const base = oy + (it.line * LINE + CAP_HEIGHT) * s;
    if (!it.glyph) {
      ctx.fillStyle = '#d6d6e0';
      ctx.strokeStyle = '#a5a5b8';
      ctx.lineWidth = Math.max(2, 14 * s);
      ctx.setLineDash([40 * s, 30 * s]);
      roundRect(ctx, x + 40 * s, base - CAP_HEIGHT * s, (it.advance - 80) * s, CAP_HEIGHT * s, 40 * s);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }
    const o = it.glyph.outline;
    if (material) {
      ctx.drawImage(images.get(it.glyph.letterId)!, x + o.lsb * s, base - CAP_HEIGHT * s, o.inkWidth * s, CAP_HEIGHT * s);
    } else {
      ctx.save();
      ctx.translate(x, base);
      ctx.scale(s, -s);
      ctx.fillStyle = '#1b1b3a';
      ctx.fill(new Path2D(it.glyph.svg));
      ctx.restore();
    }
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
