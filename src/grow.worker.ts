// Grows the alphabet off the main thread, so the page keeps animating on slow laptops.
//
// main -> worker  { type: 'style', sig, samples }        learn the kid's style (once per set of letters)
//                 { type: 'grow', sig, category, jobs: [{ ch, seed }] }
//                                                         paint these, built like that category does;
//                                                         drops queued jobs of other categories
// worker -> main  { type: 'guess', sig, ranked }          repository categories the letters look like
//                 { type: 'glyph', sig, category, ch, seed, glyph }
//                                                         one finished character (glyph null if none)
import { analyseStyle, matchCategory, materialFor, renderLetter, verticalRange, type StyleProfile, type StyleSample } from './core/alphabet';
import { grownGlyph } from './grown';

let current: { sig: string; style: StyleProfile } | null = null;
let queue: { sig: string; category: string; ch: string; seed: number }[] = [];
let running = false;

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'style') {
    try {
      current = { sig: m.sig, style: analyseStyle(m.samples as StyleSample[]) };
      const ranked = matchCategory(m.samples as StyleSample[], current.style).ranked.map((r) => r.id);
      (self as unknown as Worker).postMessage({ type: 'guess', sig: m.sig, ranked });
    } catch (err) {
      current = null;
      (self as unknown as Worker).postMessage({ type: 'error', sig: m.sig, message: String(err) });
    }
    queue = queue.filter((j) => j.sig === m.sig);
  } else if (m.type === 'grow') {
    queue = queue.filter((j) => j.sig === m.sig && j.category === m.category);
    for (const j of m.jobs as { ch: string; seed: number }[]) queue.push({ sig: m.sig, category: m.category, ...j });
  }
  if (!running) pump();
};

function pump() {
  running = true;
  // One character per tick, so newer messages (a new style, a reroll) get in between.
  const job = queue.shift();
  if (!job) {
    running = false;
    return;
  }
  if (current && job.sig === current.sig) {
    let glyph = null;
    try {
      glyph = grownGlyph(job.ch, current.style, job.seed, job.category, renderLetter, materialFor, verticalRange);
    } catch (err) {
      console.warn('could not grow', job.ch, err);
    }
    (self as unknown as Worker).postMessage({ type: 'glyph', sig: job.sig, category: job.category, ch: job.ch, seed: job.seed, glyph });
  }
  setTimeout(pump, 0);
}
