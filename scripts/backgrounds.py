# Builds the playground's picture backgrounds (posters and birthday invitations) from
# data/backgrounds.json and the originals in data/backgrounds/<id>.jpg:
#
#   <python with realesrgan-ncnn-py, numpy, opencv, pillow> -I scripts/backgrounds.py [--force]
#
# For each picture:
#   - src/backgrounds/<id>.webp: twice the size (four times for small ones), sharpened with Real-ESRGAN (realesr-animevideov3 x2,
#     which suits drawings and paper textures), so invitations print crisply. Kept once made (--force
#     makes them again), so only new pictures need the model.
#   - src/backgrounds/thumbs/<id>.webp: a small copy for the picker.
#   - where the words go (safe: [x, y, w, h] as shares of the picture): from the catalogue when given,
#     else the biggest calm area (flat, the colour of the middle of the picture), else the middle.
#   - the text colour that reads best on that area (ink, or white on dark pictures).
# Then src/backgrounds/manifest.json lists them all for the app.
import json, os, sys
import numpy as np, cv2
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'data', 'backgrounds')
OUT = os.path.join(ROOT, 'src', 'backgrounds')
THUMB_W = 150
INK, WHITE = '#1b1b3a', '#ffffff'


def biggest_rect(mask):
    """Largest all-true rectangle in a boolean grid: (x, y, w, h)."""
    h, w = mask.shape
    heights = np.zeros(w, int)
    best = (0, 0, 0, 0, 0)
    for y in range(h):
        heights = np.where(mask[y], heights + 1, 0)
        stack = []
        for x in range(w + 1):
            cur = heights[x] if x < w else 0
            start = x
            while stack and stack[-1][1] >= cur:
                sx, sh = stack.pop()
                area = sh * (x - sx)
                if area > best[0]:
                    best = (area, sx, y - sh + 1, x - sx, sh)
                start = sx
            stack.append((start, cur))
    return best[1:]


def calm_area(img):
    """Where words can go: the biggest flat area the colour of the picture's middle, or the middle."""
    small = img.convert('RGB').resize((120, round(120 * img.height / img.width)), Image.BILINEAR)
    px = np.asarray(small).astype(np.float32) / 255
    lab = cv2.cvtColor(px, cv2.COLOR_RGB2Lab)
    h, w = lab.shape[:2]
    L = lab[..., 0]
    mean = cv2.blur(L, (5, 5))
    busy = np.sqrt(np.maximum(cv2.blur(L * L, (5, 5)) - mean * mean, 0))
    mid = lab[int(h * 0.4):int(h * 0.6), int(w * 0.35):int(w * 0.65)].reshape(-1, 3)
    ref = np.median(mid, axis=0)
    near = np.sqrt(((lab - ref) ** 2).sum(2)) < 14
    mask = (busy < 4.5) & near
    mask = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)).astype(bool)
    x, y, bw, bh = biggest_rect(mask)
    if bw * bh >= 0.18 * w * h and bw >= 0.45 * w:
        m = 0.03
        return [round(x / w + m, 3), round(y / h + m, 3), round(bw / w - 2 * m, 3), round(bh / h - 2 * m, 3)]
    return [0.12, 0.17, 0.76, 0.66]


def ink_for(img, safe):
    W, H = img.size
    x, y, w, h = safe
    area = np.asarray(img.convert('L').crop((int(x * W), int(y * H), int((x + w) * W), int((y + h) * H)))).astype(np.float32)
    return WHITE if np.median(area) < 125 else INK


def main():
    force = '--force' in sys.argv
    cat = json.load(open(os.path.join(ROOT, 'data', 'backgrounds.json')))['pictures']
    os.makedirs(os.path.join(OUT, 'thumbs'), exist_ok=True)
    model = None
    out = []
    for p in cat:
        orig = Image.open(os.path.join(SRC, p['id'] + '.jpg')).convert('RGB')
        big_path = os.path.join(OUT, p['id'] + '.webp')
        if force or not os.path.exists(big_path):
            if model is None:
                from realesrgan_ncnn_py import Realesrgan
                model = Realesrgan(gpuid=-1, model=0)  # realesr-animevideov3, x2
            # Twice the size; small pictures (under 600 px across) twice over, so they print as well.
            big = orig
            for _ in range(2 if orig.width < 600 else 1):
                want = (big.width * 2, big.height * 2)
                big = model.process_pil(big)
                if big.size != want:
                    big = big.resize(want, Image.LANCZOS)
            big.save(big_path, 'WEBP', quality=84, method=6)
            print(p['id'], big.size, flush=True)
        big = Image.open(big_path)
        thumb = orig.resize((THUMB_W, round(THUMB_W * orig.height / orig.width)), Image.LANCZOS)
        thumb.save(os.path.join(OUT, 'thumbs', p['id'] + '.webp'), 'WEBP', quality=72, method=6)
        safe = p.get('safe') or calm_area(orig)
        out.append({'id': p['id'], 'label': p['label'], 'groups': p['groups'], 'w': big.width, 'h': big.height, 'safe': safe, 'ink': p.get('ink') or ink_for(orig, safe)})
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(out, f, indent=1)
        f.write('\n')
    print(f'{len(out)} backgrounds')


if __name__ == '__main__':
    main()
