import { zlibSync } from 'fflate';
import type { RGBAImage } from './image';

// A small PNG encoder and a clean resampler, so colour fonts can be built anywhere (page, worker,
// Node) without a canvas.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** 8-bit RGBA PNG. Each row gets whichever filter makes it smallest (the usual heuristic). */
export function encodePNG(img: RGBAImage): Uint8Array {
  const { width: w, height: h, data } = img;
  const stride = w * 4;
  const raw = new Uint8Array((stride + 1) * h);
  const zero = new Uint8Array(stride);
  const tries = Array.from({ length: 5 }, () => new Uint8Array(stride));
  for (let y = 0; y < h; y++) {
    const cur = data.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? data.subarray((y - 1) * stride, y * stride) : zero;
    const [f0, f1, f2, f3, f4] = tries;
    for (let i = 0; i < stride; i++) {
      const x = cur[i], b = up[i];
      const a = i >= 4 ? cur[i - 4] : 0, c = i >= 4 ? up[i - 4] : 0;
      f0[i] = x;
      f1[i] = x - a;
      f2[i] = x - b;
      f3[i] = x - ((a + b) >> 1);
      f4[i] = x - paeth(a, b, c);
    }
    let best = 0, bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const t = tries[f];
      let score = 0;
      for (let i = 0; i < stride; i++) score += t[i] < 128 ? t[i] : 256 - t[i];
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    raw[y * (stride + 1)] = best;
    raw.set(tries[best], y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level: 7 })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * Resize straight-alpha RGBA to w x h. Shrinking averages every source pixel by how much of it
 * each output pixel covers; growing is bilinear. Colours are weighted by alpha, so cut-out edges
 * don't pick up a dark fringe from the transparent pixels around them.
 */
export function resampleRGBA(img: RGBAImage, w: number, h: number): RGBAImage {
  const W = img.width, H = img.height, d = img.data;
  // Premultiplied floats, one pass per direction.
  const pre = new Float32Array(W * H * 4);
  for (let i = 0; i < W * H * 4; i += 4) {
    const a = d[i + 3] / 255;
    pre[i] = d[i] * a; pre[i + 1] = d[i + 1] * a; pre[i + 2] = d[i + 2] * a; pre[i + 3] = d[i + 3];
  }
  const horiz = pass(pre, W, H, w, true);
  const both = pass(horiz, w, H, h, false);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h * 4; i += 4) {
    const a = both[i + 3];
    if (a > 0) {
      const k = 255 / a;
      out[i] = both[i] * k; out[i + 1] = both[i + 1] * k; out[i + 2] = both[i + 2] * k;
    }
    out[i + 3] = a;
  }
  return { width: w, height: h, data: out };
}

/** Weights for resampling n source samples to m: box-filter coverage when shrinking, else linear. */
function weights(n: number, m: number): { start: number; w: number[] }[] {
  const s = n / m;
  return Array.from({ length: m }, (_, j) => {
    if (s > 1) {
      const x0 = j * s, x1 = x0 + s, start = Math.floor(x0), ws: number[] = [];
      for (let x = start; x < Math.min(n, Math.ceil(x1)); x++) ws.push((Math.min(x + 1, x1) - Math.max(x, x0)) / s);
      return { start, w: ws };
    }
    const f = Math.max(0, Math.min(n - 1, (j + 0.5) * s - 0.5)), x0 = Math.floor(f), t = f - x0;
    return x0 + 1 < n ? { start: x0, w: [1 - t, t] } : { start: x0, w: [1] };
  });
}

function pass(src: Float32Array, W: number, H: number, m: number, horizontal: boolean): Float32Array {
  const n = horizontal ? W : H;
  const ws = weights(n, m);
  const outW = horizontal ? m : W, outH = horizontal ? H : m;
  const out = new Float32Array(outW * outH * 4);
  const lines = horizontal ? H : W;
  for (let l = 0; l < lines; l++) {
    for (let j = 0; j < m; j++) {
      const { start, w } = ws[j];
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < w.length; k++) {
        const i = (horizontal ? l * W + start + k : (start + k) * W + l) * 4;
        const wt = w[k];
        r += src[i] * wt; g += src[i + 1] * wt; b += src[i + 2] * wt; a += src[i + 3] * wt;
      }
      const o = (horizontal ? l * outW + j : j * outW + l) * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
    }
  }
  return out;
}
