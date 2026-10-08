import { useEffect, useMemo, useState } from 'react';
import { alphabetChars, type StyleSample } from './core/alphabet';
import { cropImage, type RGBAImage } from './core/image';
import { casesOf, type LetterGlyph } from './font';
import MatchWorker from './grow.worker?worker&inline';
import { libraryGlyph, loadAtlas, optionsFor, rankSets } from './library';
import type { LibrarySet } from './library-types';
import { looksOfArray, matchLetters } from './match';
import type { Letter, Photo } from './state';
import { assignThemes, normalise, type ThemeShare } from './themes';

export { normalise, type ThemeShare };

// Fills in every letter the kid didn't make from real object alphabets in the letter library.
// The letters can come from several themes (categories) at once: the kid's own theme tags, or the
// theme the photo looks like, or a mix the kid sets with sliders. The missing letters are shared
// out so each theme gets its share of the whole typeface, spread evenly through the alphabet, and
// each letter comes from its theme's best alphabet (or the next one that has it). "Try another"
// walks through that theme's other versions of a letter.

type Match = { sig: string; ranked: string[]; looks: number[] } | { sig: string; error: string };

let worker: Worker | null | undefined;
const waiting = new Map<string, (m: Match) => void>();

/** Look at the kid's letters in a worker, or right here when the page can't start one. */
function match(sig: string, samples: StyleSample[]): Promise<Match> {
  const here = (): Match => {
    try {
      return { sig, ranked: matchLetters(samples), looks: looksOfArray(samples) };
    } catch (e) {
      return { sig, error: String(e) };
    }
  };
  if (worker === undefined) {
    try {
      worker = new MatchWorker();
      worker.onmessage = (e) => {
        waiting.get(e.data.sig)?.(e.data);
        waiting.delete(e.data.sig);
      };
      worker.onerror = () => {
        worker?.terminate();
        worker = null;
        for (const [, done] of waiting) done({ sig: '', error: 'retry' });
      };
    } catch {
      worker = null;
    }
  }
  if (!worker) return new Promise((res) => setTimeout(() => res(here()), 0));
  const w = worker;
  return new Promise((res) => {
    let settled = false;
    const done = (m: Match) => {
      if (settled) return;
      settled = true;
      // A worker that died or never answered: do it here instead.
      res('error' in m && m.error === 'retry' ? here() : m);
    };
    waiting.set(sig, done);
    setTimeout(() => {
      if (!settled) {
        w.terminate();
        if (worker === w) worker = null;
        done({ sig, error: 'retry' });
      }
    }, 8000);
    w.postMessage({ sig, samples });
  });
}

/** Style samples from the letters the kid made (one per character, newest wins). */
export function styleSamples(captured: Map<string, LetterGlyph>, letters: Letter[], photos: Photo[]): StyleSample[] {
  const out: StyleSample[] = [];
  for (const [ch, g] of captured) {
    if (g.picture.kind !== 'photo') continue;
    const { clean, photo, letter } = g.picture;
    const p = photos.find((ph) => ph.id === photo.id) ?? photo;
    const l = letters.find((x) => x.id === letter.id) ?? letter;
    const k = p.image.width / p.analysis.work.width;
    out.push({
      char: ch,
      image: cropImage(p.image, clean.box),
      mask: clean.mask,
      raw: clean.raw,
      porous: l.fillHoles,
      fillRadius: l.fillHoles ? p.analysis.fillR * k : 0,
    });
  }
  return out;
}

export interface Alphabet {
  /** The main theme: the one with the biggest share ('' until the photo has been looked at). */
  category: string;
  /** Every theme in the typeface with its share (percent), biggest first; shares total 100. */
  themes: ThemeShare[];
  /** Where the themes came from: the kid's sliders, the kid's theme tags, or the app's guess. */
  themesFrom: 'mix' | 'tags' | 'guess';
  /** How many of the kid's own letters carry each theme tag. */
  tagged: Map<string, number>;
  /** The theme each filled-in letter comes from. */
  themeOf: Map<string, string>;
  /** Categories the photo looks like, best first (empty until known). */
  guess: string[];
  /** Alphabets to fill from, the one in use first. */
  sets: LibrarySet[];
  /** The alphabet "Try a different alphabet" moves on to (null when there is no other). */
  nextSet: string | null;
  /** Letters filled in so far. */
  grown: Map<string, LetterGlyph>;
  /** How many versions "Try another" can choose from, per character. */
  options: Map<string, number>;
  /** Every character the font will have, in display order (the kid's own included). */
  chars: string[];
  done: number;
  total: number;
  failed: boolean;
}

/**
 * The kid's whole alphabet while `enabled`: their own letters plus real object letters from the
 * library, in the themes of `mix` (theme → percent), or the kid's theme tags, or the theme the
 * photo looks like; the main theme's alphabet is `alphabet` (a set id) or its best one.
 */
export function useAlphabet(
  captured: Map<string, LetterGlyph>,
  letters: Letter[],
  photos: Photo[],
  seeds: Record<string, number>,
  enabled: boolean,
  mix: Record<string, number> | null,
  alphabet: string | null,
): Alphabet {
  const sig = useMemo(() => [...captured.values()].map((x) => x.id).join(';'), [captured]);
  const chars = useMemo(() => alphabetChars(casesOf(captured.keys())), [captured]);
  const todo = useMemo(() => chars.filter((c) => !captured.has(c)), [chars, captured]);
  const [matched, setMatched] = useState<Match | null>(null);
  const [atlases, setAtlases] = useState<Map<string, RGBAImage>>(new Map());

  useEffect(() => {
    if (!enabled || !captured.size || matched?.sig === sig) return;
    let live = true;
    match(sig, styleSamples(captured, letters, photos)).then((m) => live && setMatched(m));
    return () => {
      live = false;
    };
    // letters/photos only matter through `captured` (its ids make up sig).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sig]);

  const current = matched?.sig === sig ? matched : null;
  const guess = current && 'ranked' in current ? current.ranked : [];

  // The kid's own letters by theme tag (the tag of the photo each came from).
  const tagged = useMemo(() => {
    const t = new Map<string, number>();
    for (const g of captured.values()) {
      if (g.picture.kind !== 'photo') continue;
      const id = g.picture.photo.id;
      const theme = photos.find((p) => p.id === id)?.theme;
      if (theme) t.set(theme, (t.get(theme) ?? 0) + 1);
    }
    return t;
  }, [captured, photos]);

  const { themes, themesFrom } = useMemo((): { themes: ThemeShare[]; themesFrom: Alphabet['themesFrom'] } => {
    const set = mix && normalise(mix);
    if (set && set.length) return { themes: set, themesFrom: 'mix' };
    if (tagged.size) return { themes: normalise(Object.fromEntries(tagged)), themesFrom: 'tags' };
    return { themes: guess[0] ? [{ id: guess[0], share: 100 }] : [], themesFrom: 'guess' };
  }, [mix, tagged, guess]);
  const category = themes[0]?.id ?? '';

  // Each theme's alphabets, best first; the main theme's starts with the one the kid picked.
  const looks = current && 'looks' in current ? current.looks : null;
  const { setsOf, sets, nextSet } = useMemo(() => {
    const setsOf = new Map<string, LibrarySet[]>();
    let nextSet: string | null = null;
    for (const { id } of themes) {
      let ranked = rankSets(id, todo, looks);
      if (id === category) {
        const at = Math.max(0, ranked.findIndex((s) => s.id === alphabet));
        const pick = ranked[at];
        if (pick) ranked = [pick, ...ranked.filter((s) => s !== pick)];
        nextSet = ranked.length > 1 ? rankSets(id, todo, looks)[(at + 1) % ranked.length].id : null;
      }
      setsOf.set(id, ranked);
    }
    return { setsOf, sets: setsOf.get(category) ?? [], nextSet };
  }, [themes, category, todo, looks, alphabet]);

  const themeOf = useMemo(
    () => assignThemes(todo, chars.length, themes, tagged, (theme, ch) => (setsOf.get(theme) ?? []).some((s) => s.category === theme && s.letters.some((l) => l.char === ch))),
    [todo, chars, themes, tagged, setsOf],
  );

  const picks = useMemo(() => {
    const out = new Map<string, { choice: ReturnType<typeof optionsFor>[number]; count: number }>();
    for (const ch of todo) {
      const opts = optionsFor(ch, setsOf.get(themeOf.get(ch) ?? category) ?? []);
      if (opts.length) out.set(ch, { choice: opts[(seeds[ch] ?? 0) % opts.length], count: opts.length });
    }
    return out;
  }, [todo, setsOf, themeOf, category, seeds]);

  // Load the alphabets the picks come from.
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const need = new Set([...picks.values()].map((p) => p.choice.set).filter((s) => !atlases.has(s.atlas)));
    for (const set of need) {
      loadAtlas(set)
        .then((img) => live && setAtlases((m) => new Map(m).set(set.atlas, img)))
        .catch((e) => console.warn(e));
    }
    return () => {
      live = false;
    };
  }, [enabled, picks, atlases]);

  const { grown, options } = useMemo(() => {
    const grown = new Map<string, LetterGlyph>();
    const options = new Map<string, number>();
    for (const [ch, { choice, count }] of picks) {
      options.set(ch, count);
      const atlas = atlases.get(choice.set.atlas);
      if (atlas) grown.set(ch, libraryGlyph(choice, atlas, ch));
    }
    return { grown, options };
  }, [picks, atlases]);
  const failed = !!current && 'error' in current;
  // Until the photo has been looked at, every missing letter is still to come.
  const total = category ? picks.size : todo.length;
  return { category, themes, themesFrom, tagged, themeOf, guess, sets, nextSet, grown, options, chars, done: failed ? total : grown.size, total, failed };
}
