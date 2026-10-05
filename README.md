# Photo → Font Station

A browser app that turns a photo of handmade letters (Lego, clay, wool, coffee beans, gummy bears…) into a font you can type with and install. It was built for the **Typography Type Play** kids' workshop.

Everything runs in the browser, with no accounts and no cloud. After the page has loaded once, it works offline.

## The five steps

1. **Snap**: take a photo with the webcam, choose one, or try the built-in Lego demo. The screen shows framing tips.
2. **Check**: the app finds the letter blobs and labels them left to right (P, L, A, Y). Kids can drag a label onto a different box, tap a box to choose its letter, remove a box with ✕, or **draw a box around a letter** when detection misses one.
3. **Neaten**: each letter gets a *Thinner ↔ Bolder* slider with the photo and the traced letter side by side. A **Fill the gaps** switch handles porous materials. It switches on by itself when a letter is made of separate pieces, such as beans, pasta or buttons.
4. **Type**: a big text box shows what the kid types in their own letters as they type. Letters they haven't made yet show as grey boxes, next to an **Add more letters** button. The first time they type a word, it fills the screen with confetti.
5. **Save**: download a `.ttf` named by the kid and a PNG poster of what they typed. A **Photo letters** switch draws the poster and the preview with the real photo, so Lego stays colourful. The `.ttf` always has plain single-colour letters.

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

- **Windows:** open the `.ttf` from Downloads, press **Install**, then pick the font in Word.
- **macOS:** double-click the `.ttf`, then **Install Font**.
- **Canva:** uploading fonts needs a Canva Pro, Teams or Education account (Brand Kit → Upload a font).
- **Google Docs can't use fonts installed on the computer**, only Google Fonts. No font file can work there. The brief lists Google Docs, so this needs a decision: either drop it from the test, or have kids paste the PNG poster into Docs.

## Testing

```bash
npm test               # unit tests: tracing, TTF structure and checksums, segmentation on samples, font build under 2 s
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
- **Font writing** (`src/core/ttf.ts`): a small TrueType writer covering `cmap`, `glyf`, `head`, `hhea`, `hmtx`, `loca`, `maxp`, `name`, `OS/2` and `post`. Cap height is 700 of 1000 units, sitting on the baseline. Advance width is the letter width plus 60 units on each side. Uppercase and lowercase map to the same glyph. The output passes the OpenType Sanitizer (the font checker Chrome uses) and parses in fontTools and opentype.js.

### Where this differs from the brief's tech stack

- **No OpenCV.js.** It adds about 8 MB to load and parse on slow laptops, and the pipeline only needs threshold, morphology and connected components. Those are written in plain TypeScript (`src/core/mask.ts`). The same code also runs in Node, which is what lets `npm run samples:test` work without a browser.
- **No potrace.** The tracer in `src/core/trace.ts` produces TrueType's native quadratic curves directly, so no cubic-to-quadratic conversion is needed.
- **opentype.js is used only in the tests.** It writes CFF-flavoured OpenType. Named `.ttf`, that kind of file is rejected by some Windows apps. The app writes real TrueType (`glyf`) outlines itself, and the tests read them back with opentype.js.

## Project layout

```
src/core/      image, mask morphology, segmentation, tracing, TTF writer (framework-free, runs in Node too)
src/ui/        one React component per step + projector room view
src/font.ts    letters → glyphs (cached), text layout, font build
src/poster.ts  PNG poster
src/room.ts    room wall client
server/        room wall server (Node http + ws)
scripts/       sample generator and segmentation report
samples/       test photos
tests/         vitest
```
