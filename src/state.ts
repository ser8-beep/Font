import type { RGBAImage } from './core/image';
import type { Analysis, LetterRegion } from './core/segment';

export interface Photo {
  id: string;
  /** Full-resolution pixels (long side capped, see loadPhoto). */
  image: RGBAImage;
  /** Object URL of a display-size JPEG. */
  url: string;
  analysis: Analysis;
  /** What the kid said this photo spells, e.g. "PLAY". */
  word: string;
}

export interface Letter {
  id: string;
  photoId: string;
  /** null = a blob nobody has named yet. */
  char: string | null;
  region: LetterRegion;
  /** Bumped whenever region changes, for caching. */
  rev: number;
  bolder: number;
  fillHoles: boolean;
}

export type Step = 'capture' | 'split' | 'clean' | 'type' | 'export';
export const STEPS: Step[] = ['capture', 'split', 'clean', 'type', 'export'];

export interface Snapshot {
  photos: Photo[];
  letters: Letter[];
  step: Step;
  currentPhotoId: string | null;
}

export interface AppState extends Snapshot {
  text: string;
  fontName: string;
  maker: string;
  material: boolean;
  celebrated: boolean;
  past: Snapshot[];
}

export type Action =
  | { type: 'go'; step: Step }
  | { type: 'addPhoto'; photo: Photo; letters: Letter[] }
  | { type: 'letters'; letters: Letter[]; record?: boolean }
  | { type: 'undo' }
  | { type: 'text'; text: string }
  | { type: 'fontName'; name: string }
  | { type: 'maker'; name: string }
  | { type: 'material'; on: boolean }
  | { type: 'celebrated' }
  | { type: 'reset' };

export const initialState: AppState = {
  photos: [],
  letters: [],
  step: 'capture',
  currentPhotoId: null,
  text: '',
  fontName: '',
  maker: '',
  material: false,
  celebrated: false,
  past: [],
};

const snap = (s: AppState): Snapshot => ({ photos: s.photos, letters: s.letters, step: s.step, currentPhotoId: s.currentPhotoId });

export function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'go':
      return { ...s, step: a.step };
    case 'addPhoto':
      return {
        ...s,
        past: [...s.past, snap(s)].slice(-60),
        photos: [...s.photos, a.photo],
        letters: [...s.letters, ...a.letters],
        currentPhotoId: a.photo.id,
        step: 'split',
      };
    case 'letters':
      return { ...s, past: a.record === false ? s.past : [...s.past, snap(s)].slice(-60), letters: a.letters };
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
    case 'material':
      return { ...s, material: a.on };
    case 'celebrated':
      return { ...s, celebrated: true };
    case 'reset':
      return initialState;
  }
}

let n = 0;
export const uid = () => `${Date.now().toString(36)}-${(n++).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Letters, digits only; what a kid can type in "What does it spell?". */
export function cleanWord(w: string): string {
  return w.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14);
}
