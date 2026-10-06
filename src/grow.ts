import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { alphabetChars, analyseStyle, materialFor, renderLetter, verticalRange, type StyleProfile, type StyleSample } from './core/alphabet';
import { hashString } from './core/alphabet/rng';
import { cropImage } from './core/image';
import { casesOf, type LetterGlyph } from './font';
import GrowWorker from './grow.worker?worker&inline';
import { grownGlyph, type GrownData } from './grown';
import type { Letter, Photo } from './state';

// Grows the letters the kid didn't photograph, in a worker, and hands them to React as they
// arrive. Results are kept per (letters the kid made, character, "try another" roll).

type Msg = { type: 'glyph'; sig: string; ch: string; seed: number; glyph: GrownData | null } | { type: 'error'; sig: string; message: string };

interface Port {
  post(msg: unknown): void;
}

class Grower {
  private port: Port;
  private sig = '';
  private results = new Map<string, LetterGlyph | null>();
  private pending = new Set<string>();
  private listeners = new Set<() => void>();
  version = 0;
  failed = false;

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
    this.port.post({ type: 'style', sig, samples });
  }

  request(chars: { ch: string; seed: number }[]) {
    const jobs = chars.filter(({ ch, seed }) => {
      const k = key(this.sig, ch, seed);
      if (this.results.has(k) || this.pending.has(k)) return false;
      this.pending.add(k);
      return true;
    });
    if (jobs.length) this.port.post({ type: 'grow', sig: this.sig, jobs });
  }

  get(ch: string, seed: number): LetterGlyph | null | undefined {
    return this.results.get(key(this.sig, ch, seed));
  }

  private receive(m: Msg) {
    if (m.sig !== this.sig) return;
    if (m.type === 'error') {
      this.failed = true;
    } else {
      const k = key(m.sig, m.ch, m.seed);
      this.pending.delete(k);
      this.results.set(
        k,
        m.glyph ? { id: `grown|${hashString(m.sig)}|${m.ch}|${m.seed}`, char: m.ch, outline: m.glyph.outline, svg: m.glyph.svg, generated: true, picture: { kind: 'art', image: m.glyph.image } } : null,
      );
    }
    this.version++;
    this.listeners.forEach((fn) => fn());
  }
}

const key = (sig: string, ch: string, seed: number) => `${sig}|${ch}|${seed}`;

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
  let queue: { sig: string; ch: string; seed: number }[] = [];
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
        glyph = grownGlyph(job.ch, style.profile, job.seed, renderLetter, materialFor, verticalRange);
      } catch {
        /* skip this one */
      }
      receive({ type: 'glyph', sig: job.sig, ch: job.ch, seed: job.seed, glyph });
    }
    setTimeout(pump, 16);
  };
  return {
    post: (msg) => {
      const m = msg as { type: string; sig: string; samples?: StyleSample[]; jobs?: { ch: string; seed: number }[] };
      if (m.type === 'style') {
        try {
          style = { sig: m.sig, profile: analyseStyle(m.samples!) };
        } catch (e) {
          style = null;
          receive({ type: 'error', sig: m.sig, message: String(e) });
        }
        queue = queue.filter((j) => j.sig === m.sig);
      } else if (m.type === 'grow') {
        for (const j of m.jobs!) queue.push({ sig: m.sig, ...j });
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
  /** Grown letters ready so far. */
  grown: Map<string, LetterGlyph>;
  /** Every character the font will have, in display order (captured ones included). */
  chars: string[];
  done: number;
  total: number;
  failed: boolean;
}

/** Grow (and keep growing) the rest of the alphabet while `enabled`. */
export function useAlphabet(captured: Map<string, LetterGlyph>, letters: Letter[], photos: Photo[], seeds: Record<string, number>, enabled: boolean): Alphabet {
  const g = getGrower();
  useSyncExternalStore(g.subscribe, g.getVersion);
  const sig = useMemo(() => [...captured.values()].map((x) => x.id).join(';'), [captured]);
  const chars = useMemo(() => alphabetChars(casesOf(captured.keys())), [captured]);
  const todo = useMemo(() => chars.filter((c) => !captured.has(c)), [chars, captured]);

  useEffect(() => {
    if (!enabled || !captured.size) return;
    g.setStyle(sig, styleSamples(captured, letters, photos));
    g.request(todo.map((ch) => ({ ch, seed: seeds[ch] ?? 0 })));
    // letters/photos only matter through `captured` (its ids make up sig).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sig, todo, seeds]);
  const grown = new Map<string, LetterGlyph>();
  let done = 0;
  for (const ch of todo) {
    const r = g.get(ch, seeds[ch] ?? 0);
    if (r !== undefined) done++;
    if (r) grown.set(ch, r);
  }
  return { grown, chars, done, total: todo.length, failed: g.failed };
}
