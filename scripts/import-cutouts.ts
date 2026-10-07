// Adds a folder of ready-made cut-outs (transparent PNGs, one folder per set) to the alphabet
// repository.
//
//   npm run repository:import -- <folder of sets> <sets.json>
//   npm run repository:regroup        # then sort the new pictures into place
//
// Each set folder holds <CHAR>_<case>.png files (<CHAR>_<case>_2.png for a repeat, N-tilde for Ñ).
// sets.json says, per set folder, which source it is (see data/imports/):
//   - a source already in the repository: the new pictures replace its cut-outs letter by letter
//     (same photo, better cut-outs), keeping what the manifest says about each letter;
//   - a source the catalogue (data/object-type-repository.json) lists without cut-outs: each
//     letter takes its objects, build and category from the catalogue;
//   - a new source: tag, objects, construction and description come from sets.json, and the
//     catalogue gets a source entry (so the app can name the set).
// Files that are not one letter (whole words, &) are kept in _set-aside/_not-letters/<set>/.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { groupOf } from '../src/core/alphabet/groups';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(ROOT, 'alphabet-repository');
const CATALOGUE = join(ROOT, 'data', 'object-type-repository.json');
const [folder, setsFile] = process.argv.slice(2);
if (!folder || !setsFile) {
  console.error('usage: npm run repository:import -- <folder of sets> <sets.json>');
  process.exit(1);
}

interface SetInfo {
  source: string; tag?: string; objects?: string; construction?: string; description?: string;
  /** What each picture is made of, by file name without .png ("R_upper": "noodles"), when the set mixes objects. */
  letters?: Record<string, string>;
}
interface Entry {
  id: string; char: string; letter: string; case: string; category: string; objects: string; construction: string;
  source: string; confidence: string; file: string; primary: boolean; generated?: boolean; tag?: string; set_aside?: boolean;
}
interface Glyph { id: string; char: string; letter: string; case: string; category: string; objects: string; construction: string; source: string; confidence: string }
const sets = (JSON.parse(readFileSync(setsFile, 'utf8')) as { sets: Record<string, SetInfo> }).sets;
const manifest = JSON.parse(readFileSync(join(REPO, 'manifest.json'), 'utf8')) as Entry[];
const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8')) as { sources: { id: string; file: string; description: string; default_category: string; case: string }[]; glyphs: Glyph[] };

const NAMED: Record<string, string> = { 'N-tilde': 'Ñ' };
const SAFE: Record<string, string> = { Ñ: 'N-tilde' };
/** A letter cut-out's name, or null for words and symbols. */
function parse(name: string): { char: string; case: string; n: number } | null {
  const m = name.match(/^([A-Za-z]|N-tilde)_(upper|lower)(?:_(\d+))?\.png$/);
  return m ? { char: NAMED[m[1]] ?? m[1], case: m[2], n: Number(m[3] ?? 1) } : null;
}
const fileName = (source: string, char: string, cs: string, n: number) => `${source}_${SAFE[char] ?? char}_${cs}${n > 1 ? `_${n}` : ''}.png`;

let replaced = 0, added = 0, other = 0;
// Nothing is written until every set has been read, so a bad set leaves the repository as it was.
const copies: [from: string, to: string][] = [];
const removes: string[] = [];
for (const [set, info] of Object.entries(sets)) {
  const dir = join(folder, set);
  if (!existsSync(dir)) { console.log(`${set}: not in the folder, skipped`); continue; }
  const existing = manifest.filter((e) => e.source === info.source);
  const glyphs = catalogue.glyphs.filter((g) => g.source === info.source);
  const used = new Set<object>();
  // The best unused match: the same character first, then the same letter in the other case.
  const pick = <T extends { char: string; letter: string }>(list: T[], char: string) =>
    list.find((x) => !used.has(x) && x.char === char) ?? list.find((x) => !used.has(x) && x.letter.toUpperCase() === char.toUpperCase());
  let next = Math.max(-1, ...existing.map((e) => Number(e.id.match(/-(\d+)$/)?.[1] ?? -1))) + 1;

  for (const name of readdirSync(dir).filter((f) => f.endsWith('.png')).sort()) {
    const p = parse(name);
    if (!p) {
      copies.push([join(dir, name), join(REPO, '_set-aside', '_not-letters', set, name)]);
      other++;
      continue;
    }
    const letter = p.char.toUpperCase();
    const old = existing.length ? pick(existing, p.char) : undefined;
    if (old) {
      // Same photo, better cut-out: keep the entry, swap the picture.
      used.add(old);
      const file = `${dirname(old.file)}/${fileName(info.source, p.char, p.case, p.n)}`;
      copies.push([join(dir, name), join(REPO, file)]);
      if (file !== old.file) removes.push(join(REPO, old.file));
      Object.assign(old, { char: p.char, letter, case: p.case, file });
      replaced++;
      continue;
    }
    const g = pick(glyphs, p.char);
    if (g) used.add(g);
    const tag = g?.category ?? info.tag ?? catalogue.sources.find((s) => s.id === info.source)?.default_category;
    if (!tag) throw new Error(`${set}/${name}: no category (give the set a tag in ${basename(setsFile)})`);
    const group = groupOf(tag);
    const file = `${group ? `${group}/${letter}/_more` : `_set-aside/${tag}/${letter}`}/${fileName(info.source, p.char, p.case, p.n)}`;
    copies.push([join(dir, name), join(REPO, file)]);
    manifest.push({
      id: `${info.source}-${String(next++).padStart(2, '0')}`,
      char: p.char,
      letter,
      case: p.case,
      category: tag,
      objects: g?.objects ?? info.letters?.[name.replace(/\.png$/, '')] ?? info.objects ?? set,
      construction: g?.construction ?? info.construction ?? 'single',
      source: info.source,
      confidence: g?.confidence ?? 'high',
      file,
      primary: false,
      tag,
    });
    added++;
  }

  if (!catalogue.sources.some((s) => s.id === info.source)) {
    const mine = manifest.filter((e) => e.source === info.source);
    const cases = new Set(mine.map((e) => e.case));
    catalogue.sources.push({
      id: info.source,
      file: `object-alphabet-cutouts/${set}`,
      description: info.description ?? set,
      default_category: info.tag ?? 'found',
      case: cases.size > 1 ? 'mixed' : [...cases][0] ?? 'upper',
    });
  }
  console.log(`${set.padEnd(20)} -> ${info.source}`);
}

for (const f of removes) rmSync(f, { force: true });
for (const [from, to] of copies) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}
writeFileSync(join(REPO, 'manifest.json'), JSON.stringify(manifest, null, 1));
// Written the way the catalogue is kept: one-space indent, non-ASCII as \u escapes.
writeFileSync(CATALOGUE, JSON.stringify(catalogue, null, 1).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`));
console.log(`${replaced} cut-outs replaced, ${added} added, ${other} words/symbols kept aside; now run npm run repository:regroup`);
