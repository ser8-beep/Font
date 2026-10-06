import { analyseStyle, looksOf, matchCategory, type StyleSample } from './core/alphabet';

/** Repository categories the kid's letters look like, best first. */
export function matchLetters(samples: StyleSample[]): string[] {
  return matchCategory(samples, analyseStyle(samples)).ranked.map((r) => r.id);
}

/** The letters' colour make-up as [metal, dark, green, brown, bright, hues/6], like LibrarySet.looks. */
export function looksOfArray(samples: StyleSample[]): number[] {
  const L = looksOf(samples);
  return [L.metal, L.dark, L.green, L.brown, L.bright, Math.min(1, L.hues / 6)];
}
