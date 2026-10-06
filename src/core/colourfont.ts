// Colour tables that put the photo letters into the font itself, so typing shows the real
// materials instead of black shapes. The same pictures go in three ways, because every app family
// reads a different one:
//   sbix       Apple (Pages, Keynote, Word for Mac, Safari) and most other systems
//   CBDT/CBLC  Android, ChromeOS, Linux and Windows
//   SVG        Microsoft Office, Adobe apps, Firefox
// The black outlines in glyf stay as the fallback for apps that can't draw colour letters.

export interface PictureStrike {
  /** Pixels per em this PNG was drawn for. */
  ppem: number;
  png: Uint8Array;
  width: number;
  height: number;
}

export interface GlyphPicture {
  /** Where the picture sits, font units, y up: left edge, bottom edge, width, height. */
  x: number;
  y: number;
  w: number;
  h: number;
  advance: number;
  /** Lower-left corner of the glyph's outline box (glyf xMin, yMin). */
  outlineMin: { x: number; y: number };
  strikes: PictureStrike[];
}

/** Concatenates byte chunks into one array (tables can be megabytes, too big for number[]). */
class Bytes {
  private parts: Uint8Array[] = [];
  length = 0;
  push(b: Uint8Array) {
    this.parts.push(b);
    this.length += b.length;
  }
  u8(...v: number[]) { this.push(Uint8Array.from(v.map((x) => x & 0xff))); }
  u16(v: number) { this.u8(v >> 8, v); }
  u32(v: number) { this.u8(v >>> 24, v >>> 16, v >>> 8, v); }
  tag(s: string) { this.u8(...[...s.padEnd(4)].map((c) => c.charCodeAt(0))); }
  done(): Uint8Array {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

const px = (units: number, ppem: number) => Math.round((units * ppem) / 1000);

/** Every strike size used by at least one picture, smallest first. */
export function strikeSizes(pics: (GlyphPicture | undefined)[]): number[] {
  return [...new Set(pics.flatMap((p) => p?.strikes.map((s) => s.ppem) ?? []))].sort((a, b) => a - b);
}

const strikeOf = (p: GlyphPicture | undefined, ppem: number) => p?.strikes.find((s) => s.ppem === ppem);

export function sbixTable(pics: (GlyphPicture | undefined)[], sizes: number[]): Uint8Array {
  const n = pics.length;
  const out = new Bytes();
  out.u16(1); // version
  out.u16(1); // flags: bit 0 always set; outlines are not drawn over the pictures
  out.u32(sizes.length);
  const strikes = sizes.map((ppem) => {
    const s = new Bytes();
    s.u16(ppem);
    s.u16(72);
    const data = new Bytes();
    const offsets: number[] = [];
    const head = 4 + (n + 1) * 4;
    for (const p of pics) {
      offsets.push(head + data.length);
      const st = strikeOf(p, ppem);
      if (!p || !st) continue;
      // Apple (and FreeType, which copies it) measure this offset from the lower-left corner of the
      // glyph's outline box, not from its origin as the spec says. Checked in Chromium on Linux.
      data.u16((px(p.x, ppem) - px(p.outlineMin.x, ppem)) & 0xffff);
      data.u16((px(p.y, ppem) - px(p.outlineMin.y, ppem)) & 0xffff);
      data.tag('png ');
      data.push(st.png);
    }
    offsets.push(head + data.length);
    for (const o of offsets) s.u32(o);
    s.push(data.done());
    return s.done();
  });
  let off = 8 + sizes.length * 4;
  for (const s of strikes) {
    out.u32(off);
    off += s.length;
  }
  for (const s of strikes) out.push(s);
  return out.done();
}

const i8 = (v: number) => Math.max(-128, Math.min(127, v)) & 0xff;
const u8 = (v: number) => Math.max(0, Math.min(255, v));

/**
 * CBDT/CBLC with one strike per size. Their metrics are single bytes, so only sizes where every
 * picture fits are written (in practice about 128 ppem or less).
 */
export function cbdtTables(pics: (GlyphPicture | undefined)[], sizes: number[], ascent: number, descent: number): { CBDT: Uint8Array; CBLC: Uint8Array } | null {
  const cbdt = new Bytes();
  cbdt.u16(3);
  cbdt.u16(0);
  type Size = { ppem: number; first: number; last: number; imageDataOffset: number; offsets: number[]; m: { widthMax: number; minOriginSB: number; minAdvanceSB: number; maxBeforeBL: number; minAfterBL: number } };
  const made: Size[] = [];
  for (const ppem of sizes) {
    const fits = (p: GlyphPicture | undefined) => {
      const st = strikeOf(p, ppem);
      if (!p || !st) return false;
      const top = px(p.y, ppem) + st.height;
      return st.width <= 255 && st.height <= 255 && Math.abs(px(p.x, ppem)) <= 127 && top <= 127 && top >= -128 && px(p.advance, ppem) <= 255;
    };
    // A strike missing some letters would show those in black at its size, so it's all or nothing.
    const ids = pics.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
    if (ppem > 255 || !ids.length || !ids.every((i) => fits(pics[i]))) continue;
    const first = ids[0], last = ids[ids.length - 1];
    const imageDataOffset = cbdt.length;
    const offsets: number[] = [];
    const m = { widthMax: 0, minOriginSB: 127, minAdvanceSB: 127, maxBeforeBL: -128, minAfterBL: 127 };
    for (let g = first; g <= last; g++) {
      offsets.push(cbdt.length - imageDataOffset);
      const p = pics[g];
      if (!fits(p)) continue;
      const st = strikeOf(p, ppem)!;
      const bx = px(p!.x, ppem), by = px(p!.y, ppem) + st.height, adv = px(p!.advance, ppem);
      // Format 17: small metrics, then the PNG.
      cbdt.u8(st.height, st.width, i8(bx), i8(by), u8(adv));
      cbdt.u32(st.png.length);
      cbdt.push(st.png);
      m.widthMax = Math.max(m.widthMax, st.width);
      m.minOriginSB = Math.min(m.minOriginSB, bx);
      m.minAdvanceSB = Math.min(m.minAdvanceSB, adv - bx - st.width);
      m.maxBeforeBL = Math.max(m.maxBeforeBL, by);
      m.minAfterBL = Math.min(m.minAfterBL, by - st.height);
    }
    offsets.push(cbdt.length - imageDataOffset);
    made.push({ ppem, first, last, imageDataOffset, offsets, m });
  }
  if (!made.length) return null;

  const cblc = new Bytes();
  cblc.u16(3);
  cblc.u16(0);
  cblc.u32(made.length);
  // Index tables follow the size records; each is one array entry plus one format-1 subtable.
  const indexSize = (s: Size) => 8 + 8 + s.offsets.length * 4;
  let off = 8 + made.length * 48;
  for (const s of made) {
    cblc.u32(off);
    cblc.u32(indexSize(s));
    cblc.u32(1);
    cblc.u32(0); // colorRef
    for (let k = 0; k < 2; k++) {
      // Line metrics, horizontal then vertical (the same numbers; only horizontal is used).
      cblc.u8(i8(px(ascent, s.ppem)), i8(-px(descent, s.ppem)), u8(s.m.widthMax), 0, 0, 0);
      cblc.u8(i8(s.m.minOriginSB), i8(s.m.minAdvanceSB), i8(s.m.maxBeforeBL), i8(s.m.minAfterBL), 0, 0);
    }
    cblc.u16(s.first);
    cblc.u16(s.last);
    cblc.u8(s.ppem, s.ppem, 32, 1); // ppemX, ppemY, 32-bit colour, horizontal metrics
    off += indexSize(s);
  }
  for (const s of made) {
    cblc.u16(s.first);
    cblc.u16(s.last);
    cblc.u32(8);
    cblc.u16(1); // index format 1: one offset per glyph
    cblc.u16(17); // image format 17: small metrics + PNG
    cblc.u32(s.imageDataOffset);
    for (const o of s.offsets) cblc.u32(o);
  }
  return { CBDT: cbdt.done(), CBLC: cblc.done() };
}

function base64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/** One SVG document per picture glyph, holding the sharpest PNG. */
export function svgTable(pics: (GlyphPicture | undefined)[]): Uint8Array | null {
  const docs: { gid: number; bytes: Uint8Array }[] = [];
  const enc = new TextEncoder();
  pics.forEach((p, gid) => {
    if (!p || !p.strikes.length) return;
    const st = p.strikes.reduce((a, b) => (b.ppem > a.ppem ? b : a));
    // SVG glyphs: y points down, origin on the baseline, one unit per font unit.
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1">` +
      `<g id="glyph${gid}"><image x="${p.x}" y="${-(p.y + p.h)}" width="${p.w}" height="${p.h}" preserveAspectRatio="none" ` +
      `xlink:href="data:image/png;base64,${base64(st.png)}"/></g></svg>`;
    docs.push({ gid, bytes: enc.encode(svg) });
  });
  if (!docs.length) return null;
  const out = new Bytes();
  out.u16(0);
  out.u32(10);
  out.u32(0);
  out.u16(docs.length);
  let off = 2 + docs.length * 12;
  for (const d of docs) {
    out.u16(d.gid);
    out.u16(d.gid);
    out.u32(off);
    out.u32(d.bytes.length);
    off += d.bytes.length;
  }
  for (const d of docs) out.push(d.bytes);
  return out.done();
}
