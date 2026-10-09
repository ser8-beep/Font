import { describe, expect, it } from 'vitest';
import { BACKGROUNDS, backgroundGroups, thumbUrl } from '../src/backgrounds';
import { DEFAULT_DESIGN, frameOf } from '../src/design';

describe('picture backgrounds', () => {
  it('have a preview, a size and a calm area inside the picture', () => {
    expect(BACKGROUNDS.length).toBe(56);
    for (const b of BACKGROUNDS) {
      expect(thumbUrl(b.id), b.id).toBeTruthy();
      expect(b.w).toBeGreaterThan(1000);
      const [x, y, w, h] = b.safe;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(1);
      expect(y + h).toBeLessThanOrEqual(1);
      expect(w * h, b.id).toBeGreaterThan(0.15);
    }
  });

  it('offer only the typeface\'s themes\' pictures, then the party cards for invitations', () => {
    const garden = backgroundGroups(['plants']);
    expect(garden.map((g) => g.key)).toEqual(['plants', 'party']);
    // The kitchen pictures belong to both Pantry Raid and Market Basket, and show once.
    expect(backgroundGroups(['food', 'produce']).map((g) => g.key)).toEqual(['food', 'party']);
    expect(backgroundGroups(['tools'])[0].items.length).toBeGreaterThanOrEqual(9);
    // Themes not known yet: every theme's pictures, then the party cards, each picture once.
    const all = backgroundGroups([]).flatMap((g) => g.items);
    expect(new Set(all.map((b) => b.id)).size).toBe(BACKGROUNDS.length);
    expect(all).toHaveLength(BACKGROUNDS.length);
  });

  it('give a picture frame the picture\'s own shape, called an invitation for a party card', () => {
    const card = BACKGROUNDS.find((b) => b.groups.includes('party'))!;
    const f = frameOf({ ...DEFAULT_DESIGN, frame: 'picture', fill: { kind: 'picture', id: card.id } });
    expect([f.w, f.h, f.label]).toEqual([card.w, card.h, 'Invitation']);
    const desk = BACKGROUNDS.find((b) => b.groups.includes('stationery') && !b.groups.includes('party'))!;
    expect(frameOf({ ...DEFAULT_DESIGN, frame: 'picture', fill: { kind: 'picture', id: desk.id } }).label).toBe('Poster');
    expect(frameOf({ ...DEFAULT_DESIGN, frame: 'a4', fill: { kind: 'picture', id: desk.id } }).w).toBe(2480);
  });
});
