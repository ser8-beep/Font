import opentype from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { makeMask } from '../src/core/image';
import { contoursToSvg, maskToGlyph, svgToContours } from '../src/core/trace';
import { buildTTF, postScriptName } from '../src/core/ttf';

function ring(w = 200, h = 260, inner = 0.35) {
  const m = makeMask(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (x - w / 2) / (w * 0.45), dy = (y - h / 2) / (h * 0.46);
      const r = dx * dx + dy * dy;
      m.data[y * w + x] = r < 1 && r > inner ? 1 : 0;
    }
  return m;
}

function signedArea(c: { x: number; y: number }[]) {
  let s = 0;
  for (let i = 0; i < c.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

describe('maskToGlyph', () => {
  it('traces an outer contour and a hole with opposite TrueType winding', () => {
    const g = maskToGlyph(ring())!;
    expect(g.contours).toHaveLength(2);
    const areas = g.contours.map(signedArea).sort((a, b) => Math.abs(b) - Math.abs(a));
    expect(areas[0]).toBeLessThan(0); // outer: clockwise
    expect(areas[1]).toBeGreaterThan(0); // hole: counter-clockwise
    const ys = g.contours.flat().map((p) => p.y);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-5);
    expect(Math.max(...ys)).toBeLessThanOrEqual(705);
  });

  it('round-trips through SVG path data', () => {
    const g = maskToGlyph(ring())!;
    const back = svgToContours(contoursToSvg(g.contours));
    expect(back).toHaveLength(2);
    expect(Math.abs(signedArea(back[0]))).toBeGreaterThan(1000);
  });

  it('returns null for an empty mask', () => {
    expect(maskToGlyph(makeMask(50, 50))).toBeNull();
  });
});

describe('buildTTF', () => {
  const g = maskToGlyph(ring())!;
  const bytes = buildTTF({
    familyName: "Zoë's Font",
    designer: 'Zoë',
    glyphs: [
      { codepoints: [79, 111], contours: g.contours, advance: g.advance },
      { codepoints: [80, 112], contours: g.contours, advance: g.advance + 40 },
    ],
  });
  const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

  it('is TrueType-flavoured and parses', () => {
    expect(new DataView(bytes.buffer).getUint32(0)).toBe(0x00010000);
    expect(font.unitsPerEm).toBe(1000);
    expect(font.glyphs.length).toBe(4);
  });

  it('maps uppercase and lowercase to the same glyph', () => {
    expect(font.charToGlyph('O').index).toBe(font.charToGlyph('o').index);
    expect(font.charToGlyph('P').index).toBe(font.charToGlyph('p').index);
    expect(font.charToGlyph('O').index).not.toBe(font.charToGlyph('P').index);
    expect(font.charToGlyph(' ').advanceWidth).toBe(300);
    expect(font.charToGlyph('P').advanceWidth).toBe(g.advance + 40);
  });

  it('has a whole-font checksum of 0xB1B0AFBA', () => {
    let sum = 0;
    for (let i = 0; i < bytes.length; i += 4) sum = (sum + (((bytes[i] << 24) | (bytes[i + 1] << 16) | ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0)) >>> 0)) >>> 0;
    expect(sum).toBe(0xb1b0afba);
  });

  it('keeps unicode family names and makes an ASCII PostScript name', () => {
    expect(font.names.windows?.fontFamily?.en ?? font.names.fontFamily?.en).toBe("Zoë's Font");
    expect(postScriptName("Zoë's Font")).toBe('ZoesFont-Regular');
  });
});
