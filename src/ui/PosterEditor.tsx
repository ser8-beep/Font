import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CATEGORY_LABELS } from '../core/alphabet/category';
import { backgroundById, backgroundGroups, loadBackground, thumbUrl } from '../backgrounds';
import {
  bodyColourOf, DEFAULT_DETAILS, designReady, drawPatternSample, FRAME_IDS, FRAMES, frameOf, PALETTE, PATTERNS, renderDesign,
  type Box, type Design, type Fill,
} from '../design';
import { BODY_FONT_IDS, BODY_FONTS, bodyFont } from '../fonts';
import type { LetterGlyph } from '../font';
import type { Size } from '../state';
import { ColorPicker } from './ColorPicker';

interface Props {
  design: Design;
  onDesign: (patch: Partial<Design>) => void;
  text: string;
  map: Map<string, LetterGlyph>;
  size: Size;
  onSize: (s: Size) => void;
  /** The typeface's themes, main first: their patterns are offered (empty when not known yet). */
  themes: string[];
  /** The kid's table colour, as a swatch. */
  table: string;
}

const GRADIENTS: Fill[] = [
  { kind: 'gradient', type: 'linear', from: '#ffd23f', to: '#ff5d8f', angle: 135 },
  { kind: 'gradient', type: 'linear', from: '#4cc9f0', to: '#8338ec', angle: 160 },
  { kind: 'gradient', type: 'linear', from: '#06d6a0', to: '#ffd23f', angle: 180 },
  { kind: 'gradient', type: 'radial', from: '#fffaf0', to: '#ff8c42', angle: 0 },
  { kind: 'gradient', type: 'linear', from: '#1b1b3a', to: '#3a86ff', angle: 200 },
];

/** 'rgb(1, 2, 3)' or '#abc' -> '#aabbcc'. */
function asHex(c: string): string {
  const m = c.match(/rgb\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? '#' + m.slice(1).map((v) => Number(v).toString(16).padStart(2, '0')).join('') : c;
}

const Label = ({ children }: { children: React.ReactNode }) => <p className="section-label">{children}</p>;

const themeLabel = (key: string) => (CATEGORY_LABELS[key] ? `${CATEGORY_LABELS[key].emoji} ${CATEGORY_LABELS[key].label}` : key);
// Pantry Raid and Market Basket share their kitchen pictures.
const groupLabel = (key: string) =>
  key === 'party' ? '🎉 Party' : key === 'more' ? 'More pictures' : key === 'food' || key === 'produce' ? `${themeLabel('food')} · ${themeLabel('produce')}` : themeLabel(key);

/** The playground's poster or birthday invitation: a live preview to drag the words on, and the design controls. */
export function PosterEditor(p: Props) {
  const d = p.design;
  const f = frameOf(d);
  const invite = d.mode === 'invite';
  const pic = d.fill.kind === 'picture' ? backgroundById(d.fill.id) : null;

  // The picture and the details' fonts load in the background; draw again when they arrive.
  const [ready, setReady] = useState(0);
  useEffect(() => {
    let live = true;
    designReady(d).then(() => live && setReady((n) => n + 1));
    return () => {
      live = false;
    };
  }, [d.fill, d.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const swatches = [...PALETTE, asHex(p.table)];

  // ---- preview size ----
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [avail, setAvail] = useState({ w: 800, h: 600 });
  useLayoutEffect(() => {
    const el = wrap.current!;
    const measure = () => setAvail({ w: el.clientWidth, h: Math.max(260, window.innerHeight * 0.64) });
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
  const [textBox, setTextBox] = useState<Box>({ x: 0, y: 0, w: 0, h: 0 });
  useEffect(() => {
    const c = canvas.current;
    if (!c || viewW < 2) return;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    c.width = Math.round(viewW * dpr);
    c.height = Math.round(viewH * dpr);
    const ctx = c.getContext('2d')!;
    const r = renderDesign(ctx, d, { text: p.text, map: p.map, size: p.size, scale: c.width / f.w });
    setTextBox((b) => (b.x === r.text.x && b.y === r.text.y && b.w === r.text.w && b.h === r.text.h ? b : r.text));
  }, [d, p.text, p.map, p.size, viewW, viewH, f.w, ready]);

  /** Follows one pointer until it lets go. */
  const follow = (e: React.PointerEvent, move: (ev: PointerEvent) => void, up?: (ev: PointerEvent) => void) => {
    e.preventDefault();
    e.stopPropagation();
    const mv = (ev: PointerEvent) => move(ev);
    const done = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', done);
      window.removeEventListener('pointercancel', done);
      up?.(ev);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', done);
    window.addEventListener('pointercancel', done);
  };
  const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
  /** Pointer position as shares of the frame. */
  const inFrame = (ev: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height, inside: ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom };
  };

  const moveText = (e: React.PointerEvent) => {
    const start = inFrame(e);
    const { textX, textY } = d;
    follow(e, (ev) => {
      const at = inFrame(ev);
      p.onDesign({ textX: clamp(textX + at.x - start.x, 0.05, 0.95), textY: clamp(textY + at.y - start.y, 0.05, 0.95) });
    });
  };

  const fill = d.fill;
  const colour = fill.kind === 'solid' ? fill.colour : fill.kind === 'gradient' ? fill.from : '#ffd23f';
  const setMode = (mode: Design['mode']) => {
    if (mode === d.mode) return;
    // An invitation starts on a party card; both start with the words in the middle.
    const card = mode === 'invite' && fill.kind !== 'picture' ? backgroundGroups(p.themes, true)[0]?.items[0] : null;
    // An invitation with no details yet gets example ones to change.
    const details = mode === 'invite' && !d.details.trim() ? DEFAULT_DETAILS : d.details;
    p.onDesign({ mode, textX: 0.5, textY: 0.5, details, ...(card ? { fill: { kind: 'picture', id: card.id } } : {}) });
  };
  const pickPicture = (id: string) => {
    loadBackground(id).catch(() => undefined);
    p.onDesign({ fill: { kind: 'picture', id }, ...(invite ? {} : { frame: 'picture' }) });
  };
  // Every theme in the typeface brings its patterns; with none known yet, one of each.
  const known = p.themes.filter((t) => PATTERNS[t]);
  const patterns = known.length ? known.flatMap((t) => PATTERNS[t]) : Object.values(PATTERNS).map((l) => l[0]);
  const cat = known.length ? known.map((t) => `${CATEGORY_LABELS[t].emoji} ${CATEGORY_LABELS[t].label}`).join(' + ') : null;
  const bg = colour;

  return (
    <div className="poster-editor">
      <div className="poster-wrap" ref={wrap}>
        <div className="poster-stage" ref={stage} style={{ width: viewW, height: viewH }}>
          <canvas ref={canvas} style={{ width: viewW, height: viewH }} aria-label={`Your ${f.label.toLowerCase()}`} role="img" />
          <div
            className="text-hit"
            style={{ left: textBox.x * k, top: textBox.y * k, width: textBox.w * k, height: textBox.h * k }}
            onPointerDown={moveText}
            title="Drag to move your words"
            aria-label="Your words: drag to move them"
          />
        </div>
        <p className="poster-hint">
          {f.label} · {f.note}. Drag your words to move them.
        </p>
      </div>

      <div className="design-panel">
        <section>
          <Label>Make a…</Label>
          <div className="seg" role="group" aria-label="What to make">
            <button className={!invite ? 'on' : ''} aria-pressed={!invite} onClick={() => setMode('poster')}>
              🖼️ Poster
            </button>
            <button className={invite ? 'on' : ''} aria-pressed={invite} onClick={() => setMode('invite')}>
              🎉 Birthday invitation
            </button>
          </div>
        </section>

        <section className="invite-panel">
          <Label>{invite ? 'Party details' : 'Body text'}</Label>
          <p className="help">
            {invite ? (
              <>
                Your big words are your photo letters: type them in the box above, like <strong>MIA IS 7!</strong>
              </>
            ) : (
              'Write a few lines to go under your words, or leave this empty.'
            )}
          </p>
          <textarea
            className="details"
            rows={invite ? 5 : 3}
            value={d.details}
            onChange={(e) => p.onDesign({ details: e.target.value })}
            placeholder={invite ? 'When is it?\nWhere is it?\nWho to tell if you can come' : 'A message, a line each'}
            aria-label={invite ? 'Party details: one line each' : 'Body text: one line each'}
            style={{ fontFamily: `"${BODY_FONTS[d.bodyFont].family}", sans-serif`, fontWeight: BODY_FONTS[d.bodyFont].weight }}
          />
          <div className="seg" role="group" aria-label="Font for the body text">
            {BODY_FONT_IDS.map((id) => (
              <button key={id} className={d.bodyFont === id ? 'on' : ''} aria-pressed={d.bodyFont === id} onClick={() => p.onDesign({ bodyFont: id })} style={{ font: bodyFont(id, 20) }}>
                {BODY_FONTS[id].label}
              </button>
            ))}
          </div>
          <div className="row tight">
            <ColorPicker label="Text colour" value={bodyColourOf(d)} swatches={swatches} onChange={(c) => p.onDesign({ bodyColour: c })} />
            {d.bodyColour && (
              <button className="btn small" onClick={() => p.onDesign({ bodyColour: null })}>
                Best for this background
              </button>
            )}
          </div>
        </section>

        {!invite && (
        <section>
          <Label>Frame</Label>
          <div className="frame-chips" role="group" aria-label="Frame size">
            {pic && (
              <button className={d.frame === 'picture' ? 'on' : ''} aria-pressed={d.frame === 'picture'} onClick={() => p.onDesign({ frame: 'picture' })} title={`The picture's own shape (${pic.w} × ${pic.h})`}>
                <span className="frame-icon" style={{ width: (26 * pic.w) / Math.max(pic.w, pic.h), height: (26 * pic.h) / Math.max(pic.w, pic.h) }} />
                Picture
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
        )}

        <section>
          <Label>Background</Label>
          <div className="seg" role="group" aria-label="Background type">
            <button className={fill.kind === 'picture' ? 'on' : ''} aria-pressed={fill.kind === 'picture'} onClick={() => fill.kind !== 'picture' && pickPicture(backgroundGroups(p.themes, invite)[0].items[0].id)}>
              Picture
            </button>
            <button className={fill.kind === 'solid' ? 'on' : ''} aria-pressed={fill.kind === 'solid'} onClick={() => fill.kind !== 'solid' && p.onDesign({ fill: { kind: 'solid', colour }, ...(d.frame === 'picture' ? { frame: 'phone' } : {}) })}>
              Colour
            </button>
            <button className={fill.kind === 'gradient' ? 'on' : ''} aria-pressed={fill.kind === 'gradient'} onClick={() => fill.kind !== 'gradient' && p.onDesign({ fill: { kind: 'gradient', type: 'linear', from: colour, to: '#ff5d8f', angle: 135 }, ...(d.frame === 'picture' ? { frame: 'phone' } : {}) })}>
              Gradient
            </button>
          </div>
          {fill.kind === 'picture' ? (
            <div className="picture-groups">
              {backgroundGroups(p.themes, invite).map((g) => (
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
                <button key={i} style={{ background: g.kind === 'gradient' ? (g.type === 'radial' ? `radial-gradient(circle, ${g.from}, ${g.to})` : `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})`) : undefined }} onClick={() => p.onDesign({ fill: g, ...(d.frame === 'picture' ? { frame: 'phone' } : {}) })} aria-label={`Gradient ${i + 1}`} />
              ))}
            </div>
          )}
        </section>

        {!invite && (
        <section>
          <Label>Pattern{cat ? ` · ${cat}` : ''}</Label>
          <div className="pattern-tiles" role="group" aria-label="Pattern">
            <button className={!d.pattern ? 'on' : ''} aria-pressed={!d.pattern} onClick={() => p.onDesign({ pattern: null })}>
              <span className="none">None</span>
            </button>
            {patterns.map((pt) => (
              <button key={pt.id} className={d.pattern === pt.id ? 'on' : ''} aria-pressed={d.pattern === pt.id} onClick={() => p.onDesign({ pattern: pt.id })} title={pt.label}>
                <PatternSample id={pt.id} colour={d.patternColour} background={bg} opacity={d.patternOpacity} />
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
        )}

        <section>
          <Label>{invite ? 'Big words size' : 'Letter size'}</Label>
          <div className="seg" role="group" aria-label="Letter size">
            {(['S', 'M', 'L'] as Size[]).map((s) => (
              <button key={s} className={p.size === s ? 'on' : ''} onClick={() => p.onSize(s)} aria-pressed={p.size === s}>
                {s === 'S' ? 'Small' : s === 'M' ? 'Medium' : 'Big'}
              </button>
            ))}
          </div>
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
