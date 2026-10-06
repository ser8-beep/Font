import { describe, expect, it } from 'vitest';
import { CATEGORY_IDS } from '../src/core/alphabet/category';
import { alphabetChars, verticalRange } from '../src/core/alphabet/letters';
import { svgToContours } from '../src/core/trace';
import { SETS, optionsFor, rankSets } from '../src/library';

const UPPER = alphabetChars({ upper: true, lower: false });
const LOWER = alphabetChars({ upper: false, lower: true });

describe('letters', () => {
  it('are letters only, in the cases the kid made', () => {
    expect(UPPER.join('')).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    expect(alphabetChars({ upper: true, lower: true })).toHaveLength(52);
  });

  it('sit capitals on 0..700 and hang descenders below the line', () => {
    expect(verticalRange('A')).toEqual([0, 700]);
    expect(verticalRange('a')[1]).toBeLessThan(700);
    expect(verticalRange('p')[0]).toBeLessThan(0);
  });
});

describe('letter library', () => {
  it('holds real object alphabets: letters with outlines, in known categories', () => {
    expect(SETS.length).toBeGreaterThan(30);
    for (const s of SETS) {
      expect(CATEGORY_IDS).toContain(s.category);
      expect(s.looks).toHaveLength(6);
      for (const l of s.letters) {
        expect(l.char).toMatch(/^[A-Za-z]$/);
        expect(svgToContours(l.svg).length).toBeGreaterThan(0);
        expect(l.rect[2] * l.rect[3]).toBeGreaterThan(0);
      }
    }
  });

  it('fills a capitals font from one full alphabet of the category', () => {
    const sets = rankSets('stationery', UPPER, null);
    expect(sets[0].category).toBe('stationery');
    for (const ch of UPPER) expect(optionsFor(ch, sets)[0].set).toBe(sets[0]);
  });

  it('prefers a nearby category with capitals over a lowercase-only set for a capitals font', () => {
    const sets = rankSets('hardware', UPPER, null);
    expect(UPPER.every((ch) => sets[0].letters.some((l) => l.char === ch))).toBe(true);
    // A lowercase font still gets the hardware alphabet.
    expect(rankSets('hardware', LOWER, null)[0].category).toBe('hardware');
  });

  it('falls back to the other case only when no alphabet has the letter in the right case', () => {
    const sets = rankSets('produce', LOWER, null);
    const z = optionsFor('z', sets);
    expect(z.length).toBeGreaterThan(0);
    expect(z.every((c) => c.letter.char === z[0].letter.char)).toBe(true);
  });

  it('has every capital for every category, from its own or a nearby alphabet', () => {
    for (const id of CATEGORY_IDS) {
      const sets = rankSets(id, UPPER, null);
      for (const ch of UPPER) expect(optionsFor(ch, sets).length, `${id} ${ch}`).toBeGreaterThan(0);
    }
  });
});
