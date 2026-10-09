# Removes white halos: leftover paper or table background around cut-outs that came from photos.
#
#   .venv-sr/bin/python -I scripts/clean-repository.py [--only <source> ...]   (needs numpy, opencv, pillow)
#
# For every cut-out the app uses, takes the picture the library would use (the sharpened copy in
# _upscaled/ when there is one, else the original), measures its halo (edge pixels much lighter and
# greyer than the letter just inside them) and, when there is one:
#   1. finds the background colour from the light, grey pixels along the edge;
#   2. removes flat areas of that colour that touch the outside (paper left around the letter), a
#      few times over so each newly exposed layer goes too, then specks that end up on their own;
#   3. clears light, grey edge pixels that are much lighter than the letter just inside, and gives
#      the remaining edge pixels the colour from just inside (no light rim).
# The result goes to _clean/<same path>.webp, which npm run library prefers. A letter is listed in
# _clean/excluded.json and left out of the app (other alphabets fill in) when, after cleaning, it
# still has a light rim, or cleaning took away more than a third of it (it was mostly background, or
# its own light parts looked like paper), or paper-coloured areas are still in it (shadowed paper too;
# checked for colourful letters and coloured paper only, since grey metal looks like shadowed paper).
# Clean pictures (most supplied transparent PNGs) are left alone. Originals are never changed.
import json, os, sys
import numpy as np, cv2
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
REPO = os.path.join(ROOT, 'alphabet-repository')
OUT = os.path.join(REPO, '_clean')
CATEGORIES = {'stationery', 'tools', 'produce', 'food', 'plants'}
NEEDS = 0.03   # halo share above which a picture is cleaned
KEEP = 0.06    # halo share above which a cleaned picture is still not good enough
LOST = 0.30    # share of the letter cleaning may take away
PAPER = 0.06   # share of the cleaned letter that may still look like the background
# Checked by eye (alphabet-repository/rejected.json): cut-outs whose light parts are the object itself,
# sources re-cut with the paper colour already taken out, and single cut-outs to leave out.
_REVIEW = json.load(open(os.path.join(REPO, 'rejected.json'))) if os.path.exists(os.path.join(REPO, 'rejected.json')) else {}
AS_IS = set(_REVIEW.get('keep_as_is', []))
TRUSTED = set(_REVIEW.get('trusted_sources', []))
LEAVE_OUT = set(_REVIEW.get('leave_out', []))


def lab(rgb):
    return cv2.cvtColor(rgb.astype(np.float32) / 255, cv2.COLOR_RGB2Lab)


def halo_mask(px):
    """Edge pixels that are light, grey and much lighter than the letter just inside."""
    a = px[..., 3]
    solid = (a > 128).astype(np.uint8)
    r = max(2, round(px.shape[0] / 90))
    core = cv2.erode(solid, np.ones((2 * r + 1, 2 * r + 1), np.uint8))
    if solid.sum() < 50 or core.sum() < 20:
        return None, None
    band = (a > 20) & (core == 0)
    k = (4 * r + 1) | 1
    w = cv2.blur(core.astype(np.float32), (k, k))
    inside = cv2.blur(px[..., :3] * core[..., None], (k, k)) / np.maximum(w, 1e-3)[..., None]
    lum, ilum = px[..., :3].mean(2), inside.mean(2)
    grey = px[..., :3].max(2) - px[..., :3].min(2)
    bad = band & (w > 0.02) & (lum > 185) & (lum - ilum > 45) & (grey < 45)
    return bad, band


def score(px):
    bad, band = halo_mask(px)
    return 0.0 if bad is None else bad.sum() / max(1, band.sum())


def clean(img):
    px = np.asarray(img.convert('RGBA')).astype(np.float32)
    h, w = px.shape[:2]
    a = px[..., 3].copy()
    L = lab(px[..., :3])
    chroma = np.hypot(L[..., 1], L[..., 2])
    flat = cv2.blur(L[..., 0], (5, 5))
    texture = np.sqrt(np.maximum(cv2.blur(L[..., 0] ** 2, (5, 5)) - flat ** 2, 0))
    opaque = (a > 20).astype(np.uint8)
    edge = (opaque == 1) & (cv2.dilate(1 - opaque, np.ones((7, 7), np.uint8)) > 0)
    light = (L[..., 0] > 72) & (chroma < 22)
    sample = edge & light
    bg = None
    if sample.sum() >= 12:
        bg = np.median(L[sample], axis=0)
        de = np.sqrt(((L - bg) ** 2).sum(2))
        paper = (opaque == 1) & (de < 13) & (texture < 7)
        for _ in range(4):
            outside = cv2.dilate((a <= 20).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
            n, lbl = cv2.connectedComponents(paper.astype(np.uint8), 8)
            touch = np.unique(lbl[outside & paper])
            touch = touch[touch > 0]
            if not len(touch):
                break
            gone = np.isin(lbl, touch)
            a[gone] = 0
            paper &= ~gone
    # Specks left on their own.
    solid = (a > 128).astype(np.uint8)
    n, lbl, st, _ = cv2.connectedComponentsWithStats(solid, 8)
    if n > 2:
        big = st[1:, cv2.CC_STAT_AREA].max()
        for i in range(1, n):
            if st[i, cv2.CC_STAT_AREA] < 0.01 * big:
                a[lbl == i] = 0
    px[..., 3] = a
    # Light rim: clear it, then colour the remaining edge from just inside.
    for _ in range(2):
        bad, band = halo_mask(px)
        if bad is None or not bad.any():
            break
        px[..., 3][bad] = 0
    a = px[..., 3]
    solid = (a > 200).astype(np.uint8)
    core = cv2.erode(solid, np.ones((3, 3), np.uint8))
    if core.sum() > 20:
        _, labels = cv2.distanceTransformWithLabels(1 - core, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
        zy, zx = np.nonzero(core)
        near = np.stack([zy, zx], 1)[labels - 1]
        rim = (a > 0) & (core == 0) & (cv2.dilate(core, np.ones((5, 5), np.uint8)) > 0)
        px[..., :3][rim] = px[near[..., 0], near[..., 1], :3][rim]
    paper_left = 0.0
    # Only for colourful letters (flowers, food) or coloured paper: grey metal on white paper looks
    # like shadowed paper and must not count.
    colourful = np.median(chroma[px[..., 3] > 128]) > 15 if (px[..., 3] > 128).any() else False
    if bg is not None and (colourful or np.hypot(bg[1], bg[2]) > 4):
        # Paper still in the letter, in light or in shadow: the background's hue, low chroma, flat.
        a = px[..., 3]
        de_ab = np.hypot(L[..., 1] - bg[1], L[..., 2] - bg[2])
        like = (a > 128) & (de_ab < 8) & (chroma < 20) & (L[..., 0] > 40) & (L[..., 0] < bg[0] + 4) & (texture < 7)
        paper_left = like.sum() / max(1, (a > 128).sum())
    out = Image.fromarray(np.clip(px, 0, 255).astype(np.uint8), 'RGBA')
    bb = out.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    return (out.crop(bb) if bb else out), paper_left


def main():
    manifest = json.load(open(os.path.join(REPO, 'manifest.json')))
    # --only <source> ...: check just these sources again; every other letter keeps its verdict.
    only = set(sys.argv[sys.argv.index('--only') + 1:]) if '--only' in sys.argv else None
    excluded, cleaned, kept = [], 0, 0
    if only:
        old = json.load(open(os.path.join(OUT, 'excluded.json')))
        mine = {e['file'] for e in manifest if e['source'] in only}
        excluded = [f for f in old if f not in mine]
    for e in manifest:
        if e.get('set_aside') or e['category'] not in CATEGORIES or not (e['char'].isascii() and e['char'].isalpha()):
            continue
        if only and e['source'] not in only:
            continue
        out = os.path.join(OUT, e['file'][:-4] + '.webp')
        if e['file'] in AS_IS or e['source'] in TRUSTED:
            # Checked by eye, or re-cut carefully: used as it is.
            if os.path.exists(out):
                os.remove(out)
            if e['file'] in LEAVE_OUT:
                excluded.append(e['file'])
            kept += 1
            continue
        up = os.path.join(REPO, '_upscaled', e['file'][:-4] + '.webp')
        src = Image.open(up if os.path.exists(up) else os.path.join(REPO, e['file'])).convert('RGBA')
        before = score(np.asarray(src).astype(np.float32))
        if before < NEEDS:
            if os.path.exists(out):
                os.remove(out)
            kept += 1
            continue
        done, paper = clean(src)
        after = score(np.asarray(done).astype(np.float32))
        area = lambda im: (np.asarray(im)[..., 3] > 128).sum()
        lost = 1 - area(done) / max(1, area(src))
        os.makedirs(os.path.dirname(out), exist_ok=True)
        done.save(out, 'WEBP', quality=92, alpha_quality=100, method=6)
        cleaned += 1
        bad = after > KEEP or lost > LOST or paper > PAPER
        if bad:
            excluded.append(e['file'])
        print(f'{e["file"]}: halo {before:.2f} -> {after:.2f}, lost {lost:.2f}, paper {paper:.2f}{"  (left out)" if bad else ""}', flush=True)
    os.makedirs(OUT, exist_ok=True)
    json.dump(sorted(excluded), open(os.path.join(OUT, 'excluded.json'), 'w'), indent=1)
    print(f'{kept} clean already, {cleaned} cleaned, {len(excluded)} still haloed and left out')


if __name__ == '__main__':
    main()
