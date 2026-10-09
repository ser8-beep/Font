// Generates synthetic test photos of the word PLAY made from workshop materials.
// They are stand-ins until real workshop photos are dropped into /samples: busy textures,
// uneven lighting, shadows, JPEG noise, letters slightly rotated.
//
//   npm run samples:make
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 1200, H = 800;

// ---------- deterministic randomness ----------
let seed = 1;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const rr = (a: number, b: number) => a + (b - a) * rnd();
const gauss = () => {
  let s = 0;
  for (let i = 0; i < 4; i++) s += rnd();
  return (s - 2) * 1.7;
};

// ---------- canvas ----------
type RGB = [number, number, number];
const buf = new Float32Array(W * H * 3);
function fillBg(fn: (x: number, y: number) => RGB) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = fn(x, y);
    buf.set(c, (y * W + x) * 3);
  }
}
/** Paint a shape given by a signed distance function (pixels, <0 inside). */
function paint(bx: [number, number, number, number], sdf: (x: number, y: number) => number, shade: (x: number, y: number, d: number) => RGB, alpha = 1) {
  const x0 = Math.max(0, Math.floor(bx[0])), y0 = Math.max(0, Math.floor(bx[1]));
  const x1 = Math.min(W - 1, Math.ceil(bx[2])), y1 = Math.min(H - 1, Math.ceil(bx[3]));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = sdf(x + 0.5, y + 0.5);
    const cov = Math.min(1, Math.max(0, 0.5 - d)) * alpha;
    if (cov <= 0) continue;
    const c = shade(x + 0.5, y + 0.5, d);
    const i = (y * W + x) * 3;
    for (let k = 0; k < 3; k++) buf[i + k] = buf[i + k] * (1 - cov) + c[k] * cov;
  }
}
function softShadow(bx: [number, number, number, number], sdf: (x: number, y: number) => number, soft: number, strength = 0.3) {
  const off = soft * 0.5;
  const x0 = Math.max(0, Math.floor(bx[0] - soft + off)), y0 = Math.max(0, Math.floor(bx[1] - soft + off));
  const x1 = Math.min(W - 1, Math.ceil(bx[2] + soft + off)), y1 = Math.min(H - 1, Math.ceil(bx[3] + soft + off));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = sdf(x - off, y - off);
    if (d > soft) continue;
    const a = strength * Math.min(1, Math.max(0, (soft - d) / (2 * soft)));
    const i = (y * W + x) * 3;
    for (let k = 0; k < 3; k++) buf[i + k] *= 1 - a;
  }
}

const sdCapsule = (px: number, py: number, ax: number, ay: number, bx: number, by: number, r: number) => {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay) / (bax * bax + bay * bay || 1)));
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
};
const sdEllipse = (px: number, py: number, cx: number, cy: number, a: number, b: number, rot: number) => {
  const c = Math.cos(rot), s = Math.sin(rot);
  const x = (px - cx) * c + (py - cy) * s, y = -(px - cx) * s + (py - cy) * c;
  return (Math.hypot(x / a, y / b) - 1) * Math.min(a, b);
};
const sdBox = (px: number, py: number, cx: number, cy: number, hw: number, hh: number, rot: number, rad = 0) => {
  const c = Math.cos(rot), s = Math.sin(rot);
  const x = Math.abs((px - cx) * c + (py - cy) * s) - hw + rad, y = Math.abs(-(px - cx) * s + (py - cy) * c) - hh + rad;
  return Math.hypot(Math.max(x, 0), Math.max(y, 0)) + Math.min(Math.max(x, y), 0) - rad;
};

// ---------- letters as strokes (unit height, y down) ----------
type Seg = [number, number, number, number];
function arc(cx: number, cy: number, r: number, a0: number, a1: number, n = 10): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n;
    out.push([cx + r * Math.cos(t0), cy + r * Math.sin(t0), cx + r * Math.cos(t1), cy + r * Math.sin(t1)]);
  }
  return out;
}
const LETTERS: Record<string, { w: number; segs: Seg[] }> = {
  P: { w: 0.62, segs: [[0, 0, 0, 1], [0, 0, 0.36, 0], [0, 0.52, 0.36, 0.52], ...arc(0.36, 0.26, 0.26, -Math.PI / 2, Math.PI / 2)] },
  L: { w: 0.55, segs: [[0, 0, 0, 1], [0, 1, 0.55, 1]] },
  A: { w: 0.74, segs: [[0, 1, 0.37, 0], [0.37, 0, 0.74, 1], [0.15, 0.64, 0.59, 0.64]] },
  Y: { w: 0.74, segs: [[0, 0, 0.37, 0.5], [0.74, 0, 0.37, 0.5], [0.37, 0.5, 0.37, 1]] },
};

interface Placed {
  ch: string;
  // local (unit) -> image transform
  ox: number; oy: number; size: number; rot: number; w: number;
  segs: Seg[];
}
function toImg(p: Placed, u: number, v: number): [number, number] {
  const cx = p.w / 2, cy = 0.5;
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  const x = (u - cx) * c - (v - cy) * s, y = (u - cx) * s + (v - cy) * c;
  return [p.ox + (x + cx) * p.size, p.oy + (y + cy) * p.size];
}
function toLocal(p: Placed, x: number, y: number): [number, number] {
  const cx = p.w / 2, cy = 0.5;
  const c = Math.cos(-p.rot), s = Math.sin(-p.rot);
  const X = (x - p.ox) / p.size - cx, Y = (y - p.oy) / p.size - cy;
  return [X * c - Y * s + cx, X * s + Y * c + cy];
}
/** Distance (unit coords) from local point to the letter skeleton. */
function skelDist(p: Placed, u: number, v: number): number {
  let d = Infinity;
  for (const s of p.segs) d = Math.min(d, sdCapsule(u, v, s[0], s[1], s[2], s[3], 0));
  return d;
}

function layout(word: string, size: number, gap: number): Placed[] {
  const total = [...word].reduce((s, ch) => s + LETTERS[ch].w * size, 0) + gap * size * (word.length - 1);
  let x = (W - total) / 2 + rr(-30, 30);
  const out: Placed[] = [];
  for (const ch of word) {
    const L = LETTERS[ch];
    out.push({ ch, ox: x, oy: (H - size) / 2 + rr(-35, 35), size, rot: rr(-0.1, 0.1), w: L.w, segs: L.segs });
    x += L.w * size + gap * size * rr(0.8, 1.2);
  }
  return out;
}
function bboxOf(p: Placed, pad: number): [number, number, number, number] {
  const pts = [toImg(p, -0.2, -0.2), toImg(p, p.w + 0.2, -0.2), toImg(p, -0.2, 1.2), toImg(p, p.w + 0.2, 1.2)];
  return [Math.min(...pts.map((q) => q[0])) - pad, Math.min(...pts.map((q) => q[1])) - pad, Math.max(...pts.map((q) => q[0])) + pad, Math.max(...pts.map((q) => q[1])) + pad];
}
/** Points scattered inside the stroke (unit coords), roughly `spacing` apart. */
function scatter(p: Placed, half: number, spacing: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let v = -half; v <= 1 + half; v += spacing * 0.87) {
    for (let u = -half; u <= p.w + half; u += spacing) {
      const uu = u + rr(-0.3, 0.3) * spacing + ((Math.round(v / spacing) % 2) * spacing) / 2, vv = v + rr(-0.3, 0.3) * spacing;
      if (skelDist(p, uu, vv) < half) pts.push([uu, vv]);
    }
  }
  return pts;
}
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const jitter = (c: RGB, amt: number): RGB => [c[0] + gauss() * amt, c[1] + gauss() * amt, c[2] + gauss() * amt];

// ---------- backgrounds ----------
const paper = (base: RGB) => (x: number, y: number): RGB => {
  const n = Math.sin(x * 0.31 + y * 0.17) * 1.5 + gauss() * 2.5;
  return [base[0] + n, base[1] + n, base[2] + n];
};
const wood = (base: RGB) => (x: number, y: number): RGB => {
  const g = Math.sin(y * 0.045 + Math.sin(x * 0.004) * 3 + Math.sin(y * 0.3) * 0.2) * 9 + Math.sin(y * 0.6 + x * 0.002) * 3;
  return [base[0] + g, base[1] + g * 0.8, base[2] + g * 0.5];
};
const cloth = (base: RGB) => (x: number, y: number): RGB => {
  const g = ((x + y) % 4 < 2 ? 4 : -4) + ((x - y + 1000) % 6 < 3 ? 3 : -3) + gauss() * 3;
  return [base[0] + g, base[1] + g, base[2] + g];
};

// ---------- materials ----------
type Material = (letters: Placed[]) => void;

const BRICK_COLOURS: RGB[] = [[200, 30, 35], [245, 200, 20], [20, 90, 190], [30, 150, 70]];
const lego: Material = (letters) => {
  fillBg(paper([228, 226, 220]));
  letters.forEach((p, li) => {
    const cell = 0.15;
    const base = BRICK_COLOURS[li % 4];
    for (let v = -0.1; v <= 1.1; v += cell) for (let u = -0.1; u <= p.w + 0.1; u += cell) {
      const cu = u + cell / 2, cv = v + cell / 2;
      if (skelDist(p, cu, cv) > 0.1) continue;
      const [x, y] = toImg(p, cu, cv);
      const hs = (cell * p.size) / 2;
      const col = jitter(rnd() < 0.15 ? BRICK_COLOURS[(li + 1 + Math.floor(rnd() * 3)) % 4] : base, 6);
      const sd = (px: number, py: number) => sdBox(px, py, x, y, hs - 0.8, hs - 0.8, p.rot, 2);
      const bb: [number, number, number, number] = [x - hs * 1.5, y - hs * 1.5, x + hs * 1.5, y + hs * 1.5];
      softShadow(bb, sd, 8, 0.35);
      paint(bb, sd, (px, py, d) => mix(col, [0, 0, 0], d > -2 ? 0.35 : 0.08 * ((px - x + py - y) / hs)));
      const sr = hs * 0.55;
      paint([x - sr - 2, y - sr - 2, x + sr + 2, y + sr + 2], (px, py) => sdEllipse(px, py, x, y, sr, sr, 0), (px, py) => {
        const t = ((px - x) + (py - y)) / sr;
        return mix(col, t < 0 ? [255, 255, 255] : [0, 0, 0], Math.min(0.4, Math.abs(t) * 0.25));
      });
    }
  });
};

const CLAY: RGB[] = [[235, 120, 40], [150, 70, 190], [20, 170, 170], [235, 80, 140]];
const clay: Material = (letters) => {
  fillBg(wood([214, 186, 150]));
  letters.forEach((p, li) => {
    const half = 0.085;
    const wob = rr(0, 10);
    const sd = (x: number, y: number) => {
      const [u, v] = toLocal(p, x, y);
      const w = Math.sin(u * 23 + wob) * 0.008 + Math.sin(v * 31 + wob * 2) * 0.008;
      return (skelDist(p, u, v) - half - w) * p.size;
    };
    const bb = bboxOf(p, 10);
    softShadow(bb, sd, 14, 0.4);
    paint(bb, sd, (x, y, d) => {
      const depth = Math.min(1, -d / (half * p.size));
      const [u, v] = toLocal(p, x, y);
      const fingerprint = Math.sin(u * 160 + v * 40) * 3;
      return jitter(mix(mix(CLAY[li], [0, 0, 0], 0.35 * (1 - depth)), [255, 255, 255], 0.18 * depth * (v < 0.5 ? 1 : 0.5)), 2).map((c) => c + fingerprint) as RGB;
    });
  });
};

const wool: Material = (letters) => {
  fillBg(paper([238, 236, 232]));
  const cols: RGB[] = [[170, 40, 120], [60, 60, 170], [200, 60, 50], [40, 130, 90]];
  letters.forEach((p, li) => {
    const half = 0.06;
    for (const s of p.segs) {
      const len = Math.hypot(s[2] - s[0], s[3] - s[1]);
      const strands = Math.round(14 + len * 6);
      for (let k = 0; k < strands; k++) {
        const off = rr(-half, half), wob = rr(0, 6);
        const nx = -(s[3] - s[1]) / len, ny = (s[2] - s[0]) / len;
        const steps = Math.max(2, Math.round(len * 14));
        const col = jitter(cols[li], 14);
        for (let i = 0; i < steps; i++) {
          const t0 = i / steps - 0.05, t1 = (i + 1) / steps + 0.05;
          const o0 = off + Math.sin(t0 * 9 + wob) * 0.012, o1 = off + Math.sin(t1 * 9 + wob) * 0.012;
          const [ax, ay] = toImg(p, s[0] + (s[2] - s[0]) * t0 + nx * o0, s[1] + (s[3] - s[1]) * t0 + ny * o0);
          const [bx, by] = toImg(p, s[0] + (s[2] - s[0]) * t1 + nx * o1, s[1] + (s[3] - s[1]) * t1 + ny * o1);
          const r = 1.8;
          paint([Math.min(ax, bx) - 3, Math.min(ay, by) - 3, Math.max(ax, bx) + 3, Math.max(ay, by) + 3], (x, y) => sdCapsule(x, y, ax, ay, bx, by, r), (_x, _y, d) => mix(col, [0, 0, 0], d > -0.8 ? 0.3 : 0), 0.9);
        }
      }
      // Fuzzy fibres.
      for (let k = 0; k < len * 60; k++) {
        const t = rnd();
        const [x, y] = toImg(p, s[0] + (s[2] - s[0]) * t + rr(-half * 1.3, half * 1.3), s[1] + (s[3] - s[1]) * t + rr(-half * 1.3, half * 1.3));
        const a = rr(0, Math.PI), l = rr(3, 9);
        paint([x - l, y - l, x + l, y + l], (px, py) => sdCapsule(px, py, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.5), () => jitter(cols[li], 20), 0.6);
      }
    }
  });
};

const beans: Material = (letters) => {
  fillBg(paper([240, 234, 220]));
  letters.forEach((p) => {
    for (const [u, v] of scatter(p, 0.1, 0.075)) {
      const [x, y] = toImg(p, u, v);
      const a = p.size * 0.036, b = p.size * 0.025, rot = rr(0, Math.PI);
      const col: RGB = jitter([72, 42, 24], 8);
      const sd = (px: number, py: number) => sdEllipse(px, py, x, y, a, b, rot);
      const bb: [number, number, number, number] = [x - a - 4, y - a - 4, x + a + 4, y + a + 4];
      softShadow(bb, sd, 6, 0.3);
      paint(bb, sd, (px, py, d) => {
        const c = Math.cos(rot), s = Math.sin(rot);
        const ly = -(px - x) * s + (py - y) * c;
        const crease = Math.abs(ly + Math.sin(((px - x) * c + (py - y) * s) / a * 3) * 1.5) < 1.6 ? 0.55 : 0;
        const hl = Math.max(0, 1 - Math.hypot(px - x + a * 0.3, py - y + b * 0.4) / (a * 0.6)) * 0.35;
        return mix(mix(col, [0, 0, 0], crease + (d > -2 ? 0.2 : 0)), [255, 230, 200], hl);
      });
    }
  });
};

const GUMMY: RGB[] = [[230, 30, 40], [255, 140, 0], [250, 210, 30], [60, 190, 60], [240, 240, 220]];
const gummy: Material = (letters) => {
  fillBg(paper([246, 246, 246]));
  letters.forEach((p) => {
    for (const [u, v] of scatter(p, 0.1, 0.1)) {
      const [x, y] = toImg(p, u, v);
      const rot = rr(0, Math.PI * 2);
      const col = GUMMY[Math.floor(rnd() * GUMMY.length)];
      const s = p.size * 0.04;
      const hx = Math.cos(rot) * s * 1.1, hy = Math.sin(rot) * s * 1.1;
      const sd = (px: number, py: number) => Math.min(sdEllipse(px, py, x, y, s, s * 0.8, rot), sdEllipse(px, py, x + hx, y + hy, s * 0.62, s * 0.62, 0));
      const bb: [number, number, number, number] = [x - s * 2.2, y - s * 2.2, x + s * 2.2, y + s * 2.2];
      softShadow(bb, sd, 7, 0.22);
      paint(bb, sd, (px, py, d) => {
        const depth = Math.min(1, -d / s);
        const hl = Math.max(0, 1 - Math.hypot(px - x + s * 0.4, py - y + s * 0.4) / (s * 0.35));
        return mix(mix(col, [0, 0, 0], 0.25 * depth), [255, 255, 255], hl * 0.7);
      }, 0.85);
    }
  });
};

const pasta: Material = (letters) => {
  fillBg(cloth([40, 55, 110]));
  letters.forEach((p) => {
    for (const [u, v] of scatter(p, 0.1, 0.085)) {
      const [x, y] = toImg(p, u, v);
      const rot = rr(0, Math.PI), hl = p.size * 0.05, hw = p.size * 0.017;
      const col: RGB = jitter([236, 200, 110], 8);
      const sd = (px: number, py: number) => sdBox(px, py, x, y, hl, hw, rot, hw * 0.8);
      const bb: [number, number, number, number] = [x - hl - 6, y - hl - 6, x + hl + 6, y + hl + 6];
      softShadow(bb, sd, 6, 0.4);
      paint(bb, sd, (px, py, d) => {
        const c = Math.cos(rot), s = Math.sin(rot);
        const lx = (px - x) * c + (py - y) * s;
        return mix(col, [120, 80, 20], (Math.sin(lx * 1.3) > 0.6 ? 0.25 : 0) + (d > -2 ? 0.2 : 0));
      });
    }
  });
};

const BUTTONS: RGB[] = [[220, 40, 60], [30, 120, 220], [250, 190, 30], [120, 200, 80], [250, 250, 250], [150, 60, 180]];
const buttons: Material = (letters) => {
  fillBg(cloth([190, 190, 185]));
  letters.forEach((p) => {
    for (const [u, v] of scatter(p, 0.1, 0.105)) {
      const [x, y] = toImg(p, u, v);
      const r = p.size * rr(0.04, 0.055);
      const col = jitter(BUTTONS[Math.floor(rnd() * BUTTONS.length)], 6);
      const sd = (px: number, py: number) => sdEllipse(px, py, x, y, r, r, 0);
      const bb: [number, number, number, number] = [x - r - 6, y - r - 6, x + r + 6, y + r + 6];
      softShadow(bb, sd, 6, 0.35);
      paint(bb, sd, (px, py, d) => {
        const rim = d > -r * 0.2 ? 0.15 : 0;
        const hole = [[-1, -1], [1, -1], [-1, 1], [1, 1]].some(([a, b]) => Math.hypot(px - x - a * r * 0.22, py - y - b * r * 0.22) < r * 0.1);
        return hole ? mix(col, [0, 0, 0], 0.6) : mix(col, [0, 0, 0], rim);
      });
    }
  });
};

const honey: Material = (letters) => {
  fillBg(paper([250, 250, 248]));
  letters.forEach((p) => {
    const half = 0.07;
    const sd = (x: number, y: number) => {
      const [u, v] = toLocal(p, x, y);
      return (skelDist(p, u, v) - half - Math.sin(u * 40 + v * 13) * 0.006) * p.size;
    };
    const bb = bboxOf(p, 10);
    paint(bb, sd, (x, y, d) => {
      const depth = Math.min(1, -d / (half * p.size));
      const [u, v] = toLocal(p, x, y);
      const gloss = Math.abs(skelDist(p, u + 0.02, v + 0.02) - half * 0.4) < 0.012 ? 0.6 : 0;
      return mix(mix([235, 170, 40], [150, 70, 0], depth * 0.7), [255, 255, 240], gloss);
    }, 0.88);
  });
};

const STRAWS: RGB[] = [[240, 60, 90], [40, 170, 230], [250, 200, 0], [110, 200, 90]];
const straws: Material = (letters) => {
  fillBg(wood([225, 205, 175]));
  letters.forEach((p, li) => {
    for (const s of p.segs) {
      const [ax, ay] = toImg(p, s[0], s[1]);
      const [bx, by] = toImg(p, s[2], s[3]);
      const r = p.size * 0.03;
      const col = STRAWS[li];
      const sd = (x: number, y: number) => sdCapsule(x, y, ax, ay, bx, by, r);
      const bb: [number, number, number, number] = [Math.min(ax, bx) - r - 8, Math.min(ay, by) - r - 8, Math.max(ax, bx) + r + 8, Math.max(ay, by) + r + 8];
      softShadow(bb, sd, 6, 0.3);
      paint(bb, sd, (_x, _y, d) => mix(col, d < -r * 0.5 ? [255, 255, 255] : [0, 0, 0], d < -r * 0.5 ? 0.25 : 0.15));
    }
  });
};

// ---------- finishing ----------
function finish(light: { angle: number; strength: number; vignette: number; tint: RGB; noise: number }) {
  const cx = Math.cos(light.angle), cy = Math.sin(light.angle);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W - 0.5, v = y / H - 0.5;
    const g = 1 + light.strength * (u * cx + v * cy) * 2;
    const vig = 1 - light.vignette * (u * u + v * v) * 2.2;
    const i = (y * W + x) * 3;
    for (let k = 0; k < 3; k++) buf[i + k] = buf[i + k] * g * vig * light.tint[k] + gauss() * light.noise;
  }
}

function save(path: string, w = W, h = H) {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.floor((x * W) / w), sy = Math.floor((y * H) / h);
    const i = (sy * W + sx) * 3, o = (y * w + x) * 4;
    data[o] = Math.max(0, Math.min(255, buf[i]));
    data[o + 1] = Math.max(0, Math.min(255, buf[i + 1]));
    data[o + 2] = Math.max(0, Math.min(255, buf[i + 2]));
    data[o + 3] = 255;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, jpeg.encode({ data, width: w, height: h }, 82).data);
  console.log('wrote', path);
}

const MATERIALS: Record<string, { fn: Material; size: number; gap: number }> = {
  lego: { fn: lego, size: 300, gap: 0.3 },
  clay: { fn: clay, size: 300, gap: 0.28 },
  wool: { fn: wool, size: 300, gap: 0.3 },
  'coffee-beans': { fn: beans, size: 300, gap: 0.3 },
  'gummy-bears': { fn: gummy, size: 290, gap: 0.32 },
  pasta: { fn: pasta, size: 300, gap: 0.3 },
  buttons: { fn: buttons, size: 290, gap: 0.33 },
  honey: { fn: honey, size: 300, gap: 0.28 },
  straws: { fn: straws, size: 300, gap: 0.3 },
};

let n = 0;
for (const [name, m] of Object.entries(MATERIALS)) {
  seed = 1000 + n * 77;
  m.fn(layout('PLAY', m.size, m.gap));
  finish({ angle: rr(0, Math.PI * 2), strength: rr(0.12, 0.22), vignette: rr(0.15, 0.3), tint: [1.0, rr(0.96, 1.0), rr(0.88, 0.97)], noise: 4 });
  save(join(ROOT, 'samples', `${name}.jpg`));
  if (name === 'lego') save(join(ROOT, 'samples', 'lego-demo.jpg'), 960, 640);
  n++;
}

// A harder Lego shot: strong side light and a tighter layout, like a webcam at a dim table.
seed = 4242;
lego(layout('PLAY', 320, 0.18));
finish({ angle: 0.3, strength: 0.4, vignette: 0.45, tint: [1, 0.95, 0.85], noise: 7 });
save(join(ROOT, 'samples', 'lego-dim-webcam.jpg'), 960, 640);
