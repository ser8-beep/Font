import type { RGBAImage } from './core/image';
import { analyse } from './core/segment';
import type { Letter, Photo } from './state';
import { uid } from './state';

/** Long side of the image we keep for letter clean-up and material mode. */
const MAX_SIDE = 1400;

async function decode(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export async function blobToImage(blob: Blob): Promise<{ image: RGBAImage; url: string }> {
  const bmp = await decode(blob);
  const w0 = 'naturalWidth' in bmp ? bmp.naturalWidth : bmp.width;
  const h0 = 'naturalHeight' in bmp ? bmp.naturalHeight : bmp.height;
  const s = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  const w = Math.round(w0 * s), h = Math.round(h0 * s);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  if ('close' in bmp) bmp.close();
  const data = ctx.getImageData(0, 0, w, h);
  const url = await new Promise<string>((res) => canvas.toBlob((b) => res(URL.createObjectURL(b!)), 'image/jpeg', 0.85));
  return { image: { width: w, height: h, data: data.data }, url };
}

/** Wait a frame so the "finding your letters" animation gets painted first. */
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));

export async function processPhoto(blob: Blob, word: string): Promise<{ photo: Photo; letters: Letter[] }> {
  const { image, url } = await blobToImage(blob);
  await nextFrame();
  const analysis = analyse(image, { expected: Math.max(1, word.length) });
  const photo: Photo = { id: uid(), image, url, analysis, word };
  const letter = (region: Letter['region'], char: string | null, porous = false): Letter => ({ id: uid(), photoId: photo.id, char, region, rev: 0, bolder: 0, fillHoles: porous });
  if ([...word].length === 1) {
    // A photo taken for one letter needs no matching: its biggest shape is that letter (the whole
    // photo when nothing stands out), and smaller bits are left out.
    const biggest = analysis.blobs.reduce<(typeof analysis.blobs)[number] | null>((best, b) => (!best || b.box.w * b.box.h > best.box.w * best.box.h ? b : best), null);
    const { width, height } = analysis.work;
    return { photo, letters: [biggest ? letter({ box: biggest.box, region: biggest.region }, word, biggest.porous) : letter({ box: { x: 0, y: 0, w: width, h: height } }, word)] };
  }
  // Every shape found is only marked; the kid says which letter each one is.
  return { photo, letters: analysis.blobs.map((b) => letter({ box: b.box, region: b.region }, null, b.porous)) };
}
