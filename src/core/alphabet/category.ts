import { isBendy, partStats } from './materials/strokes';
import { GROUPS } from './groups';
import { REPOSITORY } from './repository-data';
import type { MaterialProfile, StyleProfile, StyleSample } from './types';

// The object-type repository (data/object-type-repository.json) records how real object alphabets
// were built, letter by letter. Pooled into the five kid-facing categories (groups.ts), it is used
// two ways:
//   1. matchCategory: guess which category the kid's photo belongs to, so the app can fill in
//      the other letters from that category's alphabets (see src/library.ts).
//   2. ideasFor: the objects makers used, as ideas for kids who want to build more letters.

/** How a letter is built, using the repository's words. */
export type Build = 'single' | 'composite' | 'repeated' | 'formed';
export const BUILDS: Build[] = ['single', 'composite', 'repeated', 'formed'];

export const CATEGORY_IDS = Object.keys(REPOSITORY);

/** Kid-friendly names, in the order the picker shows them. */
export const CATEGORY_LABELS: Record<string, { label: string; emoji: string; description: string }> = Object.fromEntries(
  Object.entries(GROUPS).map(([id, g]) => [id, { label: g.label, emoji: g.emoji, description: g.description }]),
);

/** How one captured letter is built, read from its material. */
export function buildOf(mp: MaterialProfile): Build {
  const m = mp.material;
  if (m.kind === 'grid' || m.kind === 'pieces') return 'repeated';
  if (m.kind === 'flat') return 'single';
  if (isBendy(m)) return 'formed';
  const parts = partStats(m);
  if (parts.length + m.rounds.length <= 1) return 'single';
  // Several sticks of about the same length and thickness (pencils, books, chalk) are copies of
  // one kind of object, whatever their colours.
  if (parts.length >= 3 && !m.rounds.length) {
    const spread = (v: number[]) => Math.max(...v) / Math.max(0.01, Math.min(...v));
    if (spread(parts.map((p) => p.lengthRel)) < 2.2 && spread(parts.map((p) => p.widthPx)) < 1.8) return 'repeated';
  }
  return 'composite';
}

/** Colour make-up of the letters themselves (shares of ink pixels), the main clue to what they are. */
export interface Looks {
  /** Grey, silver, chrome: low saturation, not dark. */
  metal: number;
  dark: number;
  green: number;
  /** Biscuit, bread, wood, cardboard, coffee. */
  brown: number;
  /** Strong, bright colours (plastic toys, markers, sweets). */
  bright: number;
  /** How many different strong hues appear (1 = one colour, 4+ = rainbow). */
  hues: number;
}

export function looksOf(samples: StyleSample[]): Looks {
  let n = 0, metal = 0, dark = 0, green = 0, brown = 0, bright = 0;
  const hueBins = new Float64Array(12);
  let sat = 0;
  for (const s of samples) {
    // Separate pieces: only the pieces themselves, not the table showing between them.
    const mask = s.porous ? s.raw : s.mask;
    const { image } = s;
    const step = Math.max(1, Math.round(Math.sqrt((mask.width * mask.height) / 20000)));
    for (let y = 0; y < mask.height; y += step) {
      for (let x = 0; x < mask.width; x += step) {
        if (!mask.data[y * mask.width + x]) continue;
        const i = (y * image.width + x) * 4;
        const [h, sv, v] = hsv(image.data[i], image.data[i + 1], image.data[i + 2]);
        n++;
        if (h >= 10 && h <= 50 && sv >= 0.22 && sv <= 0.85 && v >= 0.15 && v <= 0.85) brown++;
        else if (v < 0.22) dark++;
        else if (sv < 0.18) metal++;
        else {
          if (h >= 70 && h <= 170 && sv > 0.25) green++;
          if (sv > 0.5 && v > 0.45) {
            bright++;
            hueBins[Math.floor(h / 30) % 12]++;
            sat++;
          }
        }
      }
    }
  }
  const k = 1 / Math.max(1, n);
  const hues = sat ? [...hueBins].filter((c) => c / sat > 0.08).length : 0;
  return { metal: metal * k, dark: dark * k, green: green * k, brown: brown * k, bright: bright * k, hues };
}

function colourSpread(cs: [number, number, number][]): number {
  let d = 0;
  for (const a of cs) for (const b of cs) d = Math.max(d, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  return d;
}

function hsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max / 255];
}

/** How often category c builds letters the b way, smoothed so no build is impossible. */
function buildShare(c: string, b: Build, letter?: string): number {
  const cat = REPOSITORY[c];
  const i = BUILDS.indexOf(b);
  const all = cat.build.reduce((s, v) => s + v, 0);
  const prior = (cat.build[i] + 1) / (all + 4);
  const l = letter ? cat.letters[letter.toUpperCase()] : undefined;
  if (!l) return prior;
  const n = l.build.reduce((s, v) => s + v, 0);
  // A letter's own records count fully; the category's habits fill in for the letters it lacks.
  return (l.build[i] + 3 * prior) / (n + 3);
}

/**
 * What each category usually looks like, as shares of ink pixels (see Looks; hues is divided by 6).
 * Rough guesses from the reference alphabets; they only need to rank categories sensibly.
 */
const TYPICAL: Record<string, [metal: number, dark: number, green: number, brown: number, bright: number, hues: number][]> = {
  // Bright school things, desk things (clips, tape, scissors) and art supplies (paint, brushes, clay).
  stationery: [[0.2, 0.05, 0.08, 0.12, 0.55, 0.6], [0.4, 0.03, 0.06, 0.12, 0.15, 0.6], [0.1, 0.05, 0.08, 0.2, 0.75, 0.6]],
  // Hand tools, bare metal hardware, greasy bike parts.
  tools: [[0.55, 0.15, 0.03, 0.05, 0.25, 0.4], [0.8, 0.05, 0, 0.03, 0.05, 0.1], [0.55, 0.3, 0, 0.03, 0.08, 0.15]],
  produce: [[0.05, 0.02, 0.35, 0.15, 0.5, 0.45]],
  // Baked things (biscuits, bread, pasta, coffee) and sweets (gummies, candy).
  food: [[0.1, 0.05, 0.02, 0.45, 0.3, 0.25], [0.3, 0.02, 0.1, 0.05, 0.5, 0.5]],
  // Twigs, bark and dry leaves; fresh leaves and flowers.
  plants: [[0.1, 0.05, 0.3, 0.35, 0.2, 0.3], [0.05, 0.02, 0.35, 0.05, 0.6, 0.6]],
};
const LOOK_WEIGHTS = [3, 3, 4, 4, 3, 1.5];

/** What the letters are made of says a lot: Lego bricks are toys, clay is an art supply... */
interface Kinds {
  grid: number;
  pieces: number;
  formed: number;
  rigid: number;
  /** Share of stick parts that are long and thin (pencils, markers, screwdrivers, wire). */
  thin: number;
  /** Share of letters with a round object in them (biscuits, fruit, tape rolls, coins). */
  round: number;
}

function materialHints(c: string, k: Kinds): number {
  switch (c) {
    // Lego, clay and wool are craft supplies more than anything else on the list.
    case 'stationery': return 1.5 * k.grid + 0.3 * k.rigid + 0.9 * k.thin + 1.0 * k.formed;
    case 'tools': return 0.3 * k.rigid + 0.4 * k.thin;
    case 'produce': return 0.4 * k.pieces + 0.3 * k.formed + 0.6 * k.round;
    case 'food': return 0.9 * k.pieces + 0.6 * k.round;
    case 'plants': return 0.2 * k.formed;
    default: return 0;
  }
}

export interface CategoryGuess {
  /** Best match first. */
  ranked: { id: string; score: number }[];
}

/** Which repository category the kid's photographed letters most look like. */
export function matchCategory(samples: StyleSample[], style: StyleProfile): CategoryGuess {
  const looks = looksOf(samples);
  const f = [looks.metal, looks.dark, looks.green, looks.brown, looks.bright, Math.min(1, looks.hues / 6)];
  // When one letter shows the stuff bends (a wool or clay bowl), other letters made of one stuff
  // (all their parts the same colour: straight bits of the same wool) are that bendy stuff too.
  // Letters mixing different objects stay mixed.
  let builds = style.materials.map(buildOf);
  if (builds.includes('formed')) {
    builds = builds.map((b, i) => {
      const m = style.materials[i].material;
      return m.kind === 'strokes' && b !== 'single' && !m.rounds.length && colourSpread(partStats(m).map((p) => p.colour)) < 50 ? 'formed' : b;
    });
  }
  const n = Math.max(1, style.materials.length);
  const strokes = style.materials.flatMap((m) => (m.material.kind === 'strokes' ? [m.material] : []));
  // Long thin rigid things: pencils, markers, screwdrivers. (Wool and clay don't count.)
  const parts = strokes.filter((m) => !isBendy(m)).flatMap(partStats);
  const kinds: Kinds = {
    grid: style.materials.filter((m) => m.material.kind === 'grid').length / n,
    pieces: style.materials.filter((m) => m.material.kind === 'pieces').length / n,
    formed: builds.filter((b) => b === 'formed').length / n,
    rigid: style.materials.filter((m, i) => m.material.kind === 'strokes' && builds[i] !== 'formed').length / n,
    thin: parts.length ? parts.filter((p) => p.aspect > 5).length / parts.length : 0,
    round: strokes.filter((m) => m.rounds.length).length / n,
  };
  const ranked = CATEGORY_IDS.map((id) => {
    const looksLike = (t: number[]) => -f.reduce((s, v, i) => s + LOOK_WEIGHTS[i] * (v - t[i]) ** 2, 0) * 4;
    let score = Math.max(...(TYPICAL[id] ?? [[0.3, 0.1, 0.1, 0.1, 0.3, 0.4]]).map(looksLike));
    // How makers in this category built these very letters, from the repository.
    score += (0.8 / n) * style.materials.reduce((s, m, i) => s + Math.log(buildShare(id, builds[i], m.source)), 0);
    score += materialHints(id, kinds);
    // Bigger categories are a little more likely.
    score += 0.1 * Math.log(REPOSITORY[id].count);
    return { id, score };
  }).sort((a, b) => b.score - a.score);
  return { ranked };
}

/** Objects makers in this category used for this letter (empty when the repository has none). */
export function ideasFor(ch: string, category: string): string[] {
  return REPOSITORY[category]?.letters[ch.toUpperCase()]?.ideas ?? [];
}
