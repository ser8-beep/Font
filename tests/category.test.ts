import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import jpeg from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { BUILDS, CATEGORY_IDS, CATEGORY_LABELS, buildFor, ideasFor, matchCategory } from '../src/core/alphabet/category';
import { REPOSITORY } from '../src/core/alphabet/repository-data';
import { analyseStyle, renderLetter, type StyleSample } from '../src/core/alphabet';
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

  it('picks a build per letter that stays put for a seed and changes across seeds', () => {
    expect(BUILDS).toContain(buildFor('K', 'stationery', 0));
    expect(buildFor('K', 'stationery', 0)).toBe(buildFor('k', 'stationery', 0));
    const seen = new Set(Array.from({ length: 30 }, (_, s) => buildFor('K', 'stationery', s)));
    expect(seen.size).toBeGreaterThan(1);
    // Books are nearly always copies of one object.
    const books = Array.from({ length: 40 }, (_, s) => buildFor('B', 'books', s));
    expect(books.filter((b) => b === 'repeated').length).toBeGreaterThan(30);
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

  it('grows letters in every category', () => {
    const wool = samplesOf('wool.jpg');
    const style = analyseStyle(wool);
    for (const id of ['textiles', 'stationery', 'books']) expect(renderLetter('K', style, 0, id)).not.toBeNull();
  });
});
