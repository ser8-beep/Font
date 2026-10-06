# Object alphabets — combined (phase 1 + phase 2)

933 transparent cutouts, organised by category and letter.

## Structure
`<category>/<LETTER>/<source>_<char>_<case>.png`
- Up to 4 primary variations per letter, picked to come from different source sets. Any extras sit in `<LETTER>/_more/`.
- Upper- and lowercase share a letter folder; the case is in the filename.

## What was left out
- `_review/` material and the two chair-technique references.
- Every set that wasn't a clean cutout: tile/grid photos (matchsticks, books, drafting close-ups, food tiles, photo grids, Lettres confinées, Abba Richman), textured or coloured backgrounds (yellow paper, concrete, weathered wood, poster), grainy scans and collages, black-background jewellery, the painted illustration, and the hand-cropped word layouts on textured surfaces.
- Individual glyphs inside kept sets where the cutout broke apart — mostly thin wire or white/clear objects on white.
- Digits and punctuation.

## Cutout method
Hard mask against the source background, 1px feather, background colour removed from the edge pixels (no white halo on dark or coloured backgrounds).

## Files
- `manifest.json` — every PNG with letter, case, category, objects, construction, source, `primary` flag.
- `coverage.csv` — variations per category and letter.
- `generation_brief.csv` — one photographic prompt per missing variation (558 rows) to bring every letter in every category to 3. Each prompt lists the objects already used for that letter so the new image varies the object, not the look.
