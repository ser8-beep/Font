import opentype from 'opentype.js';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { makeMask, type RGBAImage } from '../src/core/image';
import { glyphPicture } from '../src/core/picture';
import { encodePNG, resampleRGBA } from '../src/core/png';
import { maskToGlyph } from '../src/core/trace';
import { buildTTF } from '../src/core/ttf';

function photo(w: number, h: number): RGBAImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      data.set([(x * 7) & 255, (y * 5) & 255, (x * y) & 255, x < w / 2 ? 255 : 120], o);
    }
  return { width: w, height: h, data };
}

function tables(bytes: Uint8Array): Map<string, { off: number; len: number }> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset);
  const out = new Map<string, { off: number; len: number }>();
  for (let i = 0; i < dv.getUint16(4); i++) {
    const r = 12 + i * 16;
    out.set(String.fromCharCode(...bytes.subarray(r, r + 4)), { off: dv.getUint32(r + 8), len: dv.getUint32(r + 12) });
  }
  return out;
}

describe('PNG encoder', () => {
  it('round-trips RGBA pixels exactly', () => {
    const img = photo(37, 23);
    const back = PNG.sync.read(Buffer.from(encodePNG(img)));
    expect([back.width, back.height]).toEqual([37, 23]);
    expect(Buffer.from(back.data).equals(Buffer.from(img.data))).toBe(true);
  });

  it('shrinks cut-outs without a dark edge', () => {
    // Red letter pixels next to transparent black ones.
    const img = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4) };
    for (let i = 0; i < 64; i++) if (i % 8 < 3) img.data.set([255, 0, 0, 255], i * 4);
    const small = resampleRGBA(img, 2, 2);
    expect(small.data[0]).toBe(255); // still red where it is partly see-through
    expect(small.data[3]).toBeGreaterThan(150);
    expect(small.data[7]).toBe(0);
  });
});

describe('colour font', () => {
  const m = makeMask(120, 160);
  for (let y = 10; y < 150; y++) for (let x = 20; x < 100; x++) m.data[y * 120 + x] = 1;
  const o = maskToGlyph(m)!;
  const pic = glyphPicture(photo(o.source.w, o.source.h), o);
  const bytes = buildTTF({ familyName: 'Photo', glyphs: [{ codepoints: [65], contours: o.contours, advance: o.advance, picture: pic }] });
  const t = tables(bytes);
  const dv = new DataView(bytes.buffer, bytes.byteOffset);

  it('writes sbix, CBDT/CBLC and SVG next to the outlines', () => {
    for (const tag of ['glyf', 'sbix', 'CBDT', 'CBLC', 'SVG ']) expect(t.has(tag)).toBe(true);
    const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(font.charToGlyph('A').index).toBe(2);
  });

  it('stores the picture at both sizes in sbix, measured from the outline box', () => {
    const s = t.get('sbix')!.off;
    expect(dv.getUint32(s + 4)).toBe(2);
    const strike = s + dv.getUint32(s + 8);
    expect(dv.getUint16(strike)).toBe(128);
    const g2 = strike + dv.getUint32(strike + 4 + 2 * 4);
    expect(Math.abs(dv.getInt16(g2))).toBeLessThanOrEqual(1);
    expect(Math.abs(dv.getInt16(g2 + 2))).toBeLessThanOrEqual(1);
    expect(String.fromCharCode(...bytes.subarray(g2 + 4, g2 + 8))).toBe('png ');
    expect([...bytes.subarray(g2 + 8, g2 + 12)]).toEqual([137, 80, 78, 71]);
  });

  it('only puts strikes small enough for CBDT single-byte metrics into CBLC', () => {
    const c = t.get('CBLC')!.off;
    expect(dv.getUint32(c + 4)).toBe(1);
    expect(bytes[c + 8 + 44]).toBe(128);
  });

  it('places the SVG picture in font units with y pointing down', () => {
    const s = t.get('SVG ')!;
    const svg = new TextDecoder().decode(bytes.subarray(s.off, s.off + s.len));
    expect(svg).toContain('id="glyph2"');
    expect(svg).toContain(`y="${-o.top}"`);
    expect(svg).toContain('data:image/png;base64,');
  });

  it('still has a whole-font checksum of 0xB1B0AFBA', () => {
    let sum = 0;
    for (let i = 0; i < bytes.length; i += 4) sum = (sum + (((bytes[i] << 24) | (bytes[i + 1] << 16) | ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0)) >>> 0)) >>> 0;
    expect(sum).toBe(0xb1b0afba);
  });
});
