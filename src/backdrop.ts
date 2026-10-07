import type { Photo, Size } from './state';

const tableCache = new WeakMap<Photo, string>();

/** The colour of the table or paper in the photo: the median of the photo's border pixels. */
export function tableColour(photo: Photo | null): string {
  if (!photo) return '#f2eee6';
  const hit = tableCache.get(photo);
  if (hit) return hit;
  const { width: w, height: h, data } = photo.analysis.work;
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      if (x >= band && y >= band && x < w - band && y < h - band) continue;
      const i = (y * w + x) * 4;
      rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
    }
  }
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1] ?? 240;
  const c = `rgb(${med(rs)}, ${med(gs)}, ${med(bs)})`;
  tableCache.set(photo, c);
  return c;
}

/** Line length (font units) before the text wraps: small letters fit more on a line. */
export const WRAP: Record<Size, number> = { S: 9000, M: 6000, L: 3600 };
