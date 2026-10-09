import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CATEGORY_LABELS } from '../core/alphabet/category';
import { backgroundById, backgroundGroups, loadBackground, thumbUrl } from '../backgrounds';
import {
  BOX_SIZES, DEFAULT_DETAILS, designReady, fitBoxSize, drawPatternSample, FRAME_IDS, FRAMES, frameOf, inkFor, PALETTE, PATTERNS, renderDesign, spotsFor,
  type Box, type Design, type Fill, type TextBox,
} from '../design';
import { BODY_FONT_IDS, BODY_FONTS, bodyFont } from '../fonts';
import type { LetterGlyph } from '../font';
import { uid, type Size } from '../state';
import { ColorPicker } from './ColorPicker';

interface Props {
  design: Design;
  onDesign: (patch: Partial<Design>) => void;
  text: string;
  map: Map<string, LetterGlyph>;
  size: Size;
  onSize: (s: Size) => void;
  /** The typeface's themes, main first: their pictures and patterns are offered (empty when not known yet). */
  themes: string[];
  /** The kid's table colour, as a swatch. */
  table: string;
  /** The big words' box (typed into here, or with the letter keyboard). */
  words: React.ReactNode;
}

const GRADIENTS: Fill[] = [
  { kind: 'gradient', type: 'linear', from: '#f0b819', to: '#eb362d', angle: 135 },
  { kind: 'gradient', type: 'linear', from: '#80b6e4', to: '#23b56e', angle: 160 },
  { kind: 'gradient', type: 'linear', from: '#23b56e', to: '#f0b819', angle: 180 },
  { kind: 'gradient', type: 'radial', from: '#fffaf0', to: '#80b6e4', angle: 0 },
  { kind: 'gradient', type: 'linear', from: '#1b1b3a', to: '#80b6e4', angle: 200 },
];

/** 'rgb(1, 2, 3)' or '#abc' -> '#aabbcc'. */
function asHex(c: string): string {
  const m = c.match(/rgb\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? '#' + m.slice(1).map((v) => Number(v).toString(16).padStart(2, '0')).join('') : c;
}

const Label = ({ children, id }: { children: React.ReactNode; id?: string }) => (
  <p className="section-label" id={id}>
    {children}
  </p>
);

const themeLabel = (key: string) => (CATEGORY_LABELS[key] ? `${CATEGORY_LABELS[key].emoji} ${CATEGORY_LABELS[key].label}` : key);
// Pantry Raid and Market Basket share their kitchen pictures.
const groupLabel = (key: string) =>
  key === 'party' ? '🎉 Birthday invitations' : key === 'food' || key === 'produce' ? `${themeLabel('food')} · ${themeLabel('produce')}` : themeLabel(key);

const PLACES = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => ({ col: col as 0 | 1 | 2, row: row as 0 | 1 | 2 })));
const PLACE_NAMES = ['Top left', 'Top', 'Top right', 'Left', 'Middle', 'Right', 'Bottom left', 'Bottom', 'Bottom right'];

/** The playground: a live poster or card to drag the words and text boxes on, and the controls beside it. */
export function PosterEditor(p: Props) {
  const d = p.design;
  const f = frameOf(d);
  const pic = d.fill.kind === 'picture' ? backgroundById(d.fill.id) : null;
  const swatches = [...PALETTE, asHex(p.table)];

  // The picture and the text fonts load in the background; draw again when they arrive.
  const [ready, setReady] = useState(0);
  useEffect(() => {
    let live = true;
    designReady(d).then(() => live && setReady((n) => n + 1));
    return () => {
      live = false;
    };
  }, [d.fill]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- preview size ----
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [avail, setAvail] = useState({ w: 800, h: 600 });
  useLayoutEffect(() => {
    const el = wrap.current!;
    const measure = () => setAvail({ w: el.clientWidth, h: Math.max(260, window.innerHeight * 0.7) });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  const viewW = Math.min(avail.w, (avail.h * f.w) / f.h);
  const viewH = (viewW * f.h) / f.w;
  const k = viewW / f.w; // view pixels per frame pixel

  // ---- drawing ----
  const [placed, setPlaced] = useState<{ text: Box; boxes: Record<string, Box> }>({ text: { x: 0, y: 0, w: 0, h: 0 }, boxes: {} });
  useEffect(() => {
    const c = canvas.current;
    if (!c || viewW < 2) return;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    c.width = Math.round(viewW * dpr);
    c.height = Math.round(viewH * dpr);
    setPlaced(renderDesign(c.getContext('2d')!, d, { text: p.text, map: p.map, size: p.size, scale: c.width / f.w }));
  }, [d, p.text, p.map, p.size, viewW, viewH, f.w, ready]);

  // ---- text boxes ----
  const [selected, setSelected] = useState<string | null>(null);
  const sel = d.boxes.find((b) => b.id === selected) ?? null;
  const setBox = (id: string, patch: Partial<TextBox>) => p.onDesign({ boxes: d.boxes.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  const addBox = (text = '', design = d) => {
    // The first box goes under the big words; more go in the middle, to be dragged where they belong.
    const spot = design.boxes.length ? spotsFor(design).box(1, 1) : spotsFor(design).below;
    const b: TextBox = { id: uid(), text, font: 'hand', size: text ? fitBoxSize(design, text, 'hand') : BOX_SIZES.normal, colour: null, ...spot };
    setSelected(b.id);
    return b;
  };
  const removeBox = (id: string) => {
    p.onDesign({ boxes: d.boxes.filter((b) => b.id !== id) });
    setSelected(null);
  };

  /** Follows one pointer until it lets go. */
  const follow = (e: React.PointerEvent, move: (ev: PointerEvent) => void) => {
    e.preventDefault();
    e.stopPropagation();
    const mv = (ev: PointerEvent) => move(ev);
    const done = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', done);
      window.removeEventListener('pointercancel', done);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', done);
    window.addEventListener('pointercancel', done);
  };
  const clamp = (v: number, lo = 0.03, hi = 0.97) => Math.min(hi, Math.max(lo, v));
  /** Pointer position as shares of the frame. */
  const inFrame = (ev: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height };
  };
  const moveWords = (e: React.PointerEvent) => {
    setSelected(null);
    const start = inFrame(e);
    const { textX, textY } = d;
    follow(e, (ev) => {
      const at = inFrame(ev);
      p.onDesign({ textX: clamp(textX + at.x - start.x), textY: clamp(textY + at.y - start.y) });
    });
  };
  const moveBox = (e: React.PointerEvent, b: TextBox) => {
    setSelected(b.id);
    const start = inFrame(e);
    follow(e, (ev) => {
      const at = inFrame(ev);
      setBox(b.id, { x: clamp(b.x + at.x - start.x, 0, 1), y: clamp(b.y + at.y - start.y) });
    });
  };

  // ---- background ----
  const fill = d.fill;
  const colour = fill.kind === 'solid' ? fill.colour : fill.kind === 'gradient' ? fill.from : '#f0b819';
  const groups = backgroundGroups(p.themes);
  const pickPicture = (id: string) => {
    loadBackground(id).catch(() => undefined);
    const next: Design = { ...d, fill: { kind: 'picture', id }, frame: 'picture' };
    // The words go to the top of the picture's calm middle. A party card with no text yet gets the
    // party's details to change.
    const words = spotsFor(next).words;
    const boxes = backgroundById(id)?.groups.includes('party') && !d.boxes.length ? [addBox(DEFAULT_DETAILS, { ...next, boxes: [] })] : d.boxes;
    p.onDesign({ fill: next.fill, frame: 'picture', textX: words.x, textY: words.y, boxes });
  };
  const leavePicture = (next: Fill) => p.onDesign({ fill: next, ...(d.frame === 'picture' ? { frame: 'phone', textX: 0.5, textY: 0.5 } : {}) });
  // Every theme in the typeface brings its patterns; with none known yet, one of each.
  const known = p.themes.filter((t) => PATTERNS[t]);
  const patterns = known.length ? known.flatMap((t) => PATTERNS[t]) : Object.values(PATTERNS).map((l) => l[0]);
  const cat = known.length ? known.map((t) => `${CATEGORY_LABELS[t].emoji} ${CATEGORY_LABELS[t].label}`).join(' + ') : null;
  const ink = inkFor(d);

  return (
    <div className="poster-editor">
      <div className="poster-wrap" ref={wrap}>
        <div className="poster-stage" ref={stage} style={{ width: viewW, height: viewH }} onPointerDown={() => setSelected(null)}>
          <canvas ref={canvas} style={{ width: viewW, height: viewH }} aria-label={`Your ${f.label.toLowerCase()}`} role="img" />
          <div
            className="text-hit"
            style={{ left: placed.text.x * k, top: placed.text.y * k, width: placed.text.w * k, height: placed.text.h * k }}
            onPointerDown={moveWords}
            title="Drag to move your big words"
            aria-label="Your big words: drag to move them"
          />
          {d.boxes.map((b) => {
            const r = placed.boxes[b.id];
            if (!r) return null;
            return (
              <div
                key={b.id}
                className={`box-hit ${b.id === selected ? 'on' : ''}`}
                style={{ left: r.x * k - 6, top: r.y * k - 4, width: r.w * k + 12, height: r.h * k + 8 }}
                onPointerDown={(e) => moveBox(e, b)}
                title="Drag to move this text"
                aria-label={`Text box: ${b.text.split('\n')[0] || 'empty'}. Drag to move it.`}
              />
            );
          })}
        </div>
        <p className="poster-hint">
          {f.label} · {f.w} × {f.h} px{f.note && !/\d/.test(f.note) ? `, ${f.note}` : ''}. Drag your big words and text boxes to move them.
        </p>
      </div>

      <div className="design-panel">
        <section aria-labelledby="bg-title">
          <Label id="bg-title">1. Background</Label>
          <div className="seg" role="group" aria-label="Background type">
            <button className={fill.kind === 'picture' ? 'on' : ''} aria-pressed={fill.kind === 'picture'} onClick={() => fill.kind !== 'picture' && pickPicture(groups[0].items[0].id)}>
              Picture
            </button>
            <button className={fill.kind === 'solid' ? 'on' : ''} aria-pressed={fill.kind === 'solid'} onClick={() => fill.kind !== 'solid' && leavePicture({ kind: 'solid', colour })}>
              Colour
            </button>
            <button className={fill.kind === 'gradient' ? 'on' : ''} aria-pressed={fill.kind === 'gradient'} onClick={() => fill.kind !== 'gradient' && leavePicture({ kind: 'gradient', type: 'linear', from: colour, to: '#eb362d', angle: 135 })}>
              Gradient
            </button>
          </div>
          {fill.kind === 'picture' ? (
            <div className="picture-groups">
              {groups.map((g) => (
                <div key={g.key}>
                  <p className="picture-group">{groupLabel(g.key)}</p>
                  <div className="picture-tiles" role="group" aria-label={`${groupLabel(g.key)} pictures`}>
                    {g.items.map((b) => (
                      <button key={b.id} className={fill.id === b.id ? 'on' : ''} aria-pressed={fill.id === b.id} onClick={() => pickPicture(b.id)} title={b.label} aria-label={b.label}>
                        <img src={thumbUrl(b.id)} alt="" loading="lazy" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : fill.kind === 'solid' ? (
            <ColorPicker label="Colour" value={fill.colour} swatches={swatches} onChange={(c) => p.onDesign({ fill: { kind: 'solid', colour: c } })} />
          ) : (
            <>
              <div className="grad-bar" style={{ background: `linear-gradient(90deg, ${fill.from}, ${fill.to})` }} />
              <div className="row tight">
                <ColorPicker label="From" value={fill.from} swatches={swatches} onChange={(c) => p.onDesign({ fill: { ...fill, from: c } })} />
                <button className="btn small" onClick={() => p.onDesign({ fill: { ...fill, from: fill.to, to: fill.from } })} aria-label="Swap the two colours" title="Swap">
                  ⇄
                </button>
                <ColorPicker label="To" value={fill.to} swatches={swatches} onChange={(c) => p.onDesign({ fill: { ...fill, to: c } })} />
              </div>
              <div className="row tight">
                <div className="seg small" role="group" aria-label="Gradient shape">
                  {(['linear', 'radial'] as const).map((t) => (
                    <button key={t} className={fill.type === t ? 'on' : ''} aria-pressed={fill.type === t} onClick={() => p.onDesign({ fill: { ...fill, type: t } })}>
                      {t === 'linear' ? 'Straight' : 'Round'}
                    </button>
                  ))}
                </div>
                {fill.type === 'linear' && (
                  <label className="angle">
                    <span className="dial" style={{ transform: `rotate(${fill.angle}deg)` }} aria-hidden />
                    <input type="range" min={0} max={359} value={fill.angle} onChange={(e) => p.onDesign({ fill: { ...fill, angle: Number(e.target.value) } })} aria-label="Gradient angle" />
                    <span>{fill.angle}°</span>
                  </label>
                )}
              </div>
            </>
          )}
          {fill.kind !== 'picture' && (
            <div className="grad-presets" role="group" aria-label="Ready-made gradients">
              {GRADIENTS.map((g, i) => (
                <button key={i} style={{ background: g.kind === 'gradient' ? (g.type === 'radial' ? `radial-gradient(circle, ${g.from}, ${g.to})` : `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})`) : undefined }} onClick={() => leavePicture(g)} aria-label={`Gradient ${i + 1}`} />
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="words-title">
          <Label id="words-title">2. Big words in your letters</Label>
          {p.words}
          <div className="seg" role="group" aria-label="Big words size">
            {(['S', 'M', 'L'] as Size[]).map((s) => (
              <button key={s} className={p.size === s ? 'on' : ''} onClick={() => p.onSize(s)} aria-pressed={p.size === s}>
                {s === 'S' ? 'Small' : s === 'M' ? 'Medium' : 'Big'}
              </button>
            ))}
          </div>
        </section>

        <section aria-labelledby="boxes-title" className="boxes-panel">
          <Label id="boxes-title">3. Text boxes</Label>
          {d.boxes.length > 0 && (
            <div className="box-list" role="group" aria-label="Your text boxes">
              {d.boxes.map((b, i) => (
                <button key={b.id} className={b.id === selected ? 'on' : ''} aria-pressed={b.id === selected} onClick={() => setSelected(b.id === selected ? null : b.id)} style={{ font: bodyFont(b.font, 17) }}>
                  {i + 1}. {b.text.split('\n')[0] || 'Empty box'}
                </button>
              ))}
            </div>
          )}
          <button className="btn small yellow" onClick={() => p.onDesign({ boxes: [...d.boxes, addBox()] })}>
            + Add a text box
          </button>
          {sel && (
            <div className="box-editor">
              <textarea
                className="details"
                rows={4}
                value={sel.text}
                autoFocus
                onChange={(e) => setBox(sel.id, { text: e.target.value })}
                placeholder={'Write here. Press Enter for a new line.'}
                aria-label="Text in this box: press Enter for a new line"
                style={{ fontFamily: `"${BODY_FONTS[sel.font].family}", sans-serif`, fontWeight: BODY_FONTS[sel.font].weight }}
              />
              <div className="field">
                <span className="field-label">Font</span>
                <div className="seg" role="group" aria-label="Font">
                  {BODY_FONT_IDS.map((id) => (
                    <button key={id} className={sel.font === id ? 'on' : ''} aria-pressed={sel.font === id} onClick={() => setBox(sel.id, { font: id })} style={{ font: bodyFont(id, 19) }}>
                      {BODY_FONTS[id].label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="field">
                <span className="field-label">Size</span>
                <input
                  type="range"
                  min={Math.round(BOX_SIZES.min * 1000)}
                  max={Math.round(BOX_SIZES.max * 1000)}
                  value={Math.round(sel.size * 1000)}
                  onChange={(e) => setBox(sel.id, { size: Number(e.target.value) / 1000 })}
                  aria-label="Text size"
                />
              </label>
              <div className="field">
                <span className="field-label">Place</span>
                <div className="place-grid" role="group" aria-label="Place the text">
                  {PLACES.map(({ col, row }, i) => {
                    const spot = spotsFor(d).box(col, row);
                    const on = Math.abs(spot.x - sel.x) < 0.01 && Math.abs(spot.y - sel.y) < 0.01 && spot.align === sel.align;
                    return <button key={i} className={on ? 'on' : ''} aria-pressed={on} aria-label={PLACE_NAMES[i]} title={PLACE_NAMES[i]} onClick={() => setBox(sel.id, spot)} />;
                  })}
                </div>
              </div>
              <div className="row tight">
                <ColorPicker label="Colour" value={sel.colour ?? ink} swatches={swatches} onChange={(c) => setBox(sel.id, { colour: c })} />
                {sel.colour && (
                  <button className="btn small" onClick={() => setBox(sel.id, { colour: null })}>
                    Best for this background
                  </button>
                )}
                <span className="spacer" />
                <button className="btn small red" onClick={() => removeBox(sel.id)}>
                  Delete box
                </button>
              </div>
            </div>
          )}
          {!sel && <p className="help">{d.boxes.length ? 'Tap a text box (here or on the picture) to change it.' : 'Add a message, or the details of your party.'}</p>}
        </section>

        <section aria-labelledby="frame-title">
          <Label id="frame-title">Size</Label>
          <div className="frame-chips" role="group" aria-label="Frame size">
            {pic && (
              <button className={d.frame === 'picture' ? 'on' : ''} aria-pressed={d.frame === 'picture'} onClick={() => p.onDesign({ frame: 'picture' })} title={`The picture's own shape (${pic.w} × ${pic.h})`}>
                <span className="frame-icon" style={{ width: (26 * pic.w) / Math.max(pic.w, pic.h), height: (26 * pic.h) / Math.max(pic.w, pic.h) }} />
                {pic.groups.includes('party') ? 'Card' : 'Picture'}
              </button>
            )}
            {FRAME_IDS.map((id) => {
              const fr = FRAMES[id];
              const s = 26 / Math.max(fr.w, fr.h);
              return (
                <button key={id} className={d.frame === id ? 'on' : ''} aria-pressed={d.frame === id} onClick={() => p.onDesign({ frame: id })} title={`${fr.label} (${fr.note})`}>
                  <span className="frame-icon" style={{ width: fr.w * s, height: fr.h * s }} />
                  {fr.label.replace(' wallpaper', '').replace(' poster', '')}
                </button>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="pattern-title">
          <Label id="pattern-title">Pattern{cat ? ` · ${cat}` : ''}</Label>
          <div className="pattern-tiles" role="group" aria-label="Pattern">
            <button className={!d.pattern ? 'on' : ''} aria-pressed={!d.pattern} onClick={() => p.onDesign({ pattern: null })}>
              <span className="none">None</span>
            </button>
            {patterns.map((pt) => (
              <button key={pt.id} className={d.pattern === pt.id ? 'on' : ''} aria-pressed={d.pattern === pt.id} onClick={() => p.onDesign({ pattern: pt.id })} title={pt.label}>
                <PatternSample id={pt.id} colour={d.patternColour} background={colour} opacity={d.patternOpacity} />
                <small>{pt.label}</small>
              </button>
            ))}
          </div>
          {d.pattern && (
            <div className="row tight">
              <ColorPicker label="Pattern" value={d.patternColour} swatches={swatches} onChange={(c) => p.onDesign({ patternColour: c })} />
              <label className="opacity">
                <span>Strength</span>
                <input type="range" min={5} max={100} value={Math.round(d.patternOpacity * 100)} onChange={(e) => p.onDesign({ patternOpacity: Number(e.target.value) / 100 })} aria-label="Pattern strength" />
                <span>{Math.round(d.patternOpacity * 100)}%</span>
              </label>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function PatternSample({ id, colour, background, opacity }: { id: string; colour: string; background: string; opacity: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawPatternSample(ref.current, id, colour, background, opacity);
  }, [id, colour, background, opacity]);
  return <canvas ref={ref} width={112} height={112} />;
}
