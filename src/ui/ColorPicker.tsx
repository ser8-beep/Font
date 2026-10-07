import { useEffect, useRef, useState } from 'react';

// A colour picker like Figma's or Illustrator's: a saturation/brightness square, a hue slider, a hex
// box, an eyedropper where the browser has one, and swatches (the palette plus recent picks).

type HSV = { h: number; s: number; v: number };

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().replace(/^#/, '').match(/^([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const full = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}
const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

function rgbToHsv(r: number, g: number, b: number): HSV {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? d / max : 0, v: max / 255 };
}

function hsvToHex({ h, s, v }: HSV): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return toHex(f(5), f(3), f(1));
}

const recent: string[] = [];
function remember(c: string) {
  const i = recent.indexOf(c);
  if (i >= 0) recent.splice(i, 1);
  recent.unshift(c);
  recent.length = Math.min(recent.length, 8);
}

interface Props {
  value: string;
  onChange: (hex: string) => void;
  /** Shown before the hex code on the button. */
  label: string;
  swatches: string[];
}

export function ColorPicker({ value, onChange, label, swatches }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="cp" ref={root}>
      <button type="button" className="cp-button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${label}: ${value}. Change colour`}>
        <span className="cp-chip" style={{ background: value }} />
        <span className="cp-text">
          <small>{label}</small>
          {value.toUpperCase()}
        </span>
      </button>
      {open && <Panel value={value} onChange={onChange} swatches={swatches} />}
    </div>
  );
}

function Panel({ value, onChange, swatches }: Omit<Props, 'label'>) {
  const rgb = hexToRgb(value) ?? [255, 255, 255];
  // Keep hue and saturation while dragging through greys and black, where the hex forgets them.
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(...rgb));
  const [hex, setHex] = useState(value.toUpperCase());
  const last = useRef(value);
  useEffect(() => {
    if (value === last.current) return;
    last.current = value;
    const c = hexToRgb(value);
    if (c) setHsv(rgbToHsv(...c));
    setHex(value.toUpperCase());
  }, [value]);

  const set = (next: HSV) => {
    setHsv(next);
    const h = hsvToHex(next);
    last.current = h;
    setHex(h.toUpperCase());
    onChange(h);
  };
  const pick = (h: string) => {
    remember(h);
    const c = hexToRgb(h);
    if (c) setHsv(rgbToHsv(...c));
    last.current = h;
    setHex(h.toUpperCase());
    onChange(h);
  };

  const drag = (el: HTMLElement, e: React.PointerEvent, apply: (fx: number, fy: number) => void) => {
    el.setPointerCapture(e.pointerId);
    const at = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      apply(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
    };
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      remember(hsvToHex(hsvRef.current));
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  const hsvRef = useRef(hsv);
  hsvRef.current = hsv;

  const key = (e: React.KeyboardEvent, dx: number, dy: number, apply: (dx: number, dy: number) => void) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const m: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = m[e.key];
    if (!d) return;
    e.preventDefault();
    apply(dx + d[0], dy + d[1]);
  };
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const EyeDropper = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;

  return (
    <div className="cp-panel" role="dialog" aria-label="Choose a colour">
      <div
        className="cp-sv"
        style={{ background: `hsl(${hsv.h} 100% 50%)` }}
        tabIndex={0}
        role="slider"
        aria-label="Colour strength and brightness"
        aria-valuetext={`saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
        onPointerDown={(e) => drag(e.currentTarget, e, (fx, fy) => set({ ...hsvRef.current, s: fx, v: 1 - fy }))}
        onKeyDown={(e) => key(e, hsv.s, 1 - hsv.v, (x, y) => set({ ...hsv, s: clamp(x), v: 1 - clamp(y) }))}
      >
        <span className="cp-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvToHex(hsv) }} />
      </div>
      <div
        className="cp-hue"
        tabIndex={0}
        role="slider"
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onPointerDown={(e) => drag(e.currentTarget, e, (fx) => set({ ...hsvRef.current, h: fx * 359.9 }))}
        onKeyDown={(e) => key(e, hsv.h / 360, 0, (x) => set({ ...hsv, h: clamp(x) * 359.9 }))}
      >
        <span className="cp-thumb" style={{ left: `${(hsv.h / 360) * 100}%`, top: '50%', background: `hsl(${hsv.h} 100% 50%)` }} />
      </div>
      <div className="cp-row">
        <span className="cp-chip big" style={{ background: hsvToHex(hsv) }} />
        <label className="cp-hex">
          <span>#</span>
          <input
            value={hex.replace(/^#/, '')}
            maxLength={6}
            spellCheck={false}
            aria-label="Hex colour code"
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9a-f]/gi, '').slice(0, 6);
              setHex('#' + v.toUpperCase());
              if (v.length === 6 || v.length === 3) pick(toHex(...hexToRgb(v)!));
            }}
          />
        </label>
        {EyeDropper && (
          <button
            type="button"
            className="cp-eye"
            aria-label="Pick a colour from the screen"
            title="Pick a colour from the screen"
            onClick={async () => {
              try {
                pick((await new EyeDropper().open()).sRGBHex);
              } catch {
                /* closed without picking */
              }
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
              <path d="M17 3l4 4-3 3-1-1-8 8H5v-4l8-8-1-1z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
      <div className="cp-swatches" role="group" aria-label="Colours">
        {[...new Set([...swatches, ...recent])].map((c) => (
          <button key={c} type="button" className={c.toLowerCase() === value.toLowerCase() ? 'on' : ''} style={{ background: c }} aria-label={c} title={c} onClick={() => pick(c)} />
        ))}
      </div>
    </div>
  );
}
