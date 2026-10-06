import type { LetterGlyph } from '../font';
import type { Alphabet } from '../grow';
import { GlyphView } from './TextRender';

interface Props {
  alphabet: Alphabet;
  captured: Map<string, LetterGlyph>;
  onReroll: (ch: string) => void;
}

/** The whole alphabet filling in, letter by letter, in the kid's own stuff. */
export function GrowStep({ alphabet, captured, onReroll }: Props) {
  const { chars, grown, done, total, failed } = alphabet;
  const finished = done >= total;
  const yours = [...captured.keys()].join(' ');
  return (
    <>
      <h1>
        <span className="tag">{finished ? 'Your whole alphabet!' : 'Growing your alphabet…'}</span>
      </h1>
      <p>
        We used your <strong>{yours}</strong> to make all the other letters out of the same stuff.
        {' '}Don't like one? Press <strong>Try another</strong>.
      </p>
      <div className="row" style={{ margin: '10px 0 16px' }}>
        <div className="grow-meter" aria-label={`${done} of ${total} letters made`}>
          <div style={{ width: `${total ? (done / total) * 100 : 100}%` }} />
          <span>{finished ? 'All done!' : `${done} of ${total}`}</span>
        </div>
      </div>
      {failed && <p className="card" style={{ background: 'var(--pink)' }}>We couldn't grow new letters from this photo. Try neatening your letters, or add another photo.</p>}
      <div className="alpha-grid">
        {chars.map((ch) => {
          const own = captured.get(ch);
          const g = own ?? grown.get(ch) ?? null;
          return (
            <div key={ch} className={`alpha-tile ${own ? 'own' : ''} ${g ? 'ready' : 'waiting'}`}>
              <span className="alpha-char">{ch}</span>
              {own && <span className="alpha-badge" title="You made this one">📷</span>}
              <div className="alpha-glyph">{g ? <GlyphView glyph={g} size={96} /> : <div className="alpha-wait" />}</div>
              {!own && g && (
                <button className="alpha-again" onClick={() => onReroll(ch)} aria-label={`Try another ${ch}`}>
                  Try another
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
