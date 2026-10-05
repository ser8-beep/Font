import { CAP_HEIGHT, LINE, layoutText, materialImage, type LetterGlyph } from '../font';

interface Props {
  text: string;
  map: Map<string, LetterGlyph>;
  material: boolean;
  maxWidth?: number;
  className?: string;
  color?: string;
  /** Show a blinking caret after the text. */
  caret?: boolean;
}

/** Draws text with the kid's letters. Unknown letters become grey boxes. */
export function TextRender({ text, map, material, maxWidth = 5200, className, color = '#1b1b3a', caret }: Props) {
  const { items, lines, width } = layoutText(text, map, maxWidth);
  const pad = 80;
  const w = Math.max(width, 1200) + pad * 2;
  const h = lines * LINE + pad;
  // Font units are y-up with the baseline at 0; each line's baseline sits at LINE*(line+1) - 200.
  const base = (line: number) => pad / 2 + line * LINE + 850;
  const last = items[items.length - 1];
  return (
    <svg className={className} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={text}>
      {items.map((it, i) => {
        const x = pad + it.x;
        const y = base(it.line);
        if (it.ch === ' ') return null;
        if (!it.glyph) {
          return (
            <g key={i}>
              <rect x={x + 40} y={y - CAP_HEIGHT} width={it.advance - 80} height={CAP_HEIGHT} rx={40} fill="#d6d6e0" stroke="#a5a5b8" strokeWidth={14} strokeDasharray="40 30" />
              <text x={x + it.advance / 2} y={y - CAP_HEIGHT / 2 + 70} textAnchor="middle" fontSize={200} fontWeight={900} fill="#9a9ab0">
                {it.ch.toUpperCase()}
              </text>
            </g>
          );
        }
        const o = it.glyph.outline;
        if (material) {
          return <image key={i} href={materialImage(it.glyph)} x={x + o.lsb} y={y - CAP_HEIGHT} width={o.inkWidth} height={CAP_HEIGHT} preserveAspectRatio="none" />;
        }
        return <path key={i} d={it.glyph.svg} transform={`translate(${x} ${y}) scale(1 -1)`} fill={color} />;
      })}
      {caret && (
        <rect className="caret" x={pad + (last && last.line === lines - 1 ? last.x + last.advance : 0) + 20} y={base(lines - 1) - CAP_HEIGHT - 50} width={40} height={CAP_HEIGHT + 100} fill="#ff5d8f">
          <animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite" />
        </rect>
      )}
    </svg>
  );
}

/** A single glyph, fitted into a square. */
export function GlyphView({ glyph, material, size = 200 }: { glyph: LetterGlyph | null; material?: boolean; size?: number }) {
  if (!glyph) {
    return (
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <text x="50" y="62" textAnchor="middle" fontSize="18" fontWeight="800" fill="#9a9ab0">
          nothing yet
        </text>
      </svg>
    );
  }
  const o = glyph.outline;
  const box = Math.max(o.advance, CAP_HEIGHT + 120);
  const ox = (box - o.advance) / 2;
  return (
    <svg viewBox={`0 0 ${box} ${box}`} width={size} height={size}>
      {material ? (
        <image href={materialImage(glyph)} x={ox + o.lsb} y={(box - CAP_HEIGHT) / 2} width={o.inkWidth} height={CAP_HEIGHT} preserveAspectRatio="none" />
      ) : (
        <path d={glyph.svg} transform={`translate(${ox} ${(box + CAP_HEIGHT) / 2}) scale(1 -1)`} fill="#1b1b3a" />
      )}
    </svg>
  );
}
