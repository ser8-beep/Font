// Picture backgrounds for the playground: party cards for birthday invitations, and pictures that go
// with each theme (made by scripts/backgrounds.py from data/backgrounds.json). Small previews come
// with the page; a full picture is loaded when it is picked. On the claude.ai page the pictures sit
// in backgrounds/ beside it (see scripts/make-artifact-page.mjs), like the letter pictures.
import manifest from './backgrounds/manifest.json';

export interface Background {
  id: string;
  label: string;
  /** 'party' (birthday invitations) and the themes it goes with. */
  groups: string[];
  /** Full size, in pixels. */
  w: number;
  h: number;
  /** Where words go: the calm middle of the picture, as shares [x, y, w, h]. */
  safe: [number, number, number, number];
  /** The text colour that reads best there. */
  ink: string;
}

export const BACKGROUNDS = manifest as Background[];
const byId = new Map(BACKGROUNDS.map((b) => [b.id, b]));
export const backgroundById = (id: string): Background | null => byId.get(id) ?? null;

const THUMBS = import.meta.glob('./backgrounds/thumbs/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export const thumbUrl = (id: string) => THUMBS[`./backgrounds/thumbs/${id}.webp`];

const FULL = import.meta.env.MODE === 'artifact' ? null : (import.meta.glob('./backgrounds/*.webp', { query: '?url', import: 'default' }) as Record<string, () => Promise<string>>);
const fullUrl = async (id: string) => (FULL ? FULL[`./backgrounds/${id}.webp`]() : new URL(`backgrounds/${id}.webp`, document.baseURI).href);

type Picture = CanvasImageSource & { width: number; height: number };
const loaded = new Map<string, Picture>();
const loading = new Map<string, Promise<Picture>>();

/** The picture, if it has loaded (renderDesign draws a plain paper colour until then). */
export const backgroundImage = (id: string): Picture | null => loaded.get(id) ?? null;

/** Loads a full picture (once). */
export function loadBackground(id: string): Promise<Picture> {
  let p = loading.get(id);
  if (!p) {
    p = (async () => {
      const url = await fullUrl(id);
      let pic: Picture;
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`${r.status}`);
        pic = await createImageBitmap(await r.blob());
      } catch {
        const img = new Image();
        img.src = url;
        await img.decode();
        pic = img;
      }
      loaded.set(id, pic);
      return pic;
    })();
    loading.set(id, p);
    p.catch(() => loading.delete(id));
  }
  return p;
}

/**
 * Pictures to offer, grouped: only the typeface's themes' (or every theme's, while the themes aren't
 * known yet), with the party cards first for a birthday invitation. Each picture once.
 */
export function backgroundGroups(themes: string[], invite: boolean): { key: string; items: Background[] }[] {
  const known = themes.filter((t) => BACKGROUNDS.some((b) => b.groups.includes(t)));
  const all = [...new Set(BACKGROUNDS.flatMap((b) => b.groups))].filter((g) => g !== 'party');
  const order = [...(invite ? ['party'] : []), ...(known.length ? known : all)];
  const seen = new Set<string>();
  const out: { key: string; items: Background[] }[] = [];
  for (const key of order) {
    const items = BACKGROUNDS.filter((b) => b.groups.includes(key) && !seen.has(b.id));
    items.forEach((b) => seen.add(b.id));
    if (items.length) out.push({ key, items });
  }
  return out;
}
