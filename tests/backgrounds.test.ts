import { describe, expect, it } from 'vitest';
import { BACKGROUNDS, backgroundGroups, thumbUrl } from '../src/backgrounds';
import { DEFAULT_DESIGN, frameOf } from '../src/design';

describe('picture backgrounds', () => {
  it('have a preview, a size and a calm area inside the picture', () => {
    expect(BACKGROUNDS.length).toBe(40);
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

  it('offer party cards first for invitations, and the theme\'s own pictures first for posters', () => {
    const invite = backgroundGroups(['plants'], true);
    expect(invite[0].key).toBe('party');
    expect(invite[0].items).toHaveLength(9);
    const poster = backgroundGroups(['food', 'produce'], false);
    expect(poster[0].key).toBe('food');
    // Then the party cards and the other themes; the kitchen pictures are shown once, not again for produce.
    expect(poster.map((g) => g.key)).toEqual(['food', 'party', 'plants', 'stationery']);
    // Every picture is offered exactly once.
    const all = poster.flatMap((g) => g.items.map((b) => b.id));
    expect(new Set(all).size).toBe(BACKGROUNDS.length);
    expect(all).toHaveLength(BACKGROUNDS.length);
  });

  it('give an invitation the picture\'s own shape', () => {
    const b = BACKGROUNDS[0];
    const f = frameOf({ ...DEFAULT_DESIGN, mode: 'invite', fill: { kind: 'picture', id: b.id } });
    expect([f.w, f.h]).toEqual([b.w, b.h]);
    expect(frameOf({ ...DEFAULT_DESIGN, mode: 'invite' }).label).toBe('Invitation');
    expect(frameOf({ ...DEFAULT_DESIGN, frame: 'picture', fill: { kind: 'picture', id: b.id } }).h).toBe(b.h);
  });
});
