import { describe, expect, it } from 'vitest';
import { alphabetChars, skeletonFor, verticalRange } from '../src/core/alphabet/skeletons';
import { DEFAULT_GEOMETRY } from '../src/core/alphabet/types';

const ALL = alphabetChars({ upper: true, lower: true });

describe('letter skeletons', () => {
  it('draws every character with finite points, roles and sensible extents', () => {
    for (const ch of ALL) {
      const sk = skeletonFor(ch, DEFAULT_GEOMETRY);
      expect(sk, ch).not.toBeNull();
      expect(sk!.strokes.length, ch).toBeGreaterThan(0);
      for (const s of sk!.strokes) {
        expect(s.role, ch).toBeDefined();
        if (s.role === 'bowl' || s.role === 'loop') expect(s.circle, ch).toBeDefined();
        for (const [x, y] of s.points) {
          expect(Number.isFinite(x) && Number.isFinite(y), ch).toBe(true);
          expect(y, ch).toBeGreaterThan(-0.4);
          expect(y, ch).toBeLessThan(1.15);
        }
      }
    }
  });

  it('moves bars, bowls and forks and squares corners with the geometry', () => {
    const pts = (ch: string, g = DEFAULT_GEOMETRY) => JSON.stringify(skeletonFor(ch, g)!.strokes.map((s) => s.points));
    expect(pts('A', { ...DEFAULT_GEOMETRY, bar: 0.1 })).not.toBe(pts('A'));
    expect(pts('P', { ...DEFAULT_GEOMETRY, bowl: 0.1 })).not.toBe(pts('P'));
    expect(pts('Y', { ...DEFAULT_GEOMETRY, fork: 0.1 })).not.toBe(pts('Y'));
    expect(pts('O', { ...DEFAULT_GEOMETRY, round: 0 })).not.toBe(pts('O'));
    expect(pts('L', { ...DEFAULT_GEOMETRY, width: 1.3 })).not.toBe(pts('L'));
  });

  it('puts capitals on 0..700 and descenders below the baseline', () => {
    expect(verticalRange('P')).toEqual([0, 700]);
    expect(verticalRange('p')[0]).toBeLessThan(0);
    expect(verticalRange('a')[1]).toBeLessThan(700);
  });

  it('is fast enough for the geometry fitter', () => {
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) skeletonFor('B', { ...DEFAULT_GEOMETRY, bowl: (i % 10) / 100 });
    expect((performance.now() - t0) / 2000).toBeLessThan(0.2);
  });
});
