import { useEffect, useState } from 'react';
import { CATEGORY_IDS, CATEGORY_LABELS, ideasFor } from '../core/alphabet';
import type { LetterGlyph } from '../font';
import { normalise, type Alphabet, type ThemeShare } from '../grow';
import { GlyphView } from './TextRender';

interface Props {
  alphabet: Alphabet;
  captured: Map<string, LetterGlyph>;
  /** Set the themes and their shares in percent (null: back to the kid's tags, or the app's guess). */
  onMix: (mix: Record<string, number> | null) => void;
  /** Pick a library alphabet by id (null = the best one). */
  onAlphabet: (id: string | null) => void;
  onReroll: (ch: string) => void;
  /** Photograph another letter (ch: the one to add, when known). */
  onAddMore: (ch?: string) => void;
}

const nameOf = (id: string) => CATEGORY_LABELS[id] ?? { label: id, emoji: '✨', description: '' };
const asMix = (themes: ThemeShare[]) => Object.fromEntries(themes.map((t) => [t.id, t.share]));

/** New shares when one theme moves to `value`: the others share what is left, keeping their proportions. */
function reshare(themes: ThemeShare[], id: string, value: number): ThemeShare[] {
  const others = themes.filter((t) => t.id !== id);
  const rest = others.reduce((s, t) => s + t.share, 0);
  const left = 100 - value;
  const w: Record<string, number> = { [id]: value };
  for (const t of others) w[t.id] = rest ? (t.share / rest) * left : left / others.length;
  return normalise(w);
}

/** The themes in the typeface, with a slider each for how much of it is in the whole alphabet. */
function ThemeMix({ alphabet, onMix }: { alphabet: Alphabet; onMix: Props['onMix'] }) {
  const { themes, themesFrom, tagged, guess } = alphabet;
  // Shares move live while a slider is dragged and are saved when it is let go.
  const [draft, setDraft] = useState<ThemeShare[] | null>(null);
  useEffect(() => setDraft(null), [themes]);
  // 'mix': add a theme alongside; 'swap': replace the only theme with another.
  const [adding, setAdding] = useState<null | 'mix' | 'swap'>(null);
  const shown = draft ?? themes;
  const commit = () => draft && onMix(asMix(draft));
  const add = (id: string) => {
    if (adding === 'swap' || !shown.length) onMix({ [id]: 100 });
    else onMix(asMix(reshare([...shown, { id, share: 0 }], id, Math.round(100 / (shown.length + 1)))));
    setAdding(null);
  };
  const remove = (id: string) => onMix(asMix(normalise(Object.fromEntries(shown.filter((t) => t.id !== id).map((t) => [t.id, t.share])))));
  const from = themesFrom === 'mix' ? 'Your mix' : themesFrom === 'tags' ? 'From the themes you tagged' : 'Looks like you used';
  const others = [...guess, ...CATEGORY_IDS].filter((id, i, a) => a.indexOf(id) === i && !shown.some((t) => t.id === id));

  return (
    <section className="theme-mix" aria-labelledby="mix-title">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <p className="section-label" id="mix-title" style={{ margin: 0 }}>Themes in your typeface</p>
          <span className="help">{from}{shown.length > 1 ? '. Slide to choose how much of each.' : '.'}</span>
        </div>
        {themesFrom === 'mix' && (
          <button className="btn small" onClick={() => onMix(null)}>
            ↺ {tagged.size ? 'Back to my tags' : 'Back to our guess'}
          </button>
        )}
      </div>
      {shown.length === 0 && <p>Looking at your letters…</p>}
      {shown.map((t) => (
        <div key={t.id} className="mix-row">
          <span className="cat-chip on" title={nameOf(t.id).description}>
            {nameOf(t.id).emoji} {nameOf(t.id).label}
          </span>
          {tagged.get(t.id) ? <span className="mix-tagged">📷 {tagged.get(t.id)} of yours</span> : null}
          {shown.length > 1 ? (
            <>
              <input
                type="range"
                min={5}
                max={95}
                step={5}
                value={t.share}
                aria-label={`How much ${nameOf(t.id).label}`}
                onChange={(e) => setDraft(reshare(shown, t.id, Number(e.target.value)))}
                onPointerUp={commit}
                onKeyUp={commit}
                onTouchEnd={commit}
                onBlur={commit}
              />
              <strong className="mix-pct">{t.share}%</strong>
              <button className="mix-remove" onClick={() => remove(t.id)} aria-label={`Take ${nameOf(t.id).label} out`} title="Take this theme out">
                ✕
              </button>
            </>
          ) : (
            <strong className="mix-pct">100%</strong>
          )}
        </div>
      ))}
      {shown.length < CATEGORY_IDS.length && (
        <div className="row tight" style={{ marginTop: 6 }}>
          <button className="btn small yellow" onClick={() => setAdding(adding === 'mix' ? null : 'mix')} aria-expanded={adding === 'mix'}>
            {adding === 'mix' ? 'Close' : shown.length ? '+ Mix in another theme' : 'Choose a theme'}
          </button>
          {shown.length === 1 && (
            <button className="btn small" onClick={() => setAdding(adding === 'swap' ? null : 'swap')} aria-expanded={adding === 'swap'}>
              {adding === 'swap' ? 'Close' : 'Not right? Change it'}
            </button>
          )}
        </div>
      )}
      {adding && (
        <div className="cat-grid" role="group" aria-label={adding === 'swap' ? 'Choose a different theme' : 'Themes to mix in'}>
          {others.map((id) => (
            <button key={id} className="cat-chip" onClick={() => add(id)} title={nameOf(id).description}>
              {nameOf(id).emoji} {nameOf(id).label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** The kid's letters plus real object alphabets, in one or more themes, for all the others. */
export function GrowStep({ alphabet, captured, onMix, onAlphabet, onReroll, onAddMore }: Props) {
  const { chars, grown, done, total, failed, category, themes, themeOf, sets, nextSet, options } = alphabet;
  const [selected, setSelected] = useState<string | null>(null);
  const finished = done >= total;
  const yours = [...captured.keys()].join(' ');
  const sel = selected ?? chars.find((c) => !captured.has(c) && grown.has(c)) ?? null;
  // Ideas from the theme this letter comes from (the main theme for the kid's own letters).
  const selTheme = (sel && themeOf.get(sel)) || category;
  const ideas = sel && selTheme ? ideasFor(sel, selTheme) : [];
  const selGlyph = sel ? (grown.get(sel) ?? captured.get(sel) ?? null) : null;
  const about = selGlyph?.picture.kind === 'art' ? selGlyph.picture : null;
  const set = sets[0];

  return (
    <>
      <h1>
        <span className="tag">{finished ? 'Your whole alphabet!' : 'Finding your letters…'}</span>
      </h1>
      <p>
        We matched your <strong>{yours}</strong> to alphabets made of real things like yours, and used them for all the other letters. Mix in more themes below. Don't like a letter? Press{' '}
        <strong>Try another</strong>.
      </p>

      <div className="card made-from">
        <ThemeMix alphabet={alphabet} onMix={onMix} />
        {set && (
          <div className="row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
            <span>
              {themes.length > 1 ? `Main ${nameOf(category).label} letters from` : 'Letters from'}: <strong>{set.title}</strong>
            </span>
            {nextSet && (
              <button className="btn small yellow" onClick={() => onAlphabet(nextSet)}>
                🔀 Try a different alphabet
              </button>
            )}
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
                {nameOf(selTheme).emoji} {nameOf(selTheme).label} makers built {sel} from: <strong>{ideas.join(' · ')}</strong>
              </p>
            )}
            {!captured.has(sel) && (
              <button className="btn small pink" onClick={() => onAddMore(sel)}>
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
              {!own && themes.length > 1 && themeOf.get(ch) && (
                <span className="alpha-badge" title={nameOf(themeOf.get(ch)!).label}>
                  {nameOf(themeOf.get(ch)!).emoji}
                </span>
              )}
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
