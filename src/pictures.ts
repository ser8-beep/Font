import { glyphPicture } from './core/picture';
import { materialRGBA, type FontPicture, type LetterGlyph } from './font';
import PicturesWorker from './pictures.worker?worker&inline';

// Font pictures take a moment per letter (resizing and PNG-compressing two sizes), so they are
// made in a worker, kept per letter look, and started early so "Save my font" is quick.

type Result = { id: string; picture: FontPicture | null };

const done = new Map<string, FontPicture | null>();
const waiting = new Map<string, ((r: FontPicture | null) => void)[]>();
let worker: Worker | null | undefined;
// Jobs the worker has not answered yet, so they can be redone here if the worker dies.
const inFlight = new Map<string, LetterGlyph>();

function finish({ id, picture }: Result) {
  inFlight.delete(id);
  if (done.size > 500) done.delete(done.keys().next().value!);
  done.set(id, picture);
  for (const cb of waiting.get(id) ?? []) cb(picture);
  waiting.delete(id);
}

function onMainThread(g: LetterGlyph) {
  // One letter per tick so the page keeps responding.
  setTimeout(() => {
    let picture: FontPicture | null = null;
    try {
      picture = glyphPicture(materialRGBA(g), g.outline);
    } catch {
      /* the font keeps the outline for this one */
    }
    finish({ id: g.id, picture });
  }, 0);
}

let heard = false;

/** Some hosts refuse inline workers, sometimes only later: finish everything on the page then. */
function giveUpOnWorker() {
  if (!worker) return;
  worker.terminate();
  worker = null;
  for (const g of inFlight.values()) onMainThread(g);
  inFlight.clear();
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new PicturesWorker();
    worker.onmessage = (e) => {
      heard = true;
      finish(e.data);
    };
    worker.onerror = giveUpOnWorker;
    // One letter takes well under a second; total silence means the worker never started.
    setTimeout(() => !heard && giveUpOnWorker(), 8000);
  } catch {
    worker = null;
  }
  return worker;
}

function start(g: LetterGlyph) {
  if (done.has(g.id) || waiting.has(g.id)) return;
  waiting.set(g.id, []);
  const w = getWorker();
  if (!w) return onMainThread(g);
  inFlight.set(g.id, g);
  const image = materialRGBA(g);
  w.postMessage({ id: g.id, image, outline: g.outline });
}

/** Start making pictures for these letters in the background. */
export function warmPictures(glyphs: Iterable<LetterGlyph>) {
  for (const g of glyphs) start(g);
}

/** Pictures for every letter, by glyph id. Calls onProgress as letters finish. */
export async function fontPictures(glyphs: LetterGlyph[], onProgress?: (done: number, total: number) => void): Promise<Map<string, FontPicture>> {
  const out = new Map<string, FontPicture>();
  let n = 0;
  onProgress?.(0, glyphs.length);
  await Promise.all(
    glyphs.map(
      (g) =>
        new Promise<void>((res) => {
          const got = (p: FontPicture | null) => {
            if (p) out.set(g.id, p);
            onProgress?.(++n, glyphs.length);
            res();
          };
          if (done.has(g.id)) return got(done.get(g.id)!);
          start(g);
          if (done.has(g.id)) return got(done.get(g.id)!);
          waiting.get(g.id)!.push(got);
        }),
    ),
  );
  return out;
}
