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

  it('offer only the typeface\'s themes\' pictures, and the party cards for invitations', () => {
    const invite = backgroundGroups(['plants'], true);
    expect(invite.map((g) => g.key)).toEqual(['party', 'plants']);
    expect(invite[0].items).toHaveLength(9);
    // A poster: only its themes; the kitchen pictures belong to both Pantry Raid and Market Basket, shown once.
    expect(backgroundGroups(['food', 'produce'], false).map((g) => g.key)).toEqual(['food']);
    expect(backgroundGroups(['tools'], false)[0].items).toHaveLength(9);
    // Themes not known yet: every theme's pictures, each once, and no party cards on a poster.
    const all = backgroundGroups([], false).flatMap((g) => g.items);
    expect(all.some((b) => b.groups.length === 1 && b.groups[0] === 'party')).toBe(false);
    expect(new Set(all.map((b) => b.id)).size).toBe(all.length);
    expect(all).toHaveLength(BACKGROUNDS.filter((b) => b.groups.some((g) => g !== 'party')).length);
  });

  it('give an invitation the picture\'s own shape', () => {
    const b = BACKGROUNDS[0];
    const f = frameOf({ ...DEFAULT_DESIGN, mode: 'invite', fill: { kind: 'picture', id: b.id } });
    expect([f.w, f.h]).toEqual([b.w, b.h]);
    expect(frameOf({ ...DEFAULT_DESIGN, mode: 'invite' }).label).toBe('Invitation');
    expect(frameOf({ ...DEFAULT_DESIGN, frame: 'picture', fill: { kind: 'picture', id: b.id } }).h).toBe(b.h);
  });
});
