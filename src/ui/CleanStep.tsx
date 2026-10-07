import { useEffect, useRef } from 'react';
import type { Box, RGBAImage } from '../core/image';
import { letterGlyph, type LetterGlyph } from '../font';
import type { Letter, Photo } from '../state';
import { letterColour } from './SplitStep';
import { GlyphView, TextRender } from './TextRender';

interface Props {
  photos: Photo[];
  currentPhotoId: string | null;
  letters: Letter[];
  map: Map<string, LetterGlyph>;
  /** record=true saves an undo point first. */
  onChange: (letters: Letter[], record: boolean) => void;
}

export function CleanStep({ photos, currentPhotoId, letters, map, onChange }: Props) {
  // Letters from the newest photo first, then earlier ones.
  const named = letters.filter((l) => l.char).sort((a, b) => Number(b.photoId === currentPhotoId) - Number(a.photoId === currentPhotoId));
  const update = (id: string, patch: Partial<Letter>, record: boolean) => onChange(letters.map((l) => (l.id === id ? { ...l, ...patch } : l)), record);

  return (
    <>
      <h1>
        <span className="tag">Make them neat</span>
      </h1>
      <p>Slide to make each letter bolder or thinner until it looks like yours.</p>

      <div className="letters-grid">
        {named.map((l) => {
          const photo = photos.find((p) => p.id === l.photoId)!;
          const g = letterGlyph(l, photo);
          return (
            <div key={l.id} className="card letter-card">
              <h2>
                <span className="badge" style={{ background: letterColour(l.char!) }}>{l.char}</span>
              </h2>
              <div className="before-after">
                <figure>
                  <div className="pane">{g && g.picture.kind === 'photo' && <Crop image={photo.image} box={g.picture.clean.box} />}</div>
                  <figcaption>Your photo</figcaption>
                </figure>
                <figure>
                  <div className="pane">
                    <GlyphView glyph={g} size={180} />
                  </div>
                  <figcaption>Your letter</figcaption>
                </figure>
              </div>
              <div className="slider-row">
                <span>Thinner</span>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.05}
                  value={l.bolder}
                  aria-label={`Make ${l.char} bolder`}
                  onPointerDown={() => update(l.id, {}, true)}
                  onKeyDown={() => update(l.id, {}, true)}
                  onChange={(e) => update(l.id, { bolder: Number(e.target.value) }, false)}
                />
                <span>Bolder</span>
              </div>
              <label className="toggle">
                <input type="checkbox" checked={l.fillHoles} onChange={(e) => update(l.id, { fillHoles: e.target.checked }, true)} />
                Fill the gaps (beans, pasta, buttons)
              </label>
            </div>
          );
        })}
      </div>
      {named.length === 0 && <p className="card">No letters yet. Go back and draw a box around a letter.</p>}

      <div className="strip card">
        <strong>Your letters so far</strong>
        <TextRender text={[...new Set(letters.map((l) => l.char).filter((c) => c && map.has(c)))].join('')} map={map} />
      </div>
    </>
  );
}

function Crop({ image, box }: { image: RGBAImage; box: Box }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = box.w;
    c.height = box.h;
    const ctx = c.getContext('2d')!;
    const d = ctx.createImageData(box.w, box.h);
    for (let y = 0; y < box.h; y++) {
      const s = ((y + box.y) * image.width + box.x) * 4;
      d.data.set(image.data.subarray(s, s + box.w * 4), y * box.w * 4);
    }
    ctx.putImageData(d, 0, 0);
  }, [image, box.x, box.y, box.w, box.h]);
  return <canvas ref={ref} />;
}
