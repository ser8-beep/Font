# Photo → Font Station

A browser app that turns a photo of handmade letters (Lego, clay, wool, coffee beans, gummy bears…) into a photographic font you can type with and install. Every letter is a cut-out of the real photo. It was built for the **Typography Type Play** kids' workshop.

Everything happens inside the web page. Attendees add their photo and the page finds the letters, traces them and writes the `.ttf` file itself. They don't need a scanner, a separate program, an account or an internet connection. After the page has loaded once, it works offline.

## The six steps

1. **Snap**: add a photo any way you like. Take it with the webcam, choose a file (on a phone this offers the camera *or* the gallery), drag it onto the page, or paste it with Ctrl+V. There's also a built-in Lego demo. The screen shows framing tips.
2. **Check**: the app finds the letter blobs and labels them left to right (P, L, A, Y). Kids can drag a label onto a different box, tap a box to choose its letter, remove a box with ✕, or **draw a box around a letter** when detection misses one.
3. **Neaten**: each letter gets a *Thinner ↔ Bolder* slider with the photo and the cut-out letter side by side. A **Fill the gaps** switch handles porous materials. It switches on by itself when a letter is made of separate pieces, such as beans, pasta or buttons.
4. **A–Z**: the app grows the rest of the alphabet, plus 0–9 and common punctuation, out of the same stuff as the photographed letters. The tiles fill in one by one (about 3–4 seconds for the lot on a laptop). The kid's own letters keep a 📷 badge, and any grown letter has a **Try another** button that makes a new version of it. If the photo spelt `play` in small letters, the alphabet grows in small letters; capitals give capitals. At the top, the app says what kind of stuff it thinks the letters are made of (for example *🧸 Toys & games* or *✏️ Stationery*), using the object-type repository. **Not right? Change it** picks another category, and the new letters regrow the way makers in that category build theirs. Tapping a letter shows **ideas**: objects other makers used for that letter, with a button to photograph a real one.
5. **Play**: a playground. A big text box shows what the kid types in their own letters as they type, with a keyboard made of their letters, a **🎲 Surprise me** word button, *Small / Medium / Big* sizes, and background colours (one is sampled from their own table). Letters always show as photos, with a soft shadow like real things lying on a table. The first time they type a word, it fills the screen with confetti.
6. **Save**: download a `.ttf` named by the kid, a PNG poster of what they typed, and **letter pictures** (a zip with one see-through PNG per letter). The `.ttf` is a colour font: typing with it shows the photo letters, and it holds every grown character. The letter pictures are for apps that can't use installed or colour fonts, such as Canva and Google Docs.

Every step has **◀ Back** and **↶ Undo** buttons. Ctrl/Cmd+Z also works.

## Running it at the workshop

```bash
npm install
npm run build        # dist/ (offline PWA) and dist-single/index.html (one self-contained file)
```

There are three ways to run it. Pick the one that suits the room:

| Setup | How | Webcam | Offline |
|---|---|---|---|
| **One file per laptop** (most robust) | Copy `dist-single/index.html` to each laptop (USB stick or zip) and open it in Chrome | ✅ | ✅ always |
| **Served from the facilitator laptop** | `npm run room`, then kids open `http://<facilitator-ip>:8787` | ⚠️ see below | ✅ once the page is open |
| **Local dev** | `npm run dev` | ✅ on localhost | n/a |

**As a claude.ai link.** `npm run build:artifact` writes `dist-single/artifact.html`, which can be published as a claude.ai artifact. That viewer blocks the webcam and the room wall, so there attendees add photos by choosing a file, dragging it onto the page or pasting it. Saving the font and the poster asks the viewer to confirm.

**Webcams and LAN addresses.** Chrome only allows the webcam on `https://`, `localhost` or `file://` pages. A page served from `http://192.168.x.x` can't use the webcam, so kids get only **Choose a photo** (phones still open their camera from that button). If kids need the laptop webcam *and* the room wall, open the single file (`file://`) and enter the room-wall address on the Save screen under **Room wall…**. That address is remembered on each laptop.

**Facilitator demo.** **Try the Lego demo** on the first screen loads a sample photo of PLAY in Lego, for the projector walkthrough.

### Shared room alphabet (optional)

```bash
npm run build
npm run room                # prints the kid URL and the projector URL
npm run room -- --reset     # start with an empty wall
```

- On the Save screen, kids press the blue **Send** button under "Send your letters to the room wall". The newest letter for each character wins.
- The projector opens `http://<ip>:8787/#room`. It shows A–Z filling up live over a WebSocket, and its **Download room font (.zip)** button saves the combined `.ttf`, an SVG of every letter, and a list of which team made each one.
- Letters are stored as SVG path data in `server/room-data.json`, so restarting the server keeps the wall.

## Installing the font

The font is a **colour font**: each letter is stored as the kid's photo, plus a plain outline that apps without colour-font support fall back to.

- **Windows:** open the `.ttf` from Downloads, press **Install**, then pick the font in Word.
- **macOS:** double-click the `.ttf`, then **Install Font**.
- **Canva:** uploading fonts needs a Canva Pro, Teams or Education account (Brand Kit → Upload a font), and Canva may draw it as plain shapes. The **letter pictures** zip always works: drag the PNGs in and line them up.
- **Google Docs can't use fonts installed on the computer**, only Google Fonts. Use the letter pictures or the poster there.

Where the photos show up. Each app family reads a different colour-font format, so the file carries the same pictures three ways:

| Format | Read by | Checked |
|---|---|---|
| `sbix` | macOS and iOS (Pages, Keynote, TextEdit, Word for Mac, Safari), Chrome, Android, Linux | ✅ Chromium on Linux |
| `CBDT`/`CBLC` | Chrome, Android, ChromeOS, Linux, Windows 10/11 | ✅ Chromium on Linux |
| `SVG` | Microsoft 365 (Word, PowerPoint), Adobe apps, Firefox | written to the spec; not checked here |

**Test the saved font in the actual apps on the workshop laptops before the day**, especially Word on Windows. An app that can't draw colour fonts shows the letters as solid shapes; the letter pictures are the fallback there.

## Testing (for developers only; attendees never need this)

```bash
npm test               # unit tests: tracing, TTF structure and checksums, colour tables and PNG, categories, segmentation on samples, font build under 2 s
npm run samples:test   # runs segmentation on every photo in /samples and reports letters found per photo
npm run samples:test -- --debug   # also writes overlays and a .ttf per photo to samples/_debug/
npm run samples:make   # regenerates the synthetic sample photos
```

`/samples` currently holds **synthetic** photos of PLAY in ten setups: lego, lego-dim-webcam, clay, wool, coffee-beans, gummy-bears, pasta, buttons, honey, straws. They have uneven lighting, shadows, textured backgrounds and JPEG noise, but they are not real photos. **Add real test shots to `/samples` before the workshop.** A photo that spells something other than PLAY should be named like `wool__SAM.jpg`. The script exits non-zero if any photo finds the wrong number of letters.

Current result: 10/10 synthetic photos give 4 letters. In `lego-dim-webcam.jpg` the bricks of L and A physically touch, so the cut between them lands in the wrong place. That photo needs the one allowed manual fix: remove the box, then draw it again.

## How it works

```
photo ─► background model ─► "stands out" map ─► threshold ─► close gaps ─► blobs ─► merge / split to N letters
                                                                                       │
             per letter: bolder slider + fill gaps (full resolution) ◄─────────────────┘
                     │
                     ▼
     soften + resample ─► trace pixel edges ─► simplify ─► quadratic curves ─► TrueType glyph ─► .ttf
```

- **Segmentation** (`src/core/segment.ts`): it fits a smooth background colour surface (quadratic in x/y, per Lab channel) to the pixels that look like background, which copes with uneven lighting and vignetting. Each pixel's colour distance from that surface goes through an Otsu threshold. A closing then fuses separate pieces (beans, gummy bears) into one blob per letter. It tries several closing sizes and keeps the largest one that gives the expected count without bridging neighbouring letters. Fragments get merged and specks dropped, and blobs much wider than a letter are split at their thinnest column.
- **Tracing** (`src/core/trace.ts`): it follows the pixel boundaries and simplifies them with Ramer–Douglas–Peucker. Gentle bends become TrueType off-curve points and sharp corners stay on-curve. Outer contours wind clockwise and holes counter-clockwise.
- **Font writing** (`src/core/ttf.ts`): a small TrueType writer covering `cmap`, `glyf`, `head`, `hhea`, `hmtx`, `loca`, `maxp`, `name`, `OS/2` and `post`, plus the colour tables below. Cap height is 700 of 1000 units, sitting on the baseline. Advance width is the letter width plus 60 units on each side. A font made only of capitals (or only small letters) maps the other case to the same glyphs. The output passes the OpenType Sanitizer (the font checker Chrome uses) and parses in fontTools and opentype.js.

### Growing the alphabet

`src/core/alphabet/` makes the missing letters. It never invents a texture: every grown letter is painted from pixels of the kid's own photo.

1. **Shape.** Each character has a skeleton of strokes in font units (`skeletons.ts`): lines, arcs, bowls, loops and dots, on a baseline / x-height / cap-height grid. The photographed letters are measured (`measure.ts`, `fit.ts`) and the skeletons are bent to match them: width, slant, how round the bowls are, where the crossbar sits, stroke weight.
2. **Material.** `style.ts` decides what the photographed letters are made of, and the matching painter draws each new letter:
   - **Grid** (`materials/grid.ts`): Lego and other bricks. It finds the stud grid, and new letters are built from whole cells cut from the photo, so bricks stay square and the colours match.
   - **Pieces** (`materials/pieces.ts`): beans, buttons, gummy bears, pasta, stars. It separates the photo into single pieces and lays copies along the new strokes, single file for thin strokes or scattered for thick ones, keeping the same spacing.
   - **Strokes** (`materials/strokes.ts`): clay, wool, pipe cleaners, and whole objects such as biscuits, carabiners or engine parts. It cuts each photographed letter into its parts (straight bars, curves, rings, discs). Bendy materials are swept along the new strokes. Rigid objects are placed as whole parts and fitted to straight pieces or chords of a curve. Round parts fill bowls and dots.
   - **Flat**: the fallback, the letter shape filled with the photo's average colour and texture.
3. **Glyph.** Each painted letter is traced with the same tracer as the photographed ones, so the `.ttf` and the photo preview always match.

The work runs in a Web Worker, so the page stays responsive while the tiles fill in. `npm run alphabet:samples` grows an alphabet for every photo in `/samples` and writes a contact sheet PNG and a `.ttf` per photo to `samples/_debug/`. Add photo names to limit it (`-- lego clay`), `--chars=abcxyz` to pick characters, `--seed=3` for another roll, `--category=tools` to build the letters the way another category does, or `--refs` to use local test photos in `samples/_refs/` (not committed).

**Limits.** Grown letters are only as good as the photo. Busy backgrounds (wood floors, patterned cloth) and strong shadows confuse segmentation, and a shadow that gets picked up becomes part of the material. Objects that only appear once in PLAY (one big wine glass, say) get reused a lot, so a few grown letters can look repetitive. **Try another** usually helps. Try the workshop's real materials and table before the day.

### The object-type repository

`data/object-type-repository.json` lists 1,088 letters from real object alphabets, sorted into 20 categories (stationery, fruit & veg, tools, nuts & bolts, jewellery…). For each letter it records the objects used and how the letter was built: **single** (one object), **composite** (several different objects), **repeated** (copies of one object) or **formed** (bendy stuff such as wire, peel or cord). `npm run repository` turns it into `src/core/alphabet/repository-data.ts`, a 31 KB table with counts and object names per category and letter. `other` ("flag before use") and `body` are left out. The repository has no pictures, so the app never shows or copies the reference alphabets.

`src/core/alphabet/category.ts` uses it three ways:

1. **Matching the photo to a category.** It reads how each photographed letter is built (Lego and beans are *repeated*, a wool bowl is *formed*, a letter of a pencil and a ruler is *composite*) and what colours the letters are (metal grey, wood/biscuit brown, green, bright plastic). Each category is scored by how well those colours fit its usual look and how often its makers built these same letters that way, plus a few material clues (Lego bricks → toys, clay → art supplies). This is a guess, which is why kids can change it with one tap. On the 19 sample photos it gets 11 right: Lego (both), wool, pasta, gummy bears, honey, biscuits, engine parts, jewellery, packaging and pencil shavings. Of the misses, buttons, clay, coffee beans, books and carabiners have the right category second or third. Straws and the Christmas photo are further off.
2. **Building each new letter the category's way.** For every character, the build is drawn from what that category's makers did for the same letter (falling back to the category's overall habits), so **Try another** can also try a different build. The painter then uses a photographed letter built the same way where the photo has one: *repeated* lines up copies of one whole object (a K of pencils), *single* stretches one object per stroke, *composite* mixes objects from different letters, and *formed* sweeps bendy stuff round curves or puts pieces single file. Lego and beans can only be built one way, so for them the category mainly changes the ideas.
3. **Ideas.** Up to four objects per letter, most used first, shown when a kid taps a letter.

### Photo letters in the font

`src/core/colourfont.ts` writes the colour tables and `src/core/picture.ts` makes each letter's pictures: the material cut-out resized to 128 and 256 pixels per em (`src/core/png.ts` has the resizer and a small PNG encoder, so this runs in Node too). The app makes the pictures in a worker (`src/pictures.ts`) and starts as soon as the alphabet is finished, so **Save my font** is quick. A typical A–Z font is about 3 MB.

Two details found by testing in Chromium: `sbix` picture offsets are measured from the corner of the letter's outline box, not from its origin as the spec reads (Apple's behaviour, which FreeType copies). And `CBDT` stores sizes in single bytes, so it only gets the 128 ppem pictures.

### Where this differs from the brief's tech stack

- **No OpenCV.js.** It adds about 8 MB to load and parse on slow laptops, and the pipeline only needs threshold, morphology and connected components. Those are written in plain TypeScript (`src/core/mask.ts`). The same code also runs in Node, which is what lets `npm run samples:test` work without a browser.
- **No potrace.** The tracer in `src/core/trace.ts` produces TrueType's native quadratic curves directly, so no cubic-to-quadratic conversion is needed.
- **opentype.js is used only in the tests.** It writes CFF-flavoured OpenType. Named `.ttf`, that kind of file is rejected by some Windows apps. The app writes real TrueType (`glyf`) outlines itself, and the tests read them back with opentype.js.

## Project layout

```
src/core/      image, mask morphology, segmentation, tracing, TTF writer, colour tables, PNG (framework-free, runs in Node too)
src/ui/        one React component per step + projector room view
src/core/alphabet/  growing new letters: skeletons, style fitting, material painters
src/grow.ts    runs the alphabet growing in a Web Worker (grow.worker.ts) and feeds the UI
src/font.ts    letters → glyphs (cached), photo cut-outs, text layout, font build
src/pictures.ts  makes the font's photo letters in a worker
data/          object-type repository (how real object alphabets were built, by category)
src/poster.ts  PNG poster
src/room.ts    room wall client
server/        room wall server (Node http + ws)
scripts/       sample generator, segmentation report, alphabet contact sheets, repository table
samples/       test photos
tests/         vitest
```
