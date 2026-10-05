import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import jpeg from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { analyse, cleanLetter } from '../src/core/segment';
import { maskToGlyph } from '../src/core/trace';
import { buildTTF } from '../src/core/ttf';

const SAMPLES = join(__dirname, '..', 'samples');
const load = (name: string) => {
  const j = jpeg.decode(readFileSync(join(SAMPLES, name)), { useTArray: true });
  return { width: j.width, height: j.height, data: j.data };
};

describe.skipIf(!existsSync(join(SAMPLES, 'lego.jpg')))('segmentation on sample photos', () => {
  for (const name of ['lego.jpg', 'clay.jpg', 'wool.jpg', 'coffee-beans.jpg', 'gummy-bears.jpg']) {
    it(`finds 4 letters, left to right, in ${name}`, () => {
      const an = analyse(load(name), { expected: 4 });
      expect(an.blobs).toHaveLength(4);
      const xs = an.blobs.map((b) => b.box.x);
      expect([...xs].sort((a, b) => a - b)).toEqual(xs);
      // Letters are roughly the same height.
      const hs = an.blobs.map((b) => b.box.h);
      expect(Math.min(...hs) / Math.max(...hs)).toBeGreaterThan(0.6);
    });
  }

  it('builds a font from a photo in under 2 seconds', () => {
    const img = load('coffee-beans.jpg');
    const t0 = performance.now();
    const an = analyse(img, { expected: 4 });
    const glyphs = an.blobs.map((b, i) => {
      const g = maskToGlyph(cleanLetter(img, an, b, { bolder: 0, fillHoles: b.porous }).mask)!;
      return { codepoints: ['PLAY'.charCodeAt(i)], contours: g.contours, advance: g.advance };
    });
    const ttf = buildTTF({ familyName: 'Beans', glyphs });
    expect(ttf.length).toBeGreaterThan(500);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
