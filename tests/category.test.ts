import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import jpeg from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { CATEGORY_IDS, CATEGORY_LABELS, ideasFor, matchCategory } from '../src/core/alphabet/category';
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
  it('has every category the picker offers, with a name and letter records', () => {
    expect(CATEGORY_IDS.length).toBe(18);
    for (const id of CATEGORY_IDS) {
      expect(CATEGORY_LABELS[id]).toBeDefined();
      expect(REPOSITORY[id].build).toHaveLength(4);
    }
    expect(CATEGORY_IDS).not.toContain('other');
  });

  it('gives object ideas for letters and none for unknown categories', () => {
    expect(ideasFor('S', 'hardware')).toContain('S-hook');
    expect(ideasFor('S', 'nope')).toEqual([]);
  });
});

describe.skipIf(!existsSync(join(SAMPLES, 'lego.jpg')))('matching photos to categories', () => {
  it('sees Lego as toys and pasta as food', () => {
    const lego = samplesOf('lego.jpg');
    expect(matchCategory(lego, analyseStyle(lego)).ranked[0].id).toBe('leisure');
    const pasta = samplesOf('pasta.jpg');
    expect(matchCategory(pasta, analyseStyle(pasta)).ranked[0].id).toBe('prepared_food');
  });
});
