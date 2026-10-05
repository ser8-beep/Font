import { strToU8, zipSync } from 'fflate';
import { useEffect, useState } from 'react';
import { CAP_HEIGHT, svgToContours } from '../core/trace';
import { buildTTF } from '../core/ttf';
import { download } from '../font';
import { connectRoom, fetchRoom, roomBase, type RoomState } from '../room';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Projector view: the room's shared alphabet filling up live. */
export function RoomView() {
  const [state, setState] = useState<RoomState | null>(null);
  const [error, setError] = useState(false);
  const base = roomBase();

  useEffect(() => {
    if (!base) {
      setError(true);
      return;
    }
    fetchRoom(base).then((s) => (s ? setState(s) : setError(true)));
    return connectRoom(base, (s) => {
      setState(s);
      setError(false);
    });
  }, [base]);

  const alphabet = state?.alphabet ?? {};
  const extra = Object.keys(alphabet).filter((c) => !ALPHABET.includes(c)).sort();
  const filled = [...ALPHABET].filter((c) => alphabet[c]).length;

  const exportZip = () => {
    const glyphs = Object.values(alphabet);
    const ttf = buildTTF({
      familyName: state?.name || 'Room Alphabet',
      designer: [...new Set(glyphs.map((g) => g.team))].join(', '),
      glyphs: glyphs.map((g) => ({
        codepoints: [g.char.charCodeAt(0), ...(g.char.toLowerCase() !== g.char ? [g.char.toLowerCase().charCodeAt(0)] : [])],
        contours: svgToContours(g.svg),
        advance: g.advance,
      })),
    });
    const files: Record<string, Uint8Array> = { 'Room Alphabet.ttf': ttf };
    for (const g of glyphs) {
      files[`letters/${g.char}.svg`] = strToU8(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -${CAP_HEIGHT + 100} ${g.advance} ${CAP_HEIGHT + 200}"><path transform="scale(1 -1)" d="${g.svg}"/></svg>`,
      );
    }
    files['teams.txt'] = strToU8(glyphs.map((g) => `${g.char}: ${g.team}`).join('\n') + '\n');
    download(new Blob([zipSync(files) as BlobPart], { type: 'application/zip' }), 'room-alphabet.zip');
  };

  return (
    <div className="room">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Our room alphabet</h1>
        <div className="row">
          <strong style={{ fontSize: 32 }}>{filled} / 26</strong>
          <button className="btn yellow" onClick={exportZip} disabled={!Object.keys(alphabet).length}>
            ⬇ Download room font (.zip)
          </button>
        </div>
      </div>
      <div className="meter" aria-hidden>
        <div style={{ width: `${(filled / 26) * 100}%` }} />
      </div>
      {error && <p>Can't reach the room server. Start it with <code>npm run room</code> and open this page from it.</p>}
      <div className="room-grid">
        {[...ALPHABET, ...extra].map((c) => {
          const g = alphabet[c];
          return (
            <div key={c} className={`room-cell ${g ? 'filled' : ''}`}>
              {g ? (
                <>
                  <svg viewBox={`0 -${CAP_HEIGHT + 60} ${Math.max(g.advance, CAP_HEIGHT)} ${CAP_HEIGHT + 120}`} aria-label={c}>
                    <path transform={`translate(${Math.max(0, (CAP_HEIGHT - g.advance) / 2)} 0) scale(1 -1)`} d={g.svg} fill="#1b1b3a" />
                  </svg>
                  <span className="team">{g.team}</span>
                </>
              ) : (
                <span className="ghost">{c}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
