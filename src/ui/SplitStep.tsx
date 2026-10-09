import { useRef, useState } from 'react';
import type { Box } from '../core/image';
import { inWordOrder, uid, WORD, type Letter, type Photo } from '../state';

export const COLOURS = ['#f0b819', '#eb362d', '#80b6e4', '#23b56e'];
export const colourFor = (i: number) => COLOURS[i % COLOURS.length];
/** Each letter keeps one colour everywhere: P L A Y in their word order, the rest by letter. */
export function letterColour(ch: string): string {
  const up = ch.toUpperCase();
  const i = WORD.indexOf(up);
  return colourFor(i >= 0 ? i : up.charCodeAt(0));
}
const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

interface Props {
  photo: Photo;
  letters: Letter[];
  onChange: (letters: Letter[]) => void;
  /** Every photo and letter, for switching between photos when letters came one at a time. */
  photos: Photo[];
  allLetters: Letter[];
  onShow: (photoId: string) => void;
}

interface Drag {
  char: string;
  from: string | null;
  x: number;
  y: number;
  sx: number;
  sy: number;
  moved: boolean;
}

/** Letters of the word that are not yet on any blob (a multiset; a small p counts for P). */
function trayChars(word: string, letters: Letter[]): string[] {
  const left = [...word];
  for (const l of letters) {
    const i = l.char ? left.findIndex((c) => same(c, l.char!)) : -1;
    if (i >= 0) left.splice(i, 1);
  }
  return left;
}

export function SplitStep({ photo, letters, onChange, photos, allLetters, onShow }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<Box | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [picker, setPicker] = useState<string | null>(null);
  // The click that ends drawing a box must not also open the letter picker.
  const justDrew = useRef(false);
  const { width: W, height: H } = photo.analysis.work;
  const tray = trayChars(photo.word, letters);
  // The picker offers the photo's letters as capitals and as small letters.
  const choices = [...new Set([...photo.word].map((c) => c.toUpperCase()))];

  const toWork = (cx: number, cy: number) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: ((cx - r.left) / r.width) * W, y: ((cy - r.top) / r.height) * H };
  };
  const hit = (cx: number, cy: number): Letter | undefined => {
    const p = toWork(cx, cy);
    // Smallest box under the pointer wins (a drawn box inside a big blob).
    return letters
      .filter((l) => p.x >= l.region.box.x && p.x <= l.region.box.x + l.region.box.w && p.y >= l.region.box.y && p.y <= l.region.box.y + l.region.box.h)
      .sort((a, b) => a.region.box.w * a.region.box.h - b.region.box.w * b.region.box.h)[0];
  };

  const assign = (target: Letter, char: string, from: string | null) => {
    const next = letters.map((l) => {
      if (l.id === target.id) return { ...l, char };
      // Swap: the blob the chip came from takes the target's old letter.
      if (from && l.id === from) return { ...l, char: target.char };
      // Picking from the picker: a blob already holding this char gives it up.
      if (!from && l.char && same(l.char, char) && target.char !== char && letters.filter((o) => o.char && same(o.char, char)).length >= [...photo.word].filter((c) => same(c, char)).length) return { ...l, char: target.char };
      return l;
    });
    onChange(next);
  };

  const remove = (id: string) => onChange(letters.filter((l) => l.id !== id));

  // ---- chip dragging ----
  const startDrag = (e: React.PointerEvent, char: string, from: string | null) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ char, from, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false });
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    const moved = drag.moved || Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 8;
    setDrag({ ...drag, x: e.clientX, y: e.clientY, moved });
  };
  const endDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (!d.moved) {
      if (d.from) setPicker(d.from);
      return;
    }
    const target = hit(e.clientX, e.clientY);
    if (target && target.id !== d.from) assign(target, d.char, d.from);
    else if (!target && d.from) onChange(letters.map((l) => (l.id === d.from ? { ...l, char: null } : l)));
  };

  // ---- drawing a box ----
  const startDraw = (e: React.PointerEvent) => {
    if (!drawing) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = toWork(e.clientX, e.clientY);
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
  };
  const moveDraw = (e: React.PointerEvent) => {
    if (!draft) return;
    const p = toWork(e.clientX, e.clientY);
    setDraft({ ...draft, w: p.x - draft.x, h: p.y - draft.y });
  };
  const endDraw = () => {
    if (!draft) return;
    const b = norm(draft, W, H);
    justDrew.current = true;
    setTimeout(() => (justDrew.current = false), 50);
    setDraft(null);
    setDrawing(false);
    if (b.w < 8 || b.h < 8) return;
    const letter: Letter = { id: uid(), photoId: photo.id, char: null, region: { box: b }, rev: 0, bolder: 0, fillHoles: false };
    onChange([...letters, letter]);
  };

  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const pickerLetter = letters.find((l) => l.id === picker);

  return (
    <>
      <h1>
        <span className="tag">Match your letters</span>
      </h1>
      {[...photo.word].length > 1 ? (
        <p>
          We marked every shape we found with a <strong>?</strong>. Drag each letter onto its shape, or tap a shape to choose its letter.
        </p>
      ) : (
        <p>
          Is this your <strong>{photo.word}</strong>? Tap it to choose a different letter, or press <strong>✕</strong> on anything that isn't part of it.
        </p>
      )}

      {photos.length > 1 && (
        <div className="photo-switch" role="tablist" aria-label="Your photos">
          {inWordOrder(photos).map((p) => {
            const mine = allLetters.filter((l) => l.photoId === p.id);
            const done = trayChars(p.word, mine).length === 0;
            return (
              <button key={p.id} role="tab" aria-selected={p.id === photo.id} className={p.id === photo.id ? 'on' : ''} onClick={() => onShow(p.id)}>
                <img src={p.url} alt="" />
                <span>{p.word}{done ? ' ✓' : ''}</span>
              </button>
            );
          })}
        </div>
      )}

      <div
        ref={stage}
        className={`stage ${drawing ? 'drawing' : ''}`}
        style={{ maxWidth: `calc(60vh * ${W / H})`, margin: '0 auto' }}
        onPointerDown={startDraw}
        onPointerMove={(e) => { moveDrag(e); moveDraw(e); }}
        onPointerUp={(e) => { endDrag(e); endDraw(); }}
      >
        <img src={photo.url} alt="Your photo" draggable={false} />
        <svg className="overlay" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {letters.map((l) => (
            <rect
              key={l.id}
              x={l.region.box.x}
              y={l.region.box.y}
              width={l.region.box.w}
              height={l.region.box.h}
              rx={6}
              fill={l.char ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.25)'}
              stroke={l.char ? letterColour(l.char) : 'white'}
              strokeWidth={Math.max(3, W / 160)}
              strokeDasharray={l.char ? undefined : '10 8'}
              style={{ cursor: drawing ? 'crosshair' : 'pointer' }}
              onClick={() => !drawing && !justDrew.current && setPicker(l.id)}
            />
          ))}
          {draft && <DraftRect b={norm(draft, W, H)} stroke={Math.max(3, W / 160)} />}
        </svg>
        {letters.map((l) => (
          <div key={l.id}>
            <div
              className={`chip ${l.char ? '' : 'unknown'} ${drag?.from === l.id && drag.moved ? 'dragging' : ''}`}
              style={{
                left: pct(l.region.box.x + l.region.box.w / 2, W),
                top: `max(34px, ${pct(l.region.box.y, H)})`,
                background: l.char ? letterColour(l.char) : 'white',
                visibility: drag?.from === l.id && drag.moved ? 'hidden' : 'visible',
              }}
              onPointerDown={(e) => !drawing && startDrag(e, l.char ?? '?', l.id)}
              aria-label={l.char ? `Letter ${l.char}` : 'Which letter is this? Tap to choose'}
            >
              {l.char ?? '?'}
            </div>
            <button
              className="x-btn"
              style={{ left: `min(calc(100% - 28px), ${pct(l.region.box.x + l.region.box.w, W)})`, top: `max(28px, ${pct(l.region.box.y + l.region.box.h, H)})` }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => remove(l.id)}
              aria-label="Not a letter, remove this box"
              title="Not a letter"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="tray">
        {tray.length > 0 ? (
          <>
            <strong>Letters to match:</strong>
            {tray.map((c, i) => (
              <div
                key={i}
                className="chip"
                style={{ background: letterColour(c), visibility: drag && !drag.from && drag.char === c && drag.moved ? 'hidden' : 'visible' }}
                onPointerDown={(e) => startDrag(e, c, null)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
              >
                {c}
              </div>
            ))}
            <span>Drag each one onto its shape. Missed a letter? Draw a box around it.</span>
          </>
        ) : (
          <strong>{photo.word.length > 1 ? `All ${photo.word.length} letters matched!` : 'Matched!'} 🎉</strong>
        )}
      </div>

      <div className="row">
        <button className={`btn big ${drawing ? 'on' : 'yellow'}`} onClick={() => setDrawing(!drawing)}>
          <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden>
            <rect x="4" y="6" width="28" height="24" rx="4" fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray="7 4" />
          </svg>
          {drawing ? 'Now drag over your letter…' : 'Draw a box around a letter'}
        </button>
      </div>

      {drag && drag.moved && (
        <div className="chip floating-chip" style={{ left: drag.x, top: drag.y, background: drag.char === '?' ? 'white' : letterColour(drag.char) }}>
          {drag.char}
        </div>
      )}

      {pickerLetter && (
        <div className="picker-backdrop" onClick={() => setPicker(null)}>
          <div className="picker" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: 0 }}>Which letter is this?</h2>
            <div className="letters">
              {choices.map((c) => (
                <button key={c} style={{ background: letterColour(c) }} onClick={() => { assign(pickerLetter, c, null); setPicker(null); }}>
                  {c}
                </button>
              ))}
            </div>
            <p style={{ margin: 0, fontWeight: 800 }}>Small letters:</p>
            <div className="letters">
              {choices.map((c) => c.toLowerCase()).map((c) => (
                <button key={c} style={{ background: letterColour(c) }} aria-label={`small ${c}`} onClick={() => { assign(pickerLetter, c, null); setPicker(null); }}>
                  {c}
                </button>
              ))}
            </div>
            <div className="row">
              <button className="btn red" onClick={() => { remove(pickerLetter.id); setPicker(null); }}>
                Not a letter
              </button>
              <button className="btn" onClick={() => setPicker(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function DraftRect({ b, stroke }: { b: Box; stroke: number }) {
  return <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="rgba(240,184,25,0.25)" stroke="#f0b819" strokeWidth={stroke} strokeDasharray="12 8" />;
}

function norm(b: Box, W: number, H: number): Box {
  const x = Math.max(0, Math.min(b.x, b.x + b.w));
  const y = Math.max(0, Math.min(b.y, b.y + b.h));
  return { x, y, w: Math.min(W - x, Math.abs(b.w)), h: Math.min(H - y, Math.abs(b.h)) };
}
