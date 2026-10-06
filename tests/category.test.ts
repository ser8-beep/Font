import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import jpeg from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { CATEGORY_IDS, CATEGORY_LABELS, ideasFor, matchCategory } from '../src/core/alphabet/category';
import { GROUPS, groupOf } from '../src/core/alphabet/groups';
import { REPOSITORY } from '../src/core/alphabet/repository-data';
import { analyseStyle, type StyleSample } from '../src/core/alphabet';
import { cropImage } from '../src/core/image';
import { analyse, cleanLetter } from '../src/core/segment';

const SAMPLES = join(__dirname, '..', 'samples');

function samplesOf(name: string): StyleSample[] {
  const j = jpeg.decode(readFileSync(join(SAMPLES, name)), { useTArray: true });
  const img = { width: j.width, height: j.height, data: j.data };
  const an = analyse(img, { expected: 4 });
  const k = img.width / an.work.width;
  return an.blobs.map((b, i) => {
    const c = cleanLetter(img, an, b, { bolder: 0, fillHoles: b.porous });
    return { char: 'PLAY'[i], image: cropImage(img, c.box), mask: c.mask, raw: c.raw, porous: b.porous, fillRadius: b.porous ? an.fillR * k : 0 };
  });
}

describe('object-type repository', () => {
  it('offers the five categories, each pooling its finer catalogue categories', () => {
    expect(CATEGORY_IDS).toEqual(['stationery', 'tools', 'produce', 'food', 'plants']);
    for (const id of CATEGORY_IDS) {
      expect(CATEGORY_LABELS[id]).toBeDefined();
      expect(REPOSITORY[id].build).toHaveLength(4);
      expect(REPOSITORY[id].count).toBeGreaterThan(20);
    }
  });

  it('keeps the five apart: every finer category belongs to at most one', () => {
    const all = Object.values(GROUPS).flatMap((g) => g.takes);
    expect(new Set(all).size).toBe(all.length);
    expect(groupOf('hardware')).toBe('tools');
    expect(groupOf('art')).toBe('stationery');
    expect(groupOf('household')).toBeNull();
  });

  it('gives object ideas for letters and none for unknown categories', () => {
    expect(ideasFor('S', 'tools')).toContain('S-hook');
    expect(ideasFor('S', 'nope')).toEqual([]);
  });
});

describe.skipIf(!existsSync(join(SAMPLES, 'lego.jpg')))('matching photos to categories', () => {
  it('sees pasta as food and Lego as craft supplies (stationery)', () => {
    const pasta = samplesOf('pasta.jpg');
    expect(matchCategory(pasta, analyseStyle(pasta)).ranked[0].id).toBe('food');
    const lego = samplesOf('lego.jpg');
    expect(matchCategory(lego, analyseStyle(lego)).ranked[0].id).toBe('stationery');
  });
});
