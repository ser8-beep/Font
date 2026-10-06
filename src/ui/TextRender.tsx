import { useId } from 'react';
import { LINE, layoutText, materialImage, type LetterGlyph } from '../font';

interface Props {
  text: string;
  map: Map<string, LetterGlyph>;
  maxWidth?: number;
  className?: string;
  /** Background colour painted behind the letters (none = transparent). */
  backdrop?: string;
  /** Show a blinking caret after the text. */
  caret?: boolean;
}

/** Draws text with the kid's photo letters. Characters the font doesn't have become grey boxes. */
export function TextRender({ text, map, maxWidth = 5200, className, backdrop, caret }: Props) {
  const shadowId = useId().replace(/:/g, '');
  const lay = layoutText(text, map, maxWidth);
  const pad = 80;
  const w = Math.max(lay.width, 1200) + pad * 2;
  // Each line: top of the tallest letter to the bottom of the lowest tail.
  const lineTop = lay.top + 40, lineBottom = -lay.bottom + 40;
  const firstBase = pad / 2 + lineTop;
  const base = (line: number) => firstBase + line * LINE;
  const h = firstBase + (lay.lines - 1) * LINE + lineBottom + pad / 2;
  const last = lay.items[lay.items.length - 1];
  return (
    <svg className={className} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={text}>
      <defs>
        <filter id={shadowId} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="16" dy="22" stdDeviation="16" floodColor="#1b1b3a" floodOpacity="0.32" />
        </filter>
      </defs>
      {backdrop && <rect x="0" y="0" width={w} height={h} fill={backdrop} />}
      <g filter={`url(#${shadowId})`}>
        {lay.items.map((it, i) => {
          const x = pad + it.x;
          const y = base(it.line);
          if (it.ch === ' ') return null;
          if (!it.glyph) {
            return (
              <g key={i}>
                <rect x={x + 40} y={y - 700} width={it.advance - 80} height={700} rx={40} fill="#d6d6e0" stroke="#a5a5b8" strokeWidth={14} strokeDasharray="40 30" />
                <text x={x + it.advance / 2} y={y - 280} textAnchor="middle" fontSize={200} fontWeight={900} fill="#9a9ab0">
                  {it.ch}
                </text>
              </g>
            );
          }
          const o = it.glyph.outline;
          return <image key={i} href={materialImage(it.glyph)} x={x + o.lsb} y={y - o.top} width={o.inkWidth} height={o.top - o.bottom} preserveAspectRatio="none" />;
        })}
      </g>
      {caret && (
        <rect x={pad + (last && last.line === lay.lines - 1 ? last.x + last.advance : 0) + 20} y={base(lay.lines - 1) - 750} width={40} height={850} fill="#ff5d8f">
          <animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite" />
        </rect>
      )}
    </svg>
  );
}

/** A single photo letter, fitted into a square. */
export function GlyphView({ glyph, size = 200 }: { glyph: LetterGlyph | null; size?: number }) {
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
  const box = Math.max(o.advance, 940);
  const ox = (box - o.advance) / 2;
  // Baseline placed so that the -210..700 band sits in the middle of the square.
  const base = (box + 700 - 210) / 2;
  return (
    <svg viewBox={`0 0 ${box} ${box}`} width={size} height={size}>
      <image href={materialImage(glyph)} x={ox + o.lsb} y={base - o.top} width={o.inkWidth} height={o.top - o.bottom} preserveAspectRatio="none" />
    </svg>
  );
}
