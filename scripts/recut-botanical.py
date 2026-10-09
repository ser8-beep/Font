# Cuts the letters out of the 20 botanical lettering photos again, more carefully than the first cut:
#
#   <python with numpy, opencv, pillow> -I scripts/recut-botanical.py [set ...]
#
# data/botanical-photos/ holds the photos and letters.json, each letter's box in its photo. The cut is
# made on the photo sharpened 4x (data/botanical-photos/_4x/, Real-ESRGAN x4plus; made once and not
# kept in git), or on the photo itself when there is none. The paper is modelled per pixel (it has
# shadows, vignettes and coloured paper), so a flower is whatever stands out from the paper right
# around it: colour counts fully; being darker counts fully at a crisp edge (a stem) and little in
# smooth shading (a shadow); being lighter counts some. GrabCut then settles the doubtful edge pixels
# by colour, the pieces mostly inside the letter's box are kept, and the edges get a little soft alpha
# with the paper colour taken back out of them (no light or dark rim). Each letter replaces its
# cut-out in alphabet-repository (same file, at the photo's own size, so its quality is judged
# honestly); letters under 300 px also get the sharp cut as their sharpened copy (_upscaled/), and
# their cleaned copy is removed. Only the sets named, or all.
import json, os, sys
import numpy as np, cv2
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
PHOTOS = os.path.join(ROOT, 'data', 'botanical-photos')
REPO = os.path.join(ROOT, 'alphabet-repository')
# Photos sharpened 4x with Real-ESRGAN (x4plus), named like the originals (.jpg); made once, not kept in git.
SHARP = os.path.join(PHOTOS, '_4x')
# Sharp copies are made for letters under this height (like scripts/upscale-repository.py), at most SHARP_MAX tall.
SHARP_UNDER, SHARP_MAX = 300, 480


def paper(lab, t):
    """The paper's colour at every pixel: a wide median, then again with the flowers painted out."""
    h, w = lab.shape[:2]
    k = max(15, (min(h, w) // 6) | 1)
    small = cv2.resize(lab, (w // 2, h // 2), interpolation=cv2.INTER_AREA)
    bg = cv2.resize(cv2.medianBlur(np.clip(small * [2.55, 1, 1] + [0, 128, 128], 0, 255).astype(np.uint8), min(255, k // 2 | 1)), (w, h)).astype(np.float32)
    bg = (bg - [0, 128, 128]) / [2.55, 1, 1]
    for _ in range(2):
        fg = (distance(lab, bg) > t * 0.7).astype(np.uint8)
        fg = cv2.dilate(fg, np.ones((9, 9), np.uint8))
        u8 = np.clip(bg * [2.55, 1, 1] + [0, 128, 128], 0, 255).astype(np.uint8)
        src = np.clip(lab * [2.55, 1, 1] + [0, 128, 128], 0, 255).astype(np.uint8)
        src[fg > 0] = u8[fg > 0]
        filled = cv2.inpaint(cv2.resize(src, (w // 2, h // 2)), cv2.resize(fg, (w // 2, h // 2)), 7, cv2.INPAINT_TELEA)
        bg = (cv2.resize(cv2.GaussianBlur(filled, (0, 0), 6), (w, h)).astype(np.float32) - [0, 128, 128]) / [2.55, 1, 1]
    return bg


def crispness(lab):
    """0..1: how close a pixel is to a crisp edge (stems and petals have them; soft shadows don't)."""
    L = cv2.GaussianBlur(lab[..., 0], (0, 0), 0.8)
    g = np.hypot(cv2.Sobel(L, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(L, cv2.CV_32F, 0, 1, ksize=3))
    return np.clip(cv2.dilate(g, np.ones((3, 3), np.uint8)) / 40, 0, 1)


def distance(lab, bg, crisp=None):
    dL = lab[..., 0] - bg[..., 0]
    # Darker than the paper counts fully at a crisp edge (a stem), little in smooth shading (a shadow).
    # Lighter counts some (white petals on grey paper).
    dark = 0.3 if crisp is None else 0.3 + 0.7 * crisp
    dL = np.where(dL < 0, dark * dL, 0.6 * dL)
    return np.sqrt(dL ** 2 + (lab[..., 1] - bg[..., 1]) ** 2 + (lab[..., 2] - bg[..., 2]) ** 2)


def cut(img, bg, d, rects, t, k):
    H, W = d.shape
    x0, y0 = min(r[0] for r in rects), min(r[1] for r in rects)
    x1, y1 = max(r[2] for r in rects), max(r[3] for r in rects)
    m = max(10 * k, int(0.12 * max(x1 - x0, y1 - y0)))
    X0, Y0, X1, Y1 = max(0, x0 - m), max(0, y0 - m), min(W, x1 + m), min(H, y1 + m)
    D = d[Y0:Y1, X0:X1]
    inside = np.zeros(D.shape, bool)
    for rx0, ry0, rx1, ry1 in rects:
        inside[max(0, ry0 - Y0):ry1 - Y0, max(0, rx0 - X0):rx1 - X0] = True
    # GrabCut: sure plant where it stands out a lot, sure paper where it hardly differs or lies outside the box.
    gc = np.full(D.shape, cv2.GC_PR_BGD, np.uint8)
    gc[D > t] = cv2.GC_PR_FGD
    gc[(D > 1.6 * t) & inside] = cv2.GC_FGD
    gc[D < 0.35 * t] = cv2.GC_BGD
    gc[~cv2.dilate(inside.astype(np.uint8), np.ones((8 * k + 1, 8 * k + 1), np.uint8)).astype(bool)] = cv2.GC_BGD
    crop = np.ascontiguousarray(img[Y0:Y1, X0:X1].astype(np.uint8))
    if (gc == cv2.GC_FGD).any() and (gc == cv2.GC_BGD).any():
        bgm, fgm = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
        cv2.grabCut(crop, gc, None, bgm, fgm, 4, cv2.GC_INIT_WITH_MASK)
    mask = np.isin(gc, (cv2.GC_FGD, cv2.GC_PR_FGD)).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((min(3, 2 * k), min(3, 2 * k)), np.uint8))
    # Keep the pieces that lie mostly inside the letter's box, and not specks.
    n, lbl, st, _ = cv2.connectedComponentsWithStats(mask, 8)
    keep = np.zeros(mask.shape, bool)
    minarea = max(5 * k * k, 0.0006 * (x1 - x0) * (y1 - y0))
    for i in range(1, n):
        comp = lbl == i
        if st[i, cv2.CC_STAT_AREA] >= minarea and (comp & inside).sum() >= 0.6 * st[i, cv2.CC_STAT_AREA]:
            keep |= comp
    if not keep.any():
        return None
    # Soft edge: a little feather, and paper colour taken back out of the edge pixels.
    a = cv2.GaussianBlur(keep.astype(np.float32), (0, 0), 0.8 * (1 + (k - 1) / 2))
    a = np.where(keep, np.maximum(a, 0.85), a * (D > 0.5 * t))
    a = np.clip(a, 0, 1)
    paperrgb = cv2.cvtColor(np.ascontiguousarray(bg[Y0:Y1, X0:X1]).astype(np.float32), cv2.COLOR_Lab2RGB) * 255
    rgb = crop.astype(np.float32)
    col = np.clip((rgb - (1 - a[..., None]) * paperrgb) / np.maximum(a, 1e-3)[..., None], 0, 255)
    ys, xs = np.nonzero(a > 0.04)
    out = np.dstack([col, a * 255])[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    return Image.fromarray(out.astype(np.uint8), 'RGBA')


def main():
    only = set(sys.argv[1:])
    spec = json.load(open(os.path.join(PHOTOS, 'letters.json')))
    manifest = json.load(open(os.path.join(REPO, 'manifest.json')))
    by_name = {os.path.basename(e['file']): e['file'] for e in manifest}
    done = missing = 0
    for f, s in spec.items():
        if only and s['set'] not in only:
            continue
        orig = np.asarray(Image.open(os.path.join(PHOTOS, f)).convert('RGB')).astype(np.float32)
        h, w = orig.shape[:2]
        sharp_path = os.path.join(SHARP, os.path.splitext(f)[0] + '.jpg')
        img = np.asarray(Image.open(sharp_path).convert('RGB')).astype(np.float32) if os.path.exists(sharp_path) else orig
        k = round(img.shape[1] / w)
        H, W = img.shape[:2]
        lab = cv2.cvtColor(img / 255, cv2.COLOR_RGB2Lab)
        t = s.get('t', 14)
        # The paper and the crisp edges are found at the photo's own scale (where these measures are
        # tuned) from the sharp photo's tones, then enlarged to it.
        small = cv2.resize(lab, (w, h), interpolation=cv2.INTER_AREA) if k > 1 else lab
        bg = paper(small, t)
        crisp = crispness(small)
        if k > 1:
            bg = cv2.resize(bg, (W, H), interpolation=cv2.INTER_LINEAR)
            crisp = cv2.resize(crisp, (W, H), interpolation=cv2.INTER_LINEAR)
        d = distance(lab, bg, crisp)
        counts = {}
        for ch, case, *nums in s['letters']:
            rects = [[v * k for v in nums[i:i + 4]] for i in range(0, len(nums), 4)]
            key = f'{ch}_{case}'
            counts[key] = counts.get(key, 0) + 1
            name = f"p4-{s['set']}_{'N-tilde' if ch == 'Ñ' else ch}_{case}{'' if counts[key] == 1 else '_' + str(counts[key])}.png"
            rel = by_name.get(name)
            if not rel:
                missing += 1
                continue
            piece = cut(img, bg, d, rects, t, k)
            if piece is None:
                print(f'{f} {ch}: nothing found')
                continue
            native = piece.resize((max(1, round(piece.width / k)), max(1, round(piece.height / k))), Image.LANCZOS) if k > 1 else piece
            native.save(os.path.join(REPO, rel), optimize=True)
            for extra in ('_upscaled', '_clean'):
                p = os.path.join(REPO, extra, rel[:-4] + '.webp')
                if os.path.exists(p):
                    os.remove(p)
            if k > 1 and native.height < SHARP_UNDER:
                copy = piece if piece.height <= SHARP_MAX else piece.resize((round(piece.width * SHARP_MAX / piece.height), SHARP_MAX), Image.LANCZOS)
                p = os.path.join(REPO, '_upscaled', rel[:-4] + '.webp')
                os.makedirs(os.path.dirname(p), exist_ok=True)
                copy.save(p, 'WEBP', quality=92, alpha_quality=100, method=6)
            done += 1
        print(f, s['set'], f'(x{k})', flush=True)
    print(f'{done} letters cut again ({missing} not in the repository)')


if __name__ == '__main__':
    main()
