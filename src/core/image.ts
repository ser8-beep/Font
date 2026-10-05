// Plain image + mask types shared by the browser app and the Node scripts.

export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** Binary (0/1) or soft (0..255) single-channel image. */
export interface Mask {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function makeMask(width: number, height: number): Mask {
  return { width, height, data: new Uint8Array(width * height) };
}

/** Area-averaging downscale (or nearest upscale) so the long side is at most maxSide. */
export function fitImage(img: RGBAImage, maxSide: number): RGBAImage {
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  if (scale === 1) return img;
  return resizeImage(img, Math.max(1, Math.round(img.width * scale)), Math.max(1, Math.round(img.height * scale)));
}

export function resizeImage(img: RGBAImage, w: number, h: number): RGBAImage {
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = img.width / w;
  const sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(img.height, Math.floor((y + 1) * sy)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(img.width, Math.floor((x + 1) * sx)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      // Sample at most a 4x4 grid per output pixel to keep big phone photos fast.
      const stepY = Math.max(1, Math.floor((y1 - y0) / 4));
      const stepX = Math.max(1, Math.floor((x1 - x0) / 4));
      for (let yy = y0; yy < y1; yy += stepY) {
        let i = (yy * img.width + x0) * 4;
        for (let xx = x0; xx < x1; xx += stepX, i += 4 * stepX) {
          r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; a += img.data[i + 3];
          n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return { width: w, height: h, data: out };
}

export function cropImage(img: RGBAImage, box: Box): RGBAImage {
  const out = new Uint8ClampedArray(box.w * box.h * 4);
  for (let y = 0; y < box.h; y++) {
    const sy = y + box.y;
    if (sy < 0 || sy >= img.height) continue;
    for (let x = 0; x < box.w; x++) {
      const sx = x + box.x;
      if (sx < 0 || sx >= img.width) continue;
      const s = (sy * img.width + sx) * 4;
      const o = (y * box.w + x) * 4;
      out[o] = img.data[s]; out[o + 1] = img.data[s + 1]; out[o + 2] = img.data[s + 2]; out[o + 3] = img.data[s + 3];
    }
  }
  return { width: box.w, height: box.h, data: out };
}

export function clampBox(b: Box, width: number, height: number): Box {
  const x = Math.max(0, Math.floor(b.x));
  const y = Math.max(0, Math.floor(b.y));
  const x2 = Math.min(width, Math.ceil(b.x + b.w));
  const y2 = Math.min(height, Math.ceil(b.y + b.h));
  return { x, y, w: Math.max(1, x2 - x), h: Math.max(1, y2 - y) };
}

export function scaleBox(b: Box, s: number): Box {
  return { x: b.x * s, y: b.y * s, w: b.w * s, h: b.h * s };
}

export function padBox(b: Box, pad: number): Box {
  return { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
}

export function unionBox(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
