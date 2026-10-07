import type { RGBAImage } from './core/image';
import type { Analysis, LetterRegion } from './core/segment';

export interface Photo {
  id: string;
  /** Full-resolution pixels (long side capped, see loadPhoto). */
  image: RGBAImage;
  /** Object URL of a display-size JPEG. */
  url: string;
  analysis: Analysis;
  /** The letters in this photo: the whole word (WORD), or one letter when kids photograph them one at a time. */
  word: string;
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
export type Backdrop = 'white' | 'table' | 'yellow' | 'pink' | 'blue' | 'green';

export interface Snapshot {
  photos: Photo[];
  letters: Letter[];
  step: Step;
  currentPhotoId: string | null;
  /** "Try another" rolls per grown character (0 when never rolled). */
  seeds: Record<string, number>;
  /** Object-type category the kid picked for building new letters (null = the app's guess). */
  category: string | null;
  /** Letter-library alphabet the kid picked (null = the best one for the category). */
  alphabet: string | null;
}

export interface AppState extends Snapshot {
  text: string;
  fontName: string;
  maker: string;
  celebrated: boolean;
  size: Size;
  backdrop: Backdrop;
  past: Snapshot[];
}

export type Action =
  | { type: 'go'; step: Step }
  /** replaces: earlier photos of the same letters, dropped with their letters. stay: keep the step (more letter photos to come). */
  | { type: 'addPhoto'; photo: Photo; letters: Letter[]; replaces?: string[]; stay?: boolean }
  | { type: 'showPhoto'; photoId: string }
  | { type: 'letters'; letters: Letter[]; record?: boolean }
  | { type: 'reroll'; char: string }
  | { type: 'category'; category: string | null }
  | { type: 'alphabet'; alphabet: string | null }
  | { type: 'undo' }
  | { type: 'text'; text: string }
  | { type: 'fontName'; name: string }
  | { type: 'maker'; name: string }
  | { type: 'size'; size: Size }
  | { type: 'backdrop'; backdrop: Backdrop }
  | { type: 'celebrated' }
  | { type: 'reset' };

export const initialState: AppState = {
  photos: [],
  letters: [],
  step: 'capture',
  currentPhotoId: null,
  seeds: {},
  category: null,
  alphabet: null,
  text: '',
  fontName: '',
  maker: '',
  celebrated: false,
  size: 'M',
  backdrop: 'white',
  past: [],
};

const snap = (s: AppState): Snapshot => ({ photos: s.photos, letters: s.letters, step: s.step, currentPhotoId: s.currentPhotoId, seeds: s.seeds, category: s.category, alphabet: s.alphabet });
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
        step: a.stay ? s.step : 'split',
      };
    }
    case 'showPhoto':
      return { ...s, currentPhotoId: a.photoId };
    case 'letters':
      return { ...s, past: a.record === false ? s.past : remember(s), letters: a.letters };
    case 'category':
      // A new category starts from its best alphabet and first-choice letters.
      return { ...s, past: remember(s), category: a.category, alphabet: null, seeds: {} };
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
    case 'backdrop':
      return { ...s, backdrop: a.backdrop };
    case 'celebrated':
      return { ...s, celebrated: true };
    case 'reset':
      return initialState;
  }
}

let n = 0;
const boot = Date.now().toString(36);
export const uid = () => `${boot}-${(n++).toString(36)}`;
