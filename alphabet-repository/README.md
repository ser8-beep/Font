# Object alphabets — combined (phase 1 + phase 2)

1196 transparent cutouts, organised by category and letter.

## Categories

Five, chosen to overlap as little as possible (see `src/core/alphabet/groups.ts`, re-sort with
`npm run repository:regroup`):

| Category | Takes in |
|---|---|
| `stationery` (Doodle Desk) | stationery, art, books |
| `tools` (Tinker's Toolbox) | tools, hardware, vehicle |
| `produce` (Market Basket) | produce |
| `food` (Pantry Raid) | prepared_food |
| `plants` (Secret Garden) | nature |

Each cut-out keeps its finer category as `tag` in `manifest.json`. Cut-outs whose tag fits none of
the five (household, fashion, furniture, leisure, packaging, textiles, found, electronics, body)
are kept in `_set-aside/<tag>/<LETTER>/` with `set_aside: true`; the app doesn't use them.

## Adding cut-outs
- Ready-made cut-outs (one folder per set, `<CHAR>_<case>.png`): describe the sets in a file like
  `data/imports/object-alphabet-cutouts.json`, then `npm run repository:import -- <folder> <that file>`
  and `npm run repository:regroup`. A set that is a photo already here replaces its cut-outs
  letter by letter; a set the catalogue lists takes its objects and categories from there; a new
  set is added to the catalogue's sources. Whole words and symbols go to `_set-aside/_not-letters/`.
- Generated photos for `generation_brief.csv`: `npm run repository:add -- <folder>`.
- Real cut-outs always come before generated ones when the four primary pictures are picked.

## Structure
`<category>/<LETTER>/<source>_<char>_<case>.png`
- Up to 4 primary variations per letter, picked to come from different source sets. Any extras sit in `<LETTER>/_more/`.
- Upper- and lowercase share a letter folder; the case is in the filename.

## What was left out
- `_review/` material and the two chair-technique references.
- Every set that wasn't a clean cutout: tile/grid photos (matchsticks, books, drafting close-ups, food tiles, photo grids, Lettres confinées, Abba Richman), textured or coloured backgrounds (yellow paper, concrete, weathered wood, poster), grainy scans and collages, black-background jewellery, the painted illustration, and the hand-cropped word layouts on textured surfaces.
- Individual glyphs inside kept sets where the cutout broke apart — mostly thin wire or white/clear objects on white.
- Digits and punctuation.
- From object-alphabet-cutouts.zip: nothing. The food, packaging and vegetables sets are the photos
  already here as img20, img30 and img11, so their sharper cut-outs replaced the old ones;
  craft-supplies and drafting-tools are the catalogue's img02 and img33. The woven words
  (WEAVING & SOLVING interlock, so they are whole lines) and the collage's & are in
  `_set-aside/_not-letters/`; drafting-tools' Ñ is kept but the app only uses A–Z.

## Sharpened copies (`_upscaled/`)
Most cut-outs are 60-150 px tall, smaller than the font draws them (256 px per em). For every
cut-out the app uses that is under 300 px tall, `_upscaled/<same path>.webp` holds a 4x Real-ESRGAN
copy (general photo model, at most 480 px tall). `npm run library` uses it instead of the original.
The originals stay as they were. To redo or extend (new cut-outs, say):

    sudo apt-get install libomp5
    python3 -m venv .venv-sr && .venv-sr/bin/pip install realesrgan-ncnn-py
    .venv-sr/bin/python -I scripts/upscale-repository.py     # skips pictures already done

## Cutout method
Hard mask against the source background, 1px feather, background colour removed from the edge pixels (no white halo on dark or coloured backgrounds).

## Halo cleaning

`scripts/clean-repository.py` checks every cut-out for a light rim (edge pixels much lighter and greyer than the object just inside). It cleans the ones that have one into `_clean/<same path>.webp`. It takes away flat paper that touches the outside, then clears and recolours the rim. Letters it can't fix go in `_clean/excluded.json`. A letter can't be fixed when it still has a rim, cleaning took more than a third of it, or paper is still showing. `rejected.json` holds what was checked by eye: `trusted_sources` (re-cut with the paper colour already taken out, so the cleaner leaves them alone), `leave_out` (single cut-outs that still show paper), `keep_as_is` (cut-outs whose light parts are the object itself, such as white feathers) and `sources` (whole sources left out; none at present).

The 20 botanical lettering photos are in `data/botanical-photos/` with each letter's box (`letters.json`). `scripts/recut-botanical.py` cuts their letters on the photos sharpened 4× with Real-ESRGAN (`_4x/`, made once, not in git): the paper is modelled per pixel, darker pixels count as plant only at crisp edges (stems, not shadows), GrabCut settles the edges, and the paper colour is taken out of them. The sharp cut becomes the letter's sharpened copy; the repository keeps it at the photo's own size. The library builder skips both lists, and other alphabets fill in. Originals are never changed.

## Files
- `manifest.json` — every PNG with letter, case, category, objects, construction, source, `primary` flag.
- `coverage.csv` — variations per category and letter.
- `generation_brief.csv` — one photographic prompt per missing variation to bring every letter in every category to 3 (rewritten for the five categories). Each prompt lists the objects already used for that letter so the new image varies the object, not the look.
