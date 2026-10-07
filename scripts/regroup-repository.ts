// Sorts the alphabet repository into the five kid-facing categories (src/core/alphabet/groups.ts).
//
//   npm run repository:regroup
//
// Every cut-out keeps its finer catalogue category as `tag` and moves to
// <category>/<LETTER>/<file> (up to four primary pictures per letter, from different sources first;
// the rest in <LETTER>/_more/). Cut-outs whose tag fits none of the five move to
// _set-aside/<tag>/<LETTER>/ with set_aside: true, so nothing is lost. coverage.csv and
// generation_brief.csv are rewritten for the five categories. Running it again changes nothing.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUPS, groupOf } from '../src/core/alphabet/groups';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(ROOT, 'alphabet-repository');
const TARGET = 3;
const PRIMARY = 4;
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

interface Entry {
  id: string; char: string; letter: string; case: string; category: string; objects: string; construction: string;
  source: string; confidence: string; file: string; primary: boolean; generated?: boolean; tag?: string; set_aside?: boolean;
}
const manifest = JSON.parse(readFileSync(join(REPO, 'manifest.json'), 'utf8')) as Entry[];

// Primary pictures: per category and letter, spread over sources (one per source first).
const primaries = new Set<Entry>();
const byLetter = new Map<string, Entry[]>();
for (const e of manifest) {
  const tag = e.tag ?? e.category;
  const group = groupOf(tag);
  if (!group) continue;
  const k = `${group}/${e.letter}`;
  byLetter.set(k, [...(byLetter.get(k) ?? []), e]);
}
for (const list of byLetter.values()) {
  // Real cut-outs before generated ones, then earlier primaries.
  const ordered = [...list].sort((a, b) => Number(!!a.generated) - Number(!!b.generated) || Number(b.primary) - Number(a.primary));
  const pick: Entry[] = [];
  const sources = new Set<string>();
  for (const e of ordered) if (pick.length < PRIMARY && !sources.has(e.source)) { pick.push(e); sources.add(e.source); }
  for (const e of ordered) if (pick.length < PRIMARY && !pick.includes(e)) pick.push(e);
  for (const e of pick) primaries.add(e);
}

const taken = new Set<string>();
for (const e of manifest) {
  const tag = e.tag ?? e.category;
  const group = groupOf(tag);
  const dir = group ? `${group}/${e.letter}${primaries.has(e) ? '' : '/_more'}` : `_set-aside/${tag}/${e.letter}`;
  let name = basename(e.file);
  for (let n = 2; taken.has(`${dir}/${name}`); n++) name = basename(e.file).replace(/\.png$/, `_${n}.png`);
  const file = `${dir}/${name}`;
  taken.add(file);
  if (file !== e.file) {
    mkdirSync(join(REPO, dir), { recursive: true });
    renameSync(join(REPO, e.file), join(REPO, file));
  }
  e.tag = tag;
  e.category = group ?? tag;
  e.file = file;
  e.primary = !!group && primaries.has(e);
  if (group) delete e.set_aside;
  else e.set_aside = true;
}

// Remove folders the move left empty.
function prune(dir: string) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) prune(p);
  }
  if (dir !== REPO && !readdirSync(dir).length) rmdirSync(dir);
}
prune(REPO);
writeFileSync(join(REPO, 'manifest.json'), JSON.stringify(manifest, null, 1));

// Coverage and the generation brief for the five categories (both cases count, as before).
const SUBJECT: Record<string, string> = {
  stationery: 'office, school and art stationery (pencils, pens, rulers, set squares, paper clips, tape, erasers, brushes)',
  tools: 'hand tools and workshop hardware (pliers, wrenches, screwdrivers, hammers, nuts, bolts, hooks, springs)',
  produce: 'fresh fruit and vegetables',
  food: 'snacks, biscuits, sweets and prepared food',
  plants: 'plants and flowers (leaves, twigs, petals, flower heads, ferns, grasses)',
};
const coverage = ['category,letter,have,need_to_reach_3'];
const brief = ['category,letter,variation,prompt'];
for (const group of Object.keys(GROUPS)) {
  for (const L of UPPER) {
    const have = manifest.filter((e) => e.category === group && e.letter === L && !e.set_aside);
    coverage.push(`${group},${L},${have.length},${Math.max(0, TARGET - have.length)}`);
    const used = [...new Set(have.map((e) => e.objects))].join('; ') || 'none yet';
    for (let v = have.length + 1; v <= TARGET; v++) {
      const prompt =
        `Overhead studio photograph of the capital letter ${L} built from real ${SUBJECT[group]}, laid flat on a seamless pure white background. ` +
        `Soft diffused daylight from the upper left, faint natural contact shadows, sharp focus, true-to-life colour and texture, the letter centred with generous white margin. ` +
        `A real photograph of real objects — not an illustration, not a 3D render, no text, no other letters. Use different objects from these: ${used}.`;
      brief.push(`${group},${L},${v},"${prompt.replace(/"/g, '""')}"`);
    }
  }
}
writeFileSync(join(REPO, 'coverage.csv'), coverage.join('\n') + '\n');
writeFileSync(join(REPO, 'generation_brief.csv'), brief.join('\n') + '\n');

const counts = Object.keys(GROUPS).map((g) => `${g} ${manifest.filter((e) => e.category === g).length}`);
console.log(`${counts.join(', ')}; set aside ${manifest.filter((e) => e.set_aside).length}; brief ${brief.length - 1} pictures to reach ${TARGET}`);
if (!existsSync(join(REPO, 'README.md'))) console.log('note: no README.md in the repository');
