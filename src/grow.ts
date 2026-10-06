import { useEffect, useMemo, useState } from 'react';
import { alphabetChars, type StyleSample } from './core/alphabet';
import { cropImage, type RGBAImage } from './core/image';
import { casesOf, type LetterGlyph } from './font';
import MatchWorker from './grow.worker?worker&inline';
import { libraryGlyph, loadAtlas, optionsFor, rankSets } from './library';
import type { LibrarySet } from './library-types';
import { looksOfArray, matchLetters } from './match';
import type { Letter, Photo } from './state';

// Fills in every letter the kid didn't make from a real object alphabet in the letter library:
// the photo is matched to a category of the object-type repository, the best alphabet in that
// category is picked, and each missing letter comes from it (or, if it lacks one, from the next
// alphabet that has it). "Try another" walks through the other alphabets' versions of a letter.

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
  /** The object-type category the letters come from ('' until the photo has been looked at). */
  category: string;
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
 * library, from `chosen` (a repository category) or the category the photo looks like, and from
 * `alphabet` (a set id) or the best set in it.
 */
export function useAlphabet(
  captured: Map<string, LetterGlyph>,
  letters: Letter[],
  photos: Photo[],
  seeds: Record<string, number>,
  enabled: boolean,
  chosen: string | null,
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
  const category = chosen ?? guess[0] ?? '';
  const { sets, nextSet } = useMemo(() => {
    if (!category) return { sets: [], nextSet: null };
    const ranked = rankSets(category, todo, current && 'looks' in current ? current.looks : null);
    const at = Math.max(0, ranked.findIndex((s) => s.id === alphabet));
    const pick = ranked[at];
    return { sets: pick ? [pick, ...ranked.filter((s) => s !== pick)] : ranked, nextSet: ranked.length > 1 ? ranked[(at + 1) % ranked.length].id : null };
  }, [category, todo, current, alphabet]);

  const picks = useMemo(() => {
    const out = new Map<string, { choice: ReturnType<typeof optionsFor>[number]; count: number }>();
    for (const ch of todo) {
      const opts = optionsFor(ch, sets);
      if (opts.length) out.set(ch, { choice: opts[(seeds[ch] ?? 0) % opts.length], count: opts.length });
    }
    return out;
  }, [todo, sets, seeds]);

  // Load the alphabets the picks come from.
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const need = new Set([...picks.values()].map((p) => p.choice.set).filter((s) => !atlases.has(s.id)));
    for (const set of need) {
      loadAtlas(set)
        .then((img) => live && setAtlases((m) => new Map(m).set(set.id, img)))
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
      const atlas = atlases.get(choice.set.id);
      if (atlas) grown.set(ch, libraryGlyph(choice, atlas, ch));
    }
    return { grown, options };
  }, [picks, atlases]);
  const failed = !!current && 'error' in current;
  // Until the photo has been looked at, every missing letter is still to come.
  const total = category ? picks.size : todo.length;
  return { category, guess, sets, nextSet, grown, options, chars, done: failed ? total : grown.size, total, failed };
}
