# Sharpens the repository's small cut-outs with Real-ESRGAN (4x, general photo model), so letters
# stay crisp in the font (pictures up to 256 px per em) and on screen.
#
#   python3 -m venv .venv-sr && .venv-sr/bin/pip install realesrgan-ncnn-py   (needs libomp5)
#   .venv-sr/bin/python -I scripts/upscale-repository.py [--limit N]
#
# For every cut-out the app uses (the five categories, letters A-Z) shorter than MIN_H, writes
# alphabet-repository/_upscaled/<same path>.webp; npm run library then uses it instead of the
# original. Originals are never changed. Already-done pictures are skipped, so it can be stopped and
# run again.
#
# Colour goes through the model; see-through pixels first take the colour of the nearest opaque
# pixel, so the model sees no false edge (no dark or white fringe). The outline (alpha) is enlarged
# smoothly and then tightened, which keeps edges crisp without the model inventing specks.
import json, os, sys, time
import numpy as np, cv2
from PIL import Image
from realesrgan_ncnn_py import Realesrgan

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
REPO = os.path.join(ROOT, 'alphabet-repository')
OUT = os.path.join(REPO, '_upscaled')
CATEGORIES = {'stationery', 'tools', 'produce', 'food', 'plants'}
MIN_H = 300      # taller cut-outs are sharp enough already
MAX_H = 480      # upscaled pictures are kept at most this tall
PAD = 8

model = Realesrgan(gpuid=-1, model=4)  # realesrgan-x4plus on the CPU


def fill_clear(rgb, alpha):
    """See-through pixels take the colour of the nearest opaque pixel."""
    solid = (alpha >= 128).astype(np.uint8)
    if not solid.any() or solid.all():
        return rgb
    _, labels = cv2.distanceTransformWithLabels(1 - solid, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    zy, zx = np.nonzero(solid)
    nearest = np.stack([zy, zx], 1)[labels - 1]
    return np.where(solid[..., None] == 1, rgb, rgb[nearest[..., 0], nearest[..., 1]])


def upscale(img):
    a = np.asarray(img.convert('RGBA'))
    rgb, alpha = fill_clear(a[..., :3].copy(), a[..., 3]), a[..., 3]
    rgb = cv2.copyMakeBorder(rgb, PAD, PAD, PAD, PAD, cv2.BORDER_REPLICATE)
    big = np.asarray(model.process_pil(Image.fromarray(rgb)))[4 * PAD:-4 * PAD, 4 * PAD:-4 * PAD]
    h, w = big.shape[:2]
    # Smooth enlargement, then a steep curve around the middle: crisp, anti-aliased edges.
    al = cv2.resize(alpha, (w, h), interpolation=cv2.INTER_CUBIC).astype(np.float32) / 255
    al = np.clip((al - 0.5) * 3 + 0.5, 0, 1)
    out = Image.fromarray(np.dstack([big, (al * 255).astype(np.uint8)]), 'RGBA')
    if out.height > MAX_H:
        out = out.resize((max(1, round(out.width * MAX_H / out.height)), MAX_H), Image.LANCZOS)
    return out


def main():
    limit = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else None
    manifest = json.load(open(os.path.join(REPO, 'manifest.json')))
    todo = []
    for e in manifest:
        if e.get('set_aside') or e['category'] not in CATEGORIES or not (e['char'].isascii() and e['char'].isalpha()):
            continue
        out = os.path.join(OUT, e['file'][:-4] + '.webp')
        if os.path.exists(out):
            continue
        with Image.open(os.path.join(REPO, e['file'])) as im:
            if im.height >= MIN_H:
                continue
        todo.append((e['file'], out))
    todo = todo[:limit] if limit else todo
    t0 = time.time()
    for i, (f, out) in enumerate(todo, 1):
        up = upscale(Image.open(os.path.join(REPO, f)))
        os.makedirs(os.path.dirname(out), exist_ok=True)
        up.save(out + '.tmp', 'WEBP', quality=90, method=6, exact=False)
        os.replace(out + '.tmp', out)
        left = (time.time() - t0) / i * (len(todo) - i)
        print(f'{i}/{len(todo)} {f} -> {up.size[0]}x{up.size[1]}  ~{left / 60:.0f} min left', flush=True)


if __name__ == '__main__':
    main()
