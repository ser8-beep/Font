import { cbdtTables, sbixTable, strikeSizes, svgTable, type GlyphPicture } from './colourfont';
import type { Contour } from './trace';
import { CAP_HEIGHT, UNITS_PER_EM } from './trace';

// Minimal TrueType (glyf outlines) font writer.
// opentype.js only writes CFF-flavoured OpenType, which some Windows apps refuse when it is
// named .ttf, so we write real TrueType tables ourselves: cmap, glyf, head, hhea, hmtx,
// loca, maxp, name, OS/2, post. Glyphs with a picture also go into the colour tables
// (see colourfont.ts), so the font types the kid's photo letters.

export interface FontGlyph {
  /** Unicode code points mapped to this glyph (e.g. 'P' and 'p'). */
  codepoints: number[];
  contours: Contour[];
  advance: number;
  /** The letter's photo, drawn instead of the black outline wherever colour fonts work. */
  picture?: Omit<GlyphPicture, 'advance' | 'outlineMin'>;
}

export type ColourTable = 'sbix' | 'CBDT' | 'SVG';

export interface FontInfo {
  familyName: string;
  designer?: string;
  glyphs: FontGlyph[];
  /** Which colour tables to write for glyphs with pictures (default: all of them). */
  colour?: ColourTable[];
}

const ASCENT = 900;
const DESCENT = 250;
const SPACE_ADVANCE = 300;

class Writer {
  bytes: number[] = [];
  u8(v: number) { this.bytes.push(v & 0xff); }
  u16(v: number) { this.bytes.push((v >> 8) & 0xff, v & 0xff); }
  i16(v: number) { this.u16(v < 0 ? v + 0x10000 : v); }
  u32(v: number) { this.u16((v >>> 16) & 0xffff); this.u16(v & 0xffff); }
  fixed(v: number) { this.u32(Math.round(v * 65536) >>> 0); }
  tag(s: string) { for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i) || 32); }
  longDate(d: Date) {
    const secs = Math.floor(d.getTime() / 1000) + 2082844800;
    this.u32(Math.floor(secs / 4294967296));
    this.u32(secs >>> 0);
  }
  pad4() { while (this.bytes.length % 4) this.u8(0); }
  get length() { return this.bytes.length; }
}

interface Bbox { xMin: number; yMin: number; xMax: number; yMax: number }

function glyphBbox(contours: Contour[]): Bbox | null {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const c of contours) for (const p of c) {
    if (p.x < xMin) xMin = p.x; if (p.x > xMax) xMax = p.x;
    if (p.y < yMin) yMin = p.y; if (p.y > yMax) yMax = p.y;
  }
  return xMin === Infinity ? null : { xMin, yMin, xMax, yMax };
}

function encodeGlyph(contours: Contour[]): number[] {
  const bb = glyphBbox(contours);
  if (!bb) return [];
  const w = new Writer();
  w.i16(contours.length);
  w.i16(bb.xMin); w.i16(bb.yMin); w.i16(bb.xMax); w.i16(bb.yMax);
  let end = -1;
  for (const c of contours) { end += c.length; w.u16(end); }
  w.u16(0); // no instructions
  const pts = contours.flat();
  // Flags: on-curve bit plus short/same-sign bits for compact deltas.
  const xs: number[] = [], ys: number[] = [];
  let px = 0, py = 0;
  const flags: number[] = [];
  for (const p of pts) {
    const dx = p.x - px, dy = p.y - py;
    let f = p.on ? 1 : 0;
    if (dx === 0) f |= 0x10;
    else if (Math.abs(dx) < 256) { f |= 0x02; if (dx > 0) f |= 0x10; }
    if (dy === 0) f |= 0x20;
    else if (Math.abs(dy) < 256) { f |= 0x04; if (dy > 0) f |= 0x20; }
    flags.push(f);
    xs.push(dx); ys.push(dy);
    px = p.x; py = p.y;
  }
  for (const f of flags) w.u8(f);
  flags.forEach((f, i) => {
    if (f & 0x02) w.u8(Math.abs(xs[i]));
    else if (!(f & 0x10)) w.i16(xs[i]);
  });
  flags.forEach((f, i) => {
    if (f & 0x04) w.u8(Math.abs(ys[i]));
    else if (!(f & 0x20)) w.i16(ys[i]);
  });
  return w.bytes;
}

function checksum(bytes: number[] | Uint8Array, start = 0, len = bytes.length): number {
  let sum = 0;
  for (let i = start; i < start + len; i += 4) {
    const v = ((bytes[i] ?? 0) << 24) | ((bytes[i + 1] ?? 0) << 16) | ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
    sum = (sum + (v >>> 0)) >>> 0;
  }
  return sum;
}

/** ASCII-only PostScript name: letters and digits, max 63 chars. */
export function postScriptName(name: string): string {
  const ps = name.normalize('NFKD').replace(/[^A-Za-z0-9]/g, '').slice(0, 50);
  return (ps || 'MyFont') + '-Regular';
}

export function buildTTF(info: FontInfo): Uint8Array {
  const family = info.familyName.trim().slice(0, 60) || 'My Font';
  const box: Contour[] = [
    [
      { x: 50, y: 0, on: true }, { x: 50, y: CAP_HEIGHT, on: true }, { x: 450, y: CAP_HEIGHT, on: true }, { x: 450, y: 0, on: true },
    ],
    [
      { x: 100, y: 50, on: true }, { x: 400, y: 50, on: true }, { x: 400, y: CAP_HEIGHT - 50, on: true }, { x: 100, y: CAP_HEIGHT - 50, on: true },
    ],
  ];
  // Glyph 0 = .notdef box, 1 = space, then the kid's letters.
  const glyphs: FontGlyph[] = [
    { codepoints: [], contours: box, advance: 500 },
    { codepoints: [32, 0xa0], contours: [], advance: SPACE_ADVANCE },
    ...info.glyphs.filter((g) => g.codepoints.length),
  ];

  // cmap: one segment per code point keeps it simple and always valid.
  const map = new Map<number, number>();
  glyphs.forEach((g, gi) => g.codepoints.forEach((cp) => { if (cp <= 0xffff && !map.has(cp)) map.set(cp, gi); }));
  const cps = [...map.keys()].sort((a, b) => a - b);

  const tables: Record<string, number[] | Uint8Array> = {};

  // glyf + loca
  const glyf = new Writer();
  const loca: number[] = [];
  const bboxes: (Bbox | null)[] = [];
  let maxPoints = 0, maxContours = 0;
  for (const g of glyphs) {
    loca.push(glyf.length);
    const enc = encodeGlyph(g.contours);
    for (const b of enc) glyf.u8(b);
    glyf.pad4();
    bboxes.push(glyphBbox(g.contours));
    maxPoints = Math.max(maxPoints, g.contours.reduce((s, c) => s + c.length, 0));
    maxContours = Math.max(maxContours, g.contours.length);
  }
  loca.push(glyf.length);
  tables.glyf = glyf.bytes.length ? glyf.bytes : [0, 0, 0, 0];
  const locaW = new Writer();
  for (const off of loca) locaW.u32(off);
  tables.loca = locaW.bytes;

  const all = bboxes.filter(Boolean) as Bbox[];
  const fb = {
    xMin: Math.min(0, ...all.map((b) => b.xMin)),
    yMin: Math.min(0, ...all.map((b) => b.yMin)),
    xMax: Math.max(0, ...all.map((b) => b.xMax)),
    yMax: Math.max(0, ...all.map((b) => b.yMax)),
  };
  const advMax = Math.max(...glyphs.map((g) => g.advance));
  const lsbs = glyphs.map((_, i) => bboxes[i]?.xMin ?? 0);
  const rsbs = glyphs.map((g, i) => (bboxes[i] ? g.advance - bboxes[i]!.xMax : 0));
  const now = new Date();

  // head
  const head = new Writer();
  head.fixed(1); head.fixed(1);
  head.u32(0); // checkSumAdjustment, patched later
  head.u32(0x5f0f3cf5);
  head.u16(0b1011); // baseline at y=0, lsb at x=0, integer ppem
  head.u16(UNITS_PER_EM);
  head.longDate(now); head.longDate(now);
  head.i16(fb.xMin); head.i16(fb.yMin); head.i16(fb.xMax); head.i16(fb.yMax);
  head.u16(0); // macStyle
  head.u16(8); // lowestRecPPEM
  head.i16(2); // fontDirectionHint
  head.i16(1); // long loca
  head.i16(0);
  tables.head = head.bytes;

  // hhea
  const hhea = new Writer();
  hhea.fixed(1);
  hhea.i16(ASCENT); hhea.i16(-DESCENT); hhea.i16(0);
  hhea.u16(advMax);
  hhea.i16(Math.min(...lsbs)); hhea.i16(Math.min(...rsbs)); hhea.i16(fb.xMax);
  hhea.i16(1); hhea.i16(0); hhea.i16(0);
  for (let i = 0; i < 4; i++) hhea.i16(0);
  hhea.i16(0);
  hhea.u16(glyphs.length);
  tables.hhea = hhea.bytes;

  // hmtx
  const hmtx = new Writer();
  glyphs.forEach((g, i) => { hmtx.u16(g.advance); hmtx.i16(lsbs[i]); });
  tables.hmtx = hmtx.bytes;

  // maxp
  const maxp = new Writer();
  maxp.fixed(1);
  maxp.u16(glyphs.length);
  maxp.u16(maxPoints); maxp.u16(maxContours);
  maxp.u16(0); maxp.u16(0); // composite
  maxp.u16(2); // maxZones
  maxp.u16(0); maxp.u16(0); maxp.u16(0); maxp.u16(0); maxp.u16(0); maxp.u16(0);
  maxp.u16(0); maxp.u16(0);
  tables.maxp = maxp.bytes;

  // cmap: format 4 for (0,3) and (3,1)
  const f4 = new Writer();
  const segs = [...cps.map((c) => [c, c, (map.get(c)! - c + 0x10000) & 0xffff]), [0xffff, 0xffff, 1]];
  const segX2 = segs.length * 2;
  const searchRange = 2 * 2 ** Math.floor(Math.log2(segs.length));
  f4.u16(4);
  f4.u16(16 + segs.length * 8);
  f4.u16(0);
  f4.u16(segX2); f4.u16(searchRange); f4.u16(Math.log2(searchRange / 2)); f4.u16(segX2 - searchRange);
  for (const s of segs) f4.u16(s[1]);
  f4.u16(0);
  for (const s of segs) f4.u16(s[0]);
  for (const s of segs) f4.u16(s[2]);
  for (let i = 0; i < segs.length; i++) f4.u16(0);
  const cmap = new Writer();
  cmap.u16(0); cmap.u16(2);
  cmap.u16(0); cmap.u16(3); cmap.u32(20);
  cmap.u16(3); cmap.u16(1); cmap.u32(20);
  cmap.bytes.push(...f4.bytes);
  tables.cmap = cmap.bytes;

  // name
  const psName = postScriptName(family);
  const asciiFamily = family.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').trim() || psName.replace(/-Regular$/, '');
  const version = 'Version 1.000';
  const records: [number, string][] = [
    [0, `Made at Photo to Font Station${info.designer ? ' by ' + info.designer : ''}`],
    [1, family],
    [2, 'Regular'],
    [3, `${psName};${now.getTime()}`],
    [4, family],
    [5, version],
    [6, psName],
    [9, info.designer || 'Photo to Font Station'],
  ];
  const name = new Writer();
  const strings: number[] = [];
  const recs: [number, number, number, number, number, number][] = [];
  // Mac Roman (ASCII-safe) records, then Windows Unicode records; sorted by platform.
  for (const [id, text] of records) {
    const s = id === 1 || id === 4 ? asciiFamily : text.normalize('NFKD').replace(/[^\x20-\x7e]/g, '');
    const off = strings.length;
    for (const ch of s) strings.push(ch.charCodeAt(0));
    recs.push([1, 0, 0, id, s.length, off]);
  }
  for (const [id, text] of records) {
    const off = strings.length;
    for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); strings.push(c >> 8, c & 0xff); }
    recs.push([3, 1, 0x409, id, text.length * 2, off]);
  }
  name.u16(0); name.u16(recs.length); name.u16(6 + recs.length * 12);
  for (const r of recs) r.forEach((v) => name.u16(v));
  name.bytes.push(...strings);
  tables.name = name.bytes;

  // OS/2 version 4
  const os2 = new Writer();
  const letterAdv = glyphs.slice(1).map((g) => g.advance).filter((a) => a > 0);
  os2.u16(4);
  os2.i16(Math.round(letterAdv.reduce((a, b) => a + b, 0) / Math.max(1, letterAdv.length)));
  os2.u16(400); os2.u16(5);
  os2.u16(0); // fsType: installable embedding
  os2.i16(650); os2.i16(600); os2.i16(0); os2.i16(75);
  os2.i16(650); os2.i16(600); os2.i16(0); os2.i16(350);
  os2.i16(50); os2.i16(300);
  os2.i16(0);
  for (let i = 0; i < 10; i++) os2.u8(0);
  os2.u32(1); os2.u32(0); os2.u32(0); os2.u32(0); // Basic Latin
  os2.tag('PFST');
  os2.u16(0x40 | 0x80); // REGULAR | USE_TYPO_METRICS
  os2.u16(cps.length ? cps[0] : 32);
  os2.u16(cps.length ? Math.min(0xffff, cps[cps.length - 1]) : 32);
  os2.i16(ASCENT); os2.i16(-DESCENT); os2.i16(UNITS_PER_EM + 150 - ASCENT - DESCENT);
  os2.u16(Math.max(ASCENT, fb.yMax)); os2.u16(Math.max(DESCENT, -fb.yMin));
  os2.u32(1); os2.u32(0); // Latin 1 code page
  os2.i16(CAP_HEIGHT); os2.i16(CAP_HEIGHT);
  os2.u16(0); os2.u16(32); os2.u16(1);
  tables['OS/2'] = os2.bytes;

  // post version 3 (no glyph names)
  const post = new Writer();
  post.fixed(3);
  post.fixed(0);
  post.i16(-120); post.i16(50);
  post.u32(0);
  post.u32(0); post.u32(0); post.u32(0); post.u32(0);
  tables.post = post.bytes;

  const pics = glyphs.map((g, i) =>
    g.picture && g.picture.strikes.length ? { ...g.picture, advance: g.advance, outlineMin: { x: bboxes[i]?.xMin ?? 0, y: bboxes[i]?.yMin ?? 0 } } : undefined,
  );
  if (pics.some(Boolean)) {
    const want = new Set(info.colour ?? ['sbix', 'CBDT', 'SVG']);
    const sizes = strikeSizes(pics);
    if (want.has('sbix')) tables.sbix = sbixTable(pics, sizes);
    const cb = want.has('CBDT') ? cbdtTables(pics, sizes, ASCENT, DESCENT) : null;
    if (cb) Object.assign(tables, cb);
    const svg = want.has('SVG') ? svgTable(pics) : null;
    if (svg) tables['SVG '] = svg;
  }

  // Assemble. Colour tables can be megabytes, so this writes into one typed array.
  const tags = Object.keys(tables).sort();
  const numTables = tags.length;
  const sr = 16 * 2 ** Math.floor(Math.log2(numTables));
  const out = new Writer();
  out.u32(0x00010000);
  out.u16(numTables); out.u16(sr); out.u16(Math.log2(sr / 16)); out.u16(numTables * 16 - sr);
  let offset = 12 + numTables * 16;
  const dir: { tag: string; off: number; len: number }[] = [];
  for (const t of tags) {
    dir.push({ tag: t, off: offset, len: tables[t].length });
    offset += Math.ceil(tables[t].length / 4) * 4;
  }
  for (const d of dir) {
    out.tag(d.tag);
    out.u32(checksum(tables[d.tag]));
    out.u32(d.off);
    out.u32(d.len);
  }
  const bytes = new Uint8Array(offset);
  bytes.set(out.bytes);
  for (const d of dir) bytes.set(tables[d.tag], d.off);
  const headOff = dir.find((d) => d.tag === 'head')!.off;
  const adj = (0xb1b0afba - checksum(bytes)) >>> 0;
  new DataView(bytes.buffer).setUint32(headOff + 8, adj);
  return bytes;
}
