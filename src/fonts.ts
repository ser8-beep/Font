// The two fonts for an invitation's details (the words stay in the kid's photo letters): one simple
// and easy to read, one handwritten. Both are open-licence (SIL OFL) and bundled, latin only, so they
// work offline. The canvas can only draw them once loaded: loadBodyFonts() before drawing.
import nunito from '@fontsource/nunito/files/nunito-latin-800-normal.woff2?url';
import patrickHand from '@fontsource/patrick-hand/files/patrick-hand-latin-400-normal.woff2?url';

export type BodyFont = 'easy' | 'hand';

export const BODY_FONTS: Record<BodyFont, { label: string; family: string; weight: number; url: string }> = {
  easy: { label: 'Easy to read', family: 'Nunito', weight: 800, url: nunito },
  hand: { label: 'Handwritten', family: 'Patrick Hand', weight: 400, url: patrickHand },
};
export const BODY_FONT_IDS = Object.keys(BODY_FONTS) as BodyFont[];

/** A canvas/CSS font string for the details at `px` pixels. */
export function bodyFont(f: BodyFont, px: number): string {
  const d = BODY_FONTS[f];
  return `${d.weight} ${px}px "${d.family}", "Trebuchet MS", "Comic Sans MS", sans-serif`;
}

let loading: Promise<void> | null = null;

/** Loads both fonts (once). Resolves even if they can't load: the canvas then uses a system font. */
export function loadBodyFonts(): Promise<void> {
  loading ??= Promise.all(
    Object.values(BODY_FONTS).map(async (d) => {
      try {
        const face = new FontFace(d.family, `url(${d.url}) format("woff2")`, { weight: String(d.weight) });
        document.fonts.add(await face.load());
      } catch (e) {
        console.warn(`could not load ${d.family}`, e);
      }
    }),
  ).then(() => undefined);
  return loading;
}
