import type { RGBAImage } from './core/image';
import type { Analysis, LetterRegion } from './core/segment';

export interface Photo {
  id: string;
  /** Full-resolution pixels (long side capped, see loadPhoto). */
  image: RGBAImage;
  /** Object URL of a display-size JPEG. */
  url: string;
  analysis: Analysis;
  /** What the kid said this photo spells, in the case they typed it: "PLAY", "play" or "Play". */
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
  | { type: 'addPhoto'; photo: Photo; letters: Letter[] }
  | { type: 'letters'; letters: Letter[]; record?: boolean }
  | { type: 'reroll'; char: string }
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
  text: '',
  fontName: '',
  maker: '',
  celebrated: false,
  size: 'M',
  backdrop: 'white',
  past: [],
};

const snap = (s: AppState): Snapshot => ({ photos: s.photos, letters: s.letters, step: s.step, currentPhotoId: s.currentPhotoId, seeds: s.seeds });
const remember = (s: AppState) => [...s.past, snap(s)].slice(-60);

export function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'go':
      return { ...s, step: a.step };
    case 'addPhoto':
      return {
        ...s,
        past: remember(s),
        photos: [...s.photos, a.photo],
        letters: [...s.letters, ...a.letters],
        currentPhotoId: a.photo.id,
        step: 'split',
      };
    case 'letters':
      return { ...s, past: a.record === false ? s.past : remember(s), letters: a.letters };
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

/** Letters and digits only, in the case the kid typed: what a kid can type in "What does it spell?". */
export function cleanWord(w: string): string {
  return w.replace(/[^A-Za-z0-9]/g, '').slice(0, 14);
}
