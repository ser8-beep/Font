import { describe, expect, it } from 'vitest';
import { assignThemes, normalise } from '../src/themes';

const AZ = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

describe('theme mix', () => {
  it('turns weights into whole percents that total 100, biggest first', () => {
    const s = normalise({ plants: 1, food: 1, tools: 1 });
    expect(s.reduce((t, x) => t + x.share, 0)).toBe(100);
    expect(s.map((x) => x.share)).toEqual([34, 33, 33]);
    expect(normalise({ plants: 70, food: 0 })).toEqual([{ id: 'plants', share: 100 }]);
  });

  it('shares the missing letters out by percent, across the whole typeface', () => {
    const todo = AZ.filter((c) => !'PLAY'.includes(c));
    const themes = normalise({ plants: 50, food: 50 });
    // The kid's P, L, A, Y are all tagged plants, so food gets more of the missing letters.
    const got = assignThemes(todo, 26, themes, new Map([['plants', 4]]), () => true);
    const n = (id: string) => [...got.values()].filter((t) => t === id).length;
    expect(n('plants') + n('food')).toBe(22);
    expect(n('food')).toBe(13);
    expect(n('plants')).toBe(9);
  });

  it('spreads each theme through the alphabet instead of bunching it', () => {
    const got = assignThemes(AZ, 26, normalise({ plants: 50, food: 50 }), new Map(), () => true);
    const firstHalf = AZ.slice(0, 13).filter((c) => got.get(c) === 'food').length;
    expect(firstHalf).toBeGreaterThanOrEqual(5);
    expect(firstHalf).toBeLessThanOrEqual(8);
  });

  it('passes a letter to a theme that has it', () => {
    const got = assignThemes(AZ, 26, normalise({ plants: 50, food: 50 }), new Map(), (t, ch) => !(t === 'food' && ch === 'Q'));
    expect(got.get('Q')).toBe('plants');
  });
});
