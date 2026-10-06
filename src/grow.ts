import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { alphabetChars, analyseStyle, matchCategory, materialFor, renderLetter, verticalRange, type StyleProfile, type StyleSample } from './core/alphabet';
import { hashString } from './core/alphabet/rng';
import { cropImage } from './core/image';
import { casesOf, type LetterGlyph } from './font';
import GrowWorker from './grow.worker?worker&inline';
import { grownGlyph, type GrownData } from './grown';
import type { Letter, Photo } from './state';

// Grows the letters the kid didn't photograph, in a worker, and hands them to React as they
// arrive. Results are kept per (letters the kid made, category, character, "try another" roll).
// The worker also says which category of the object-type repository the letters look like.

type Msg =
  | { type: 'glyph'; sig: string; category: string; ch: string; seed: number; glyph: GrownData | null }
  | { type: 'guess'; sig: string; ranked: string[] }
  | { type: 'error'; sig: string; message: string };

interface Port {
  post(msg: unknown): void;
}

class Grower {
  private port: Port;
  private sig = '';
  private results = new Map<string, LetterGlyph | null>();
  private pending = new Set<string>();
  private listeners = new Set<() => void>();
  private category = '';
  version = 0;
  failed = false;
  /** Categories the letters look like, best first (null until the worker has looked). */
  guess: string[] | null = null;

  constructor() {
    this.port = makePort((m) => this.receive(m));
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = () => this.version;

  setStyle(sig: string, samples: StyleSample[]) {
    if (sig === this.sig) return;
    this.sig = sig;
    this.results.clear();
    this.pending.clear();
    this.failed = false;
    this.guess = null;
    this.port.post({ type: 'style', sig, samples });
  }

  request(chars: { ch: string; seed: number }[], category: string) {
    // Switching category: the worker drops the old category's queue, so forget it here too.
    if (category !== this.category) {
      const prefix = `${this.sig}|${category}|`;
      for (const k of this.pending) if (!k.startsWith(prefix)) this.pending.delete(k);
      this.category = category;
    }
    const jobs = chars.filter(({ ch, seed }) => {
      const k = key(this.sig, category, ch, seed);
      if (this.results.has(k) || this.pending.has(k)) return false;
      this.pending.add(k);
      return true;
    });
    if (jobs.length) this.port.post({ type: 'grow', sig: this.sig, category, jobs });
  }

  get(ch: string, seed: number, category: string): LetterGlyph | null | undefined {
    return this.results.get(key(this.sig, category, ch, seed));
  }

  private receive(m: Msg) {
    if (m.sig !== this.sig) return;
    if (m.type === 'error') {
      this.failed = true;
    } else if (m.type === 'guess') {
      this.guess = m.ranked;
    } else {
      const k = key(m.sig, m.category, m.ch, m.seed);
      this.pending.delete(k);
      this.results.set(
        k,
        m.glyph
          ? { id: `grown|${hashString(m.sig)}|${m.category}|${m.ch}|${m.seed}`, char: m.ch, outline: m.glyph.outline, svg: m.glyph.svg, generated: true, picture: { kind: 'art', image: m.glyph.image } }
          : null,
      );
    }
    this.version++;
    this.listeners.forEach((fn) => fn());
  }
}

const key = (sig: string, category: string, ch: string, seed: number) => `${sig}|${category}|${ch}|${seed}`;

/** A real worker when the page may start one, otherwise the same work in small main-thread slices. */
function makePort(receive: (m: Msg) => void): Port {
  // Some hosts (the claude.ai viewer, strict school proxies) refuse workers made from inline
  // code, sometimes only after the fact. Until the worker answers, keep what was sent so it can
  // be replayed on the main thread.
  let fallback: Port | null = null;
  let heard = false;
  let style: unknown = null;
  const sent: unknown[] = [];
  const toMain = (w?: Worker) => {
    if (fallback) return;
    w?.terminate();
    fallback = mainThreadPort(receive);
    if (style) fallback.post(style);
    for (const m of sent) fallback.post(m);
  };
  let w: Worker;
  try {
    w = new GrowWorker();
  } catch {
    return mainThreadPort(receive);
  }
  w.onmessage = (e) => {
    heard = true;
    sent.length = 0;
    receive(e.data);
  };
  w.onerror = () => toMain(w);
  return {
    post: (msg) => {
      if (fallback) return fallback.post(msg);
      if (!heard) {
        if ((msg as { type: string }).type === 'style') {
          style = msg;
          sent.length = 0;
        } else sent.push(msg);
        // The first letter takes well under a second; silence for 6 s means the worker is dead.
        setTimeout(() => !heard && toMain(w), 6000);
      }
      w.postMessage(msg);
    },
  };
}

/** Same messages as grow.worker.ts, run on the page itself one letter per tick. */
function mainThreadPort(receive: (m: Msg) => void): Port {
  let style: { sig: string; profile: StyleProfile } | null = null;
  let queue: { sig: string; category: string; ch: string; seed: number }[] = [];
  let running = false;
  const pump = () => {
    const job = queue.shift();
    if (!job) {
      running = false;
      return;
    }
    if (style && style.sig === job.sig) {
      let glyph: GrownData | null = null;
      try {
        glyph = grownGlyph(job.ch, style.profile, job.seed, job.category, renderLetter, materialFor, verticalRange);
      } catch {
        /* skip this one */
      }
      receive({ type: 'glyph', sig: job.sig, category: job.category, ch: job.ch, seed: job.seed, glyph });
    }
    setTimeout(pump, 16);
  };
  return {
    post: (msg) => {
      const m = msg as { type: string; sig: string; category?: string; samples?: StyleSample[]; jobs?: { ch: string; seed: number }[] };
      if (m.type === 'style') {
        try {
          style = { sig: m.sig, profile: analyseStyle(m.samples!) };
          receive({ type: 'guess', sig: m.sig, ranked: matchCategory(m.samples!, style.profile).ranked.map((r) => r.id) });
        } catch (e) {
          style = null;
          receive({ type: 'error', sig: m.sig, message: String(e) });
        }
        queue = queue.filter((j) => j.sig === m.sig);
      } else if (m.type === 'grow') {
        queue = queue.filter((j) => j.sig === m.sig && j.category === m.category);
        for (const j of m.jobs!) queue.push({ sig: m.sig, category: m.category!, ...j });
      }
      if (!running) {
        running = true;
        setTimeout(pump, 16);
      }
    },
  };
}

let grower: Grower | null = null;
const getGrower = () => (grower ??= new Grower());

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
  /** The object-type category the letters are built like ('' until it is known). */
  category: string;
  /** Categories the photo looks like, best first (empty until known). */
  guess: string[];
  /** Grown letters ready so far. */
  grown: Map<string, LetterGlyph>;
  /** Every character the font will have, in display order (captured ones included). */
  chars: string[];
  done: number;
  total: number;
  failed: boolean;
}

/**
 * Grow (and keep growing) the rest of the alphabet while `enabled`, built the way makers in
 * `chosen` (a repository category) build letters, or in the category the photo looks like.
 */
export function useAlphabet(captured: Map<string, LetterGlyph>, letters: Letter[], photos: Photo[], seeds: Record<string, number>, enabled: boolean, chosen: string | null): Alphabet {
  const g = getGrower();
  useSyncExternalStore(g.subscribe, g.getVersion);
  const guess = g.guess ?? [];
  const category = chosen ?? guess[0] ?? '';
  const sig = useMemo(() => [...captured.values()].map((x) => x.id).join(';'), [captured]);
  const chars = useMemo(() => alphabetChars(casesOf(captured.keys())), [captured]);
  const todo = useMemo(() => chars.filter((c) => !captured.has(c)), [chars, captured]);

  useEffect(() => {
    if (!enabled || !captured.size) return;
    g.setStyle(sig, styleSamples(captured, letters, photos));
    // The first time, the worker says which category the photo looks like before anything grows.
    if (category) g.request(todo.map((ch) => ({ ch, seed: seeds[ch] ?? 0 })), category);
    // letters/photos only matter through `captured` (its ids make up sig).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sig, todo, seeds, category]);
  const grown = new Map<string, LetterGlyph>();
  let done = 0;
  for (const ch of todo) {
    const r = category ? g.get(ch, seeds[ch] ?? 0, category) : undefined;
    if (r !== undefined) done++;
    if (r) grown.set(ch, r);
  }
  return { category, guess, grown, chars, done, total: todo.length, failed: g.failed };
}
