// Runs several devices through the app at the same time, to check that sessions never interfere.
//
//   npm run build && npm run check:parallel
//   CHROMIUM=/path/to/chrome npm run check:parallel      # if Chromium lives elsewhere
//
// Each "device" is its own browser profile (like a separate phone or laptop), with that device's
// screen size, touch and pixel density. Two more sessions share one profile, like two tabs on one
// laptop. They all take different paths at once (whole-word photo or one letter at a time, capitals
// or small letters, different words, frames and designs), save their posters and fonts, and send
// their letters to one room wall, which a projector page watches. Afterwards every session must
// still show its own words and frame, every saved poster must have its own frame's size, and the
// wall must have every team's letters. The room server uses a throw-away data file.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { chromium, devices, type BrowserContext, type Page } from 'playwright-core';
import { analyse } from '../src/core/segment';
import { FRAMES, type FrameId } from '../src/design';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(tmpdir(), `font-station-parallel-${process.pid}`);
mkdirSync(TMP, { recursive: true });

// ---- one photo per letter, cut from the Lego demo ----
const demo = jpeg.decode(readFileSync(join(ROOT, 'src/assets/demo-lego.jpg')), { useTArray: true });
const an = analyse({ width: demo.width, height: demo.height, data: new Uint8ClampedArray(demo.data.buffer) }, { expected: 4 });
const k = demo.width / an.work.width;
const boxes = an.blobs.map((b) => b.box).sort((a, b) => a.x - b.x);
if (boxes.length !== 4) throw new Error(`expected 4 letters in the demo photo, found ${boxes.length}`);
for (const [i, c] of [...'PLAY'].entries()) {
  const b = boxes[i], pad = 0.15 * Math.max(b.w, b.h);
  const x0 = Math.max(0, Math.round((b.x - pad) * k)), y0 = Math.max(0, Math.round((b.y - pad) * k));
  const x1 = Math.min(demo.width, Math.round((b.x + b.w + pad) * k)), y1 = Math.min(demo.height, Math.round((b.y + b.h + pad) * k));
  const w = x1 - x0, h = y1 - y0, data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) demo.data.subarray(((y0 + y) * demo.width + x0) * 4, ((y0 + y) * demo.width + x1) * 4).forEach((v, j) => (data[y * w * 4 + j] = v));
  writeFileSync(join(TMP, `${c}.jpg`), jpeg.encode({ width: w, height: h, data }, 90).data);
}

// ---- the room server, on its own port and data file ----
const PORT = 8900 + (process.pid % 90);
const BASE = `http://localhost:${PORT}`;
const server = spawn('node', [join(ROOT, 'server/room-server.js'), '--reset'], { env: { ...process.env, PORT: String(PORT), ROOM_DATA: join(TMP, 'wall.json') }, stdio: 'ignore' });
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${BASE}/api/room`)).ok) break;
  } catch {
    /* not up yet */
  }
  if (i > 50) throw new Error('room server did not start (run npm run build first)');
  await new Promise((r) => setTimeout(r, 200));
}

interface Job {
  name: string;
  /** Sessions with the same profile share storage, like tabs on one device. */
  profile: string;
  device: string;
  mode: 'word' | 'letters';
  small?: boolean;
  text: string;
  frame: FrameId;
  gradient?: boolean;
  pattern?: boolean;
  sticker?: string;
  saveFont?: boolean;
}
const JOBS: Job[] = [
  { name: 'desktop', profile: 'desktop', device: 'Desktop Chrome', mode: 'word', text: 'LEGO FUN', frame: 'desktop', gradient: true, sticker: 'star', saveFont: true },
  { name: 'iphone', profile: 'iphone', device: 'iPhone 13', mode: 'letters', text: 'PLAY', frame: 'phone', pattern: true, sticker: 'heart' },
  { name: 'ipad', profile: 'ipad', device: 'iPad (gen 7)', mode: 'word', text: 'YAY', frame: 'ipad', gradient: true, pattern: true },
  { name: 'android', profile: 'android', device: 'Pixel 7', mode: 'word', small: true, text: 'play', frame: 'a4', sticker: 'smiley' },
  { name: 'laptop-tab1', profile: 'laptop', device: 'Desktop Chrome', mode: 'letters', text: 'PAL', frame: 'a3', saveFont: true },
  { name: 'laptop-tab2', profile: 'laptop', device: 'Desktop Chrome', mode: 'word', text: 'LAP', frame: 'desktop', pattern: true, sticker: 'sun' },
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const profiles = new Map<string, BrowserContext>();
const profile = async (j: Job) => {
  if (!profiles.has(j.profile)) {
    const { defaultBrowserType: _, ...d } = devices[j.device];
    profiles.set(j.profile, await browser.newContext({ ...d, acceptDownloads: true }));
  }
  return profiles.get(j.profile)!;
};
const errors: string[] = [];
const watch = (page: Page, who: string) => {
  page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${who}: ${m.text()}`));
};

/** Width and height from a PNG's header. */
const pngSize = (b: Buffer) => [b.readUInt32BE(16), b.readUInt32BE(20)];
const shortName = (f: FrameId) => FRAMES[f].label.replace(' wallpaper', '').replace(' poster', '');

// The projector, watching the wall the whole time.
const wallCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const wall = await wallCtx.newPage();
watch(wall, 'wall');
await wall.goto(`${BASE}/#room`);

async function run(j: Job, page: Page) {
  const step = async () => page.getByRole('button', { name: 'Next ▶' }).click();
  await page.goto(BASE);
  if (j.mode === 'word') {
    await page.getByText('Try the Lego demo').click();
    await page.getByText('Match your letters').waitFor({ timeout: 60_000 });
    for (const ch of 'PLAY') {
      await page.locator('.stage .chip.unknown').first().click();
      const c = j.small ? ch.toLowerCase() : ch;
      await page.locator(j.small ? `.picker button[aria-label="small ${c}"]` : '.picker .letters button', { hasText: c }).first().click();
    }
    await step();
  } else {
    await page.getByText('One letter at a time').click();
    for (const c of 'PLAY') {
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: `Choose a photo of ${c}` }).click()]);
      await chooser.setFiles(join(TMP, `${c}.jpg`));
      await page.getByRole('button', { name: `Change the photo of ${c}` }).waitFor({ timeout: 60_000 });
    }
    await step();
  }
  await page.getByText('Make them neat').waitFor();
  await step();
  await page.getByText('Your whole alphabet!').waitFor({ timeout: 120_000 });
  await step();

  // Play: their words and their design.
  await page.locator('.typebox').fill(j.text);
  await page.waitForTimeout(1600);
  if (await page.locator('.celebrate').count()) await page.locator('.celebrate').click();
  await page.getByRole('button', { name: new RegExp(`^${shortName(j.frame)}`) }).click();
  if (j.gradient) await page.getByRole('button', { name: 'Gradient', exact: true }).click();
  if (j.pattern) await page.locator('.pattern-tiles button').nth(1).click();
  if (j.sticker) await page.getByRole('button', { name: `Add a ${j.sticker}` }).click();
  await step();

  // Save: poster (and font), then the room wall.
  await page.locator('#maker').fill(`Team ${j.name}`);
  const [poster] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.getByRole('button', { name: `⬇ Save ${FRAMES[j.frame].label.toLowerCase()}` }).click()]);
  const size = pngSize(readFileSync((await poster.path())!));
  let fontBytes = 0;
  if (j.saveFont) {
    const [font] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.getByText('Save my font').click()]);
    fontBytes = readFileSync((await font.path())!).length;
  }
  await page.getByText('Send your letters to the room wall').waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: /^Send / }).click();
  await page.getByText('Your letters are on the wall').waitFor({ timeout: 20_000 });
  return { size, fontBytes };
}

const t0 = Date.now();
const pages = await Promise.all(JOBS.map(async (j) => { const p = await (await profile(j)).newPage(); watch(p, j.name); return p; }));
const results = await Promise.allSettled(JOBS.map((j, i) => run(j, pages[i])));

// Afterwards: each session still shows its own words and frame.
let failed = 0;
for (const [i, j] of JOBS.entries()) {
  const r = results[i];
  if (r.status === 'rejected') {
    failed++;
    console.log(`✗ ${j.name}: ${String(r.reason).split('\n')[0]}`);
    continue;
  }
  const want = FRAMES[j.frame];
  const page = pages[i];
  await page.getByRole('button', { name: '◀ Back' }).click();
  const text = await page.locator('.typebox').inputValue();
  const frame = await page.locator('.frame-chips button.on').textContent();
  const ok = r.value.size[0] === want.w && r.value.size[1] === want.h && text === j.text && frame === shortName(j.frame) && (!j.saveFont || r.value.fontBytes > 10_000);
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${j.name.padEnd(12)} ${j.device.padEnd(15)} poster ${r.value.size.join('×')} (want ${want.w}×${want.h})  words "${text}"  frame ${frame}${j.saveFont ? `  font ${(r.value.fontBytes / 1e6).toFixed(1)} MB` : ''}`);
}

// The wall heard every team.
const state = (await (await fetch(`${BASE}/api/room`)).json()) as { submissions: number; alphabet: Record<string, { team: string }> };
await wall.waitForTimeout(500);
const cells = await wall.locator('.room-cell.filled').count();
const sent = results.filter((r) => r.status === 'fulfilled').length;
const wallOk = state.submissions === sent && cells >= 4 && Object.keys(state.alphabet).some((c) => c === c.toLowerCase());
if (!wallOk) failed++;
console.log(`${wallOk ? '✓' : '✗'} room wall: ${state.submissions} of ${sent} sends arrived, ${cells} squares filled on the projector, letters ${Object.keys(state.alphabet).sort().join('')}`);
if (errors.length) {
  failed++;
  console.log('✗ errors:\n  ' + errors.join('\n  '));
}
console.log(`${JOBS.length} sessions at once in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${failed ? `${failed} problem(s)` : 'no interference'}`);

await browser.close();
server.kill();
process.exit(failed ? 1 : 0);
