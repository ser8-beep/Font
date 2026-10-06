import { useState } from 'react';
import { CATEGORY_IDS, CATEGORY_LABELS, ideasFor } from '../core/alphabet';
import type { LetterGlyph } from '../font';
import type { Alphabet } from '../grow';
import { GlyphView } from './TextRender';

interface Props {
  alphabet: Alphabet;
  captured: Map<string, LetterGlyph>;
  /** The category the kid picked (null = the app's guess). */
  chosen: string | null;
  onCategory: (id: string | null) => void;
  /** Pick a library alphabet by id (null = the best one). */
  onAlphabet: (id: string | null) => void;
  onReroll: (ch: string) => void;
  onAddMore: () => void;
}

const nameOf = (id: string) => CATEGORY_LABELS[id] ?? { label: id, emoji: '✨' };

/** The kid's letters plus a real object alphabet for all the others. */
export function GrowStep({ alphabet, captured, chosen, onCategory, onAlphabet, onReroll, onAddMore }: Props) {
  const { chars, grown, done, total, failed, category, guess, sets, nextSet, options } = alphabet;
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const finished = done >= total;
  const yours = [...captured.keys()].join(' ');
  // Best guesses first, then the rest in the usual order.
  const order = [...guess.slice(0, 3), ...CATEGORY_IDS.filter((id) => !guess.slice(0, 3).includes(id))];
  const sel = selected ?? chars.find((c) => !captured.has(c) && grown.has(c)) ?? null;
  const ideas = sel && category ? ideasFor(sel, category) : [];
  const selGlyph = sel ? (grown.get(sel) ?? captured.get(sel) ?? null) : null;
  const about = selGlyph?.picture.kind === 'art' ? selGlyph.picture : null;
  const set = sets[0];

  return (
    <>
      <h1>
        <span className="tag">{finished ? 'Your whole alphabet!' : 'Finding your letters…'}</span>
      </h1>
      <p>
        We matched your <strong>{yours}</strong> to an alphabet made of real things like yours, and used it for all the other letters. Don't like one? Press{' '}
        <strong>Try another</strong>.
      </p>

      <div className="card made-from">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row">
            <span>{chosen ? 'You made it from' : 'Looks like you used'}</span>
            {category ? (
              <span className="cat-chip on">
                {nameOf(category).emoji} {nameOf(category).label}
              </span>
            ) : (
              <span className="cat-chip">Looking…</span>
            )}
          </div>
          <button className="btn small" onClick={() => setPicking(!picking)} aria-expanded={picking}>
            {picking ? 'Done' : 'Not right? Change it'}
          </button>
        </div>
        {set && (
          <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
            <span>
              Letters from: <strong>{set.title}</strong>
              {set.category !== category && ` (${nameOf(set.category).label.toLowerCase()})`}
            </span>
            {nextSet && (
              <button className="btn small yellow" onClick={() => onAlphabet(nextSet)}>
                🔀 Try a different alphabet
              </button>
            )}
          </div>
        )}
        {picking && (
          <div className="cat-grid" role="group" aria-label="What did you make your letters from?">
            {order.map((id) => (
              <button
                key={id}
                className={`cat-chip ${id === category ? 'on' : ''}`}
                aria-pressed={id === category}
                onClick={() => {
                  onCategory(id === guess[0] ? null : id);
                  setPicking(false);
                }}
              >
                {nameOf(id).emoji} {nameOf(id).label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="row" style={{ margin: '10px 0 16px' }}>
        <div className="grow-meter" aria-label={`${done} of ${total} letters made`}>
          <div style={{ width: `${total ? (done / total) * 100 : 100}%` }} />
          <span>{finished ? 'All done!' : `${done} of ${total}`}</span>
        </div>
      </div>
      {failed && <p className="card" style={{ background: 'var(--pink)' }}>We couldn't grow new letters from this photo. Try neatening your letters, or add another photo.</p>}

      {sel && selGlyph && (
        <div className="card ideas">
          <div className="ideas-glyph">
            <GlyphView glyph={selGlyph} size={110} />
          </div>
          <div>
            {about && (
              <p style={{ margin: '0 0 6px', fontSize: 20 }}>
                This {sel} is made of <strong>{about.objects}</strong>.
              </p>
            )}
            <strong style={{ fontSize: 22 }}>{captured.has(sel) ? `💡 Other ways to build ${sel}` : `💡 Build a real ${sel} too?`}</strong>
            {ideas.length > 0 && (
              <p style={{ margin: '6px 0' }}>
                Makers who use {nameOf(category).label.toLowerCase()} built {sel} from: <strong>{ideas.join(' · ')}</strong>
              </p>
            )}
            {!captured.has(sel) && (
              <button className="btn small pink" onClick={onAddMore}>
                + Photograph my own {sel}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="alpha-grid">
        {chars.map((ch) => {
          const own = captured.get(ch);
          const g = own ?? grown.get(ch) ?? null;
          return (
            <div key={ch} className={`alpha-tile ${own ? 'own' : ''} ${g ? 'ready' : 'waiting'} ${ch === sel ? 'picked' : ''}`}>
              <span className="alpha-char">{ch}</span>
              {own && <span className="alpha-badge" title="You made this one">📷</span>}
              <button className="alpha-glyph" onClick={() => setSelected(ch)} aria-label={`Ideas for ${ch}`} disabled={!g}>
                {g ? <GlyphView glyph={g} size={96} /> : <div className="alpha-wait" />}
              </button>
              {!own && g && (options.get(ch) ?? 0) > 1 && (
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
