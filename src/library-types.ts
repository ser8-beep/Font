// The letter library: real object alphabets the app fills a kid's font from (built by
// scripts/library.ts into src/library/).

export interface LibraryLetter {
  /** Repository glyph id, e.g. img02-10. */
  id: string;
  char: string;
  /** What it is made of, e.g. "scissors, open". */
  objects: string;
  build: 'single' | 'composite' | 'repeated' | 'formed';
  /** The repository was sure what the objects are. */
  confident: boolean;
  /** Where it sits in the set's atlas: x, y, width, height (px). */
  rect: [number, number, number, number];
  /** Outline for the .ttf, SVG path data in font units (y up). */
  svg: string;
  advance: number;
  lsb: number;
  inkWidth: number;
  bottom: number;
  top: number;
}

export interface LibrarySet {
  /** Category and source, e.g. stationery/img02 (one source can have letters in several categories). */
  id: string;
  category: string;
  /** What the set is, from the repository. */
  title: string;
  /** The packed picture its letters are in (one per category). */
  atlas: string;
  /** Colour make-up [metal, dark, green, brown, bright, hues/6], comparable with a kid's photo. */
  looks: number[];
  /** Made by an image model to fill a gap, not cut from a real alphabet. */
  generated?: boolean;
  /** Median height (px) of its original cut-outs before any sharpening: how much detail they really have. */
  native?: number;
  letters: LibraryLetter[];
}

export interface LibraryManifest {
  sets: LibrarySet[];
}
