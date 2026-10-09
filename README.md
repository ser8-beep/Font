# Photo → Font Station

A browser app that turns a photo of handmade letters (Lego, clay, wool, coffee beans, gummy bears…) into a photographic font you can type with and install. Every letter is a cut-out of the real photo. It was built for the **Typography Type Play** kids' workshop.

Everything happens inside the web page. Attendees add their photo and the page finds the letters, traces them and writes the `.ttf` file itself. They don't need a scanner, a separate program, an account or an internet connection. After the page has loaded once, it works offline.

## The six steps

Every step has a **💬 Rate this step** button in the bottom bar, and Save ends with the same questions about the whole station: three ratings on a scale of five faces from 😣 to 😄 (how easy it was to understand, how easy it was to use, how often they got stuck without a clue what to do) and a remark. On the claude.ai page feedback goes to the artifact's shared store (`feedback/<viewer>/entries`, with `feedback/<viewer>` listing who left feedback; readable only by the owner and editors). Elsewhere, or for viewers who may only look, it stays on the device, and **Download feedback saved on this device** in the feedback sheet gives the facilitator a spreadsheet (CSV).

1. **Snap**: the first page says what the station does in one line, shows the journey (build PLAY → photograph it → get a whole A–Z → play and save), then asks two numbered questions: how they will photograph it, then the photo. Tips for a good photo sit to one side. Kids always build the word **PLAY**, so there is nothing to type. They choose **All four letters in one photo** or **One letter at a time**. One letter at a time shows a card for each of P, L, A and Y with its own photo and a **theme** menu (what the letter is made of: one of the five themes, or *not sure*); letters can be skipped (the A–Z fills them in), and a new photo of a letter replaces its old one. A photo can come in any way: the webcam, a file (on a phone this offers the camera *or* the gallery), dragging it onto the page, or pasting with Ctrl+V. The screen shows framing tips. **Add more letters** later asks which letter (A–Z) is in the next photo and what it is made of, and **Photograph my own X** in the A–Z step picks X already.
2. **Match**: the app finds the letter shapes and marks each one with a **?**. It does not guess which letter is which: kids drag each letter of their word onto its shape (or tap a shape and choose), remove a box with ✕ when it isn't a letter, or **draw a box around a letter** the app missed. The picker offers capitals and small letters. A photo taken for one letter already has that letter on its biggest shape, because the kid said which letter it is. With several photos, a row of thumbnails switches between them, and each thumbnail is ticked once its letter is matched. Photos taken one letter at a time skip this step: the kid already chose which letter each photo is.
3. **Neaten**: each letter gets a *Thinner ↔ Bolder* slider with the photo and the cut-out letter side by side. A **Fill the gaps** switch handles porous materials. It switches on by itself when a letter is made of separate pieces, such as beans, pasta or buttons.
4. **A–Z**: the app fills in every other letter from **real object alphabets** in its letter library, in one or more of five themes: *✏️ Doodle Desk* (pens, paper, art supplies and desk odds and ends), *🔧 Tinker's Toolbox* (tools, nuts and bolts, bike bits and rusty scraps), *🧺 Market Basket* (fruit, veg and herbs), *🍪 Pantry Raid* (snacks, sweets, pasta, beans, honey and baking) and *🌿 Secret Garden* (flowers, leaves, feathers and creepy-crawlies). **Themes in your typeface** shows where they come from: the themes the kid tagged their letters with (shared by how many letters each has), or else the theme the photo looks like. Kids can **mix in another theme**, take one out, or slide each theme's share; shares always total 100% and count across the whole typeface, so the kid's own tagged letters count towards their theme. The missing letters are shared out by those percentages and spread evenly through the alphabet, and a small badge on each letter shows its theme. Each letter comes from its theme's best alphabet: the sharpest pictures first (high-resolution originals before small enlarged ones), then the one with the most of the letters needed that looks most like the photo. The kid's own letters keep a 📷 badge. **Try another** swaps a letter for the same letter from another alphabet, **🔀 Try a different alphabet** switches the main theme's set, and **Not right? Change it** swaps a single theme for another. Tapping a letter says what it is made of ("This K is made of scissors, open") and gives ideas for building a real one. Fonts are letters only for now (no numbers or punctuation). If the photo spelt `play` in small letters, the font gets small letters where an alphabet has them, and capitals where none does.
5. **Play**: a playground that is also a poster and birthday invitation designer: a live preview beside a panel of numbered controls, plus a keyboard made of the kid's letters. In the panel, in this order:
   - **1. Background**: a picture, a colour or a gradient (straight at any angle, or round; ready-made ones too). Pictures: only those for the typeface's own themes (every theme's while the themes aren't known yet), then the 🎉 birthday invitation cards. 56 pictures in all, sharpened with Real-ESRGAN (twice the size, four times for small ones) so they print crisply; see `data/backgrounds.json` and `scripts/backgrounds.py`. Picking a picture puts the words in its calm middle; picking a party card with no text yet adds a text box with example party details.
   - **2. Big words in your letters**: a box to type in (Enter starts a new line), **🎲 Surprise me**, and Small, Medium or Big. Characters the photo font doesn't have, like an age or !, are written by hand.
   - **3. Text boxes**: add as many as wanted, each with its own text (Enter starts a new line), font (handwritten Patrick Hand, the default, or easy-to-read Nunito; both bundled, so they work offline), size, colour (it starts in the colour that reads best on the background) and place (a 3 × 3 placement grid, or drag it).
   - **Size**: the picture's own shape, phone wallpaper (1170×2532), iPad wallpaper (2048×2732), desktop wallpaper (2560×1440), A4 (300 dpi) or A3 (250 dpi; a 300 dpi A3 is too big for phones and tablets to make).
   - **Pattern**: three patterns for the letters' category (graph paper, notebook lines and dot grid for Doodle Desk; blueprint, tread plate and hex nuts for Tinker's Toolbox; picnic check, market stripes and seeds for Market Basket; tablecloth, sprinkles and polka dots for Pantry Raid; leaves, blossoms and grass for Secret Garden; a typeface mixing themes gets all their patterns), in any colour and strength.

   The big words and text boxes can be dragged anywhere. Letters always show as photos, with a soft shadow like real things lying on a table. The first time they type a word, it fills the screen with confetti.
6. **Save**: download a `.ttf` named by the kid, the poster or invitation from Play as a full-size PNG (with an optional name tag), and **letter pictures** (a zip with one see-through PNG per letter). The `.ttf` is a colour font: typing with it shows the photo letters. The letter pictures are for apps that can't use installed or colour fonts, such as Canva and Google Docs.

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

**As a claude.ai link.** `npm run build:artifact` writes `dist-artifact/artifact.html` (about 3 MB) and `dist-artifact/atlases/*.webp`, the letter pictures, and `dist-artifact/backgrounds/*.webp`, the full-size background pictures. Publish the page as a claude.ai artifact with the pictures as files beside it at `atlases/<name>.webp` and `backgrounds/<id>.webp`. The page loads a category's pictures only when a kid uses that category, so it opens fast and stays under claude.ai's 16 MB page limit however many alphabets are added. (The USB single file, `dist-single/index.html`, still carries everything inside it.) That viewer blocks the webcam and the room wall, so there attendees add photos by choosing a file, dragging it onto the page or pasting it. Saving the font and the poster asks the viewer to confirm.

**Webcams and LAN addresses.** Chrome only allows the webcam on `https://`, `localhost` or `file://` pages. A page served from `http://192.168.x.x` can't use the webcam, so kids get only **Choose a photo** (phones still open their camera from that button). If kids need the laptop webcam *and* the room wall, open the single file (`file://`) and enter the room-wall address on the Save screen under **Room wall…**. That address is remembered on each laptop.

**Facilitator demo.** For a projector walkthrough, choose `samples/lego-demo.jpg` (PLAY in Lego) on the first screen.

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
npm test               # unit tests: tracing, TTF structure and checksums, colour tables and PNG, categories, letter library, segmentation on samples, font build under 2 s
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

### The letter library

Every letter a kid doesn't make comes from a real object alphabet: a cut-out of a letter someone built from objects and photographed. The cut-outs live in **`alphabet-repository/`**, the consolidated repository: `<category>/<LETTER>/<source>_<char>_<case>.png`, transparent backgrounds only, with `manifest.json` (letter, case, category, objects, construction, source, `primary`), `coverage.csv` (pictures per category and letter) and `generation_brief.csv` (a photographic prompt for every picture still needed to reach three per letter per category). Up to four primary pictures per letter come from different sets; extras sit in `<LETTER>/_more/`. See its own README.

`npm run library` turns it into `src/library/`: one packed WebP per category plus `manifest.json` (where each letter sits in its picture, its outline for the `.ttf`, what it is made of). Letters of one source within a category count as one alphabet, so a font can keep to one maker's style.

How a letter is chosen (`src/library.ts`):

1. **Alphabets are ranked** for the kid's category: the category's own alphabets first, by how many of the needed letters they have in the right case and how close their colours are to the kid's letters; then the nearest categories' alphabets (`NEAREST`), for letters the category doesn't have yet.
2. **Each missing letter** comes from the first alphabet that has it; **Try another** walks down the list. The other case is used only when no alphabet has the right one.
3. The cut-out goes into the font as is: its traced outline in `glyf`, its photo in the colour tables.

Small letters exist only in a few alphabets; elsewhere a small-letter font uses capitals. Fonts are letters only for now.

### The object-type repository

`data/object-type-repository.json` lists 1,088 letters from real object alphabets, sorted into 20 fine categories, with the objects used and how each letter was built: **single** (one object), **composite** (several different objects), **repeated** (copies of one object) or **formed** (bendy stuff such as wire, peel or cord).

Kids only see **five categories**, picked to overlap as little as possible (`src/core/alphabet/groups.ts`):

| Category | Pools the fine categories |
|---|---|
| ✏️ Doodle Desk | stationery, art, books |
| 🔧 Tinker's Toolbox | tools, hardware, vehicle |
| 🧺 Market Basket | produce |
| 🍪 Pantry Raid | prepared_food |
| 🌿 Secret Garden | nature |

Home stuff, jewellery, furniture, toys, packaging, textiles, festive, found things and electronics fit none of the five cleanly, so they are left out: their cut-outs wait in `alphabet-repository/_set-aside/`. `npm run repository` turns the catalogue into `src/core/alphabet/repository-data.ts` (counts and object names per category and letter); `npm run repository:regroup` sorts the cut-out repository the same way and rewrites its coverage and generation brief. `npm run repository:import` adds folders of ready-made cut-outs (see the repository's README). `scripts/upscale-repository.py` makes 4x Real-ESRGAN copies of small cut-outs so library letters stay crisp; `npm run library` uses them. `scripts/clean-repository.py` takes leftover paper and white halos off cut-outs that came from photos (into `_clean/`, which `npm run library` prefers) and lists the ones it couldn't fix in `_clean/excluded.json`; whole sources that still looked wrong by eye are in `alphabet-repository/rejected.json`. Both are left out of the app.

`src/core/alphabet/category.ts` uses it two ways:

1. **Matching the photo to a category.** It reads how each photographed letter is built (Lego and beans are *repeated*, a wool bowl is *formed*, a letter of a pencil and a ruler is *composite*) and what colours the letters are (metal grey, wood/biscuit brown, green, bright plastic). Each category is scored by how well those colours fit its usual look and how often its makers built these same letters that way, plus a few material clues (bricks, clay and wool count as craft supplies, so Doodle Desk; separate pieces such as beans lean to Pantry Raid). This is a guess, which is why kids can change it with one tap. On the sample photos: Lego, clay, wool, straws, buttons, pencil shavings and the stationery photo come out as Doodle Desk; pasta, coffee beans, gummy bears, honey and biscuits as Pantry Raid; engine parts as Tinker's Toolbox. The photos of carabiners, jewellery, packaging, books and Christmas things don't belong to any of the five and land wherever their colours fit best.
2. **Ideas.** Up to four objects per letter, most used first, shown when a kid taps a letter.

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
src/core/alphabet/  reading the kid's letters: what they're made of, which repository category
src/library.ts letter library: ranking alphabets, choosing letters, loading cut-outs
src/library/   the library itself (built by scripts/library.ts from alphabet-repository/)
src/grow.ts    the kid's whole alphabet: matching (in grow.worker.ts) + library letters
src/font.ts    letters → glyphs (cached), photo cut-outs, text layout, font build
src/pictures.ts  makes the font's photo letters in a worker
data/          object-type repository (the catalogue: how each reference letter was built)
alphabet-repository/  the cut-out letters, by category and letter
src/design.ts  poster and invitation designs: frames, fills, patterns, body text, drawing
src/backgrounds.ts  the picture backgrounds (src/backgrounds/, made by scripts/backgrounds.py)
src/fonts.ts  the invitation details' fonts
src/room.ts    room wall client
server/        room wall server (Node http + ws)
scripts/       sample generator, segmentation report, repository table, letter library builder
samples/       test photos
tests/         vitest
```
