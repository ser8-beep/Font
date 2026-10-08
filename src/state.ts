import type { RGBAImage } from './core/image';
import type { Analysis, LetterRegion } from './core/segment';
import { DEFAULT_DESIGN, type Design } from './design';

export interface Photo {
  id: string;
  /** Full-resolution pixels (long side capped, see loadPhoto). */
  image: RGBAImage;
  /** Object URL of a display-size JPEG. */
  url: string;
  analysis: Analysis;
  /** The letters in this photo: the whole word (WORD), or one letter when kids photograph them one at a time. */
  word: string;
  /** The theme the kid tagged this photo with (a category id), when they picked one. */
  theme?: string;
}

export interface Letter {
  id: string;
  photoId: string;
  /** null = a blob nobody has named yet. Case matters: 'p' is a small letter with a tail. */
  char: string | null;
  region: LetterRegion;
  /** Bumped whenever region changes, for caching. */
  rev: number;
  bolder: number;
  fillHoles: boolean;
}

/** What kids build out of objects. Always this word, so nobody has to type it. */
export const WORD = 'PLAY';

/** Photos in word order: the whole word first, then its letters P, L, A, Y, then any others. */
export function inWordOrder(photos: Photo[]): Photo[] {
  const rank = (p: Photo) => (p.word === WORD ? -1 : WORD.indexOf(p.word.toUpperCase()) >= 0 && [...p.word].length === 1 ? WORD.indexOf(p.word.toUpperCase()) : WORD.length);
  return [...photos].sort((a, b) => rank(a) - rank(b));
}

export type Step = 'capture' | 'split' | 'clean' | 'grow' | 'type' | 'export';
export const STEPS: Step[] = ['capture', 'split', 'clean', 'grow', 'type', 'export'];

/** Steps where the rest of the alphabet is grown (and kept growing in the background). */
export const GROW_STEPS: Step[] = ['grow', 'type', 'export'];

export type Size = 'S' | 'M' | 'L';

export interface Snapshot {
  photos: Photo[];
  letters: Letter[];
  step: Step;
  currentPhotoId: string | null;
  /** "Try another" rolls per grown character (0 when never rolled). */
  seeds: Record<string, number>;
  /**
   * The themes (category ids) the rest of the alphabet comes from and each one's share of the whole
   * typeface, in percent (null = from the kid's theme tags, else the app's guess).
   */
  mix: Record<string, number> | null;
  /** Letter-library alphabet the kid picked (null = the best one for the category). */
  alphabet: string | null;
}

export interface AppState extends Snapshot {
  text: string;
  fontName: string;
  maker: string;
  celebrated: boolean;
  size: Size;
  /** The poster designed in the playground and saved in Save. */
  design: Design;
  past: Snapshot[];
}

export type Action =
  | { type: 'go'; step: Step }
  /** replaces: earlier photos of the same letters, dropped with their letters. stay: keep the step (more letter photos to come). */
  | { type: 'addPhoto'; photo: Photo; letters: Letter[]; replaces?: string[]; stay?: boolean }
  | { type: 'showPhoto'; photoId: string }
  | { type: 'letters'; letters: Letter[]; record?: boolean }
  | { type: 'reroll'; char: string }
  | { type: 'mix'; mix: Record<string, number> | null }
  | { type: 'tagPhoto'; photoId: string; theme: string | null }
  | { type: 'alphabet'; alphabet: string | null }
  | { type: 'undo' }
  | { type: 'text'; text: string }
  | { type: 'fontName'; name: string }
  | { type: 'maker'; name: string }
  | { type: 'size'; size: Size }
  | { type: 'design'; patch: Partial<Design> }
  | { type: 'celebrated' }
  | { type: 'reset' };

export const initialState: AppState = {
  photos: [],
  letters: [],
  step: 'capture',
  currentPhotoId: null,
  seeds: {},
  mix: null,
  alphabet: null,
  text: '',
  fontName: '',
  maker: '',
  celebrated: false,
  size: 'M',
  design: DEFAULT_DESIGN,
  past: [],
};

const snap = (s: AppState): Snapshot => ({ photos: s.photos, letters: s.letters, step: s.step, currentPhotoId: s.currentPhotoId, seeds: s.seeds, mix: s.mix, alphabet: s.alphabet });
const remember = (s: AppState) => [...s.past, snap(s)].slice(-60);

export function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'go':
      return { ...s, step: a.step };
    case 'addPhoto': {
      const gone = new Set(a.replaces ?? []);
      return {
        ...s,
        past: remember(s),
        photos: [...s.photos.filter((p) => !gone.has(p.id)), a.photo],
        letters: [...s.letters.filter((l) => !gone.has(l.photoId)), ...a.letters],
        currentPhotoId: a.photo.id,
        // A photo of one letter is already matched: straight on to Neaten.
        step: a.stay ? s.step : [...a.photo.word].length === 1 ? 'clean' : 'split',
      };
    }
    case 'showPhoto':
      return { ...s, currentPhotoId: a.photoId };
    case 'letters':
      return { ...s, past: a.record === false ? s.past : remember(s), letters: a.letters };
    case 'mix': {
      // A new main theme starts from its best alphabet; new shares keep the letters already rolled.
      const main = (m: Record<string, number> | null) => (m ? Object.entries(m).sort((x, y) => y[1] - x[1])[0]?.[0] : null);
      const same = main(a.mix) === main(s.mix);
      return { ...s, past: remember(s), mix: a.mix, alphabet: same ? s.alphabet : null, seeds: same ? s.seeds : {} };
    }
    case 'tagPhoto':
      return {
        ...s,
        past: remember(s),
        photos: s.photos.map((p) => (p.id === a.photoId ? { ...p, theme: a.theme ?? undefined } : p)),
        // Tags shape the mix only while the kid hasn't set one.
      };
    case 'alphabet':
      return { ...s, past: remember(s), alphabet: a.alphabet, seeds: {} };
    case 'reroll':
      return { ...s, past: remember(s), seeds: { ...s.seeds, [a.char]: (s.seeds[a.char] ?? 0) + 1 } };
    case 'undo': {
      const prev = s.past[s.past.length - 1];
      if (!prev) return s;
      return { ...s, ...prev, past: s.past.slice(0, -1) };
    }
    case 'text':
      return { ...s, text: a.text };
    case 'fontName':
      return { ...s, fontName: a.name };
    case 'maker':
      return { ...s, maker: a.name };
    case 'size':
      return { ...s, size: a.size };
    case 'design':
      return { ...s, design: { ...s.design, ...a.patch } };
    case 'celebrated':
      return { ...s, celebrated: true };
    case 'reset':
      return initialState;
  }
}

let n = 0;
const boot = Date.now().toString(36);
export const uid = () => `${boot}-${(n++).toString(36)}`;
