import { useEffect, useMemo, useRef, useState } from 'react';
import type { Design } from '../design';
import { lookup, type LetterGlyph } from '../font';
import type { Size } from '../state';
import { PosterEditor } from './PosterEditor';
import { COLOURS } from './SplitStep';
import { GlyphView, TextRender } from './TextRender';

interface Props {
  text: string;
  map: Map<string, LetterGlyph>;
  /** Every character the font will have, in keyboard order. */
  keys: string[];
  celebrated: boolean;
  size: Size;
  design: Design;
  /** The typeface's themes, main first, for their background patterns (empty until known). */
  themes: string[];
  table: string;
  /** Letters still growing (they show as grey boxes until they arrive). */
  growing: boolean;
  onText: (t: string) => void;
  onSize: (s: Size) => void;
  onDesign: (patch: Partial<Design>) => void;
  onCelebrated: () => void;
  /** Photograph another letter (ch: the one to add, when known). */
  onAddMore: (ch?: string) => void;
}

/** Longest big words (letters, spaces and new lines). */
const MAX_WORDS = 80;

const WORDS = ['PIZZA', 'ROBOT', 'JELLY', 'ZOOM', 'HELLO', 'BANANA', 'QUIZ', 'DINOSAUR', 'WOW', 'YUMMY', 'PLAY TIME', 'SUPER STAR', 'MAGIC', 'JUMP', 'SPLASH', 'FOX AND OWL', 'ROCKET'];

/** The playground: type anything in the kid's own letters. */
export function TypeStep(p: Props) {
  const [party, setParty] = useState(false);
  const [word, setWord] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const missing = useMemo(() => [...new Set([...p.text].filter((c) => c.trim() && !lookup(p.map, c)))], [p.text, p.map]);
  // Words come out in the font's own case: capitals, small letters, or both.
  const hasUpper = p.keys.some((k) => /[A-Z]/.test(k)), hasLower = p.keys.some((k) => /[a-z]/.test(k));
  const caseWord = (w: string) => (hasLower && !hasUpper ? w.toLowerCase() : hasLower && hasUpper ? w.charAt(0) + w.slice(1).toLowerCase() : w);

  useEffect(() => input.current?.focus(), []);

  // The first time they type a word (2+ letters, then a short pause), throw a party.
  useEffect(() => {
    if (p.celebrated || p.text.trim().length < 2) return;
    const t = setTimeout(() => {
      setParty(true);
      p.onCelebrated();
    }, 1100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.text, p.celebrated]);

  const type = (s: string) => {
    p.onText((p.text + s).slice(0, MAX_WORDS));
    input.current?.focus();
  };

  return (
    <>
      <h1>
        <span className="tag">Play with your font!</span>
      </h1>
      <PosterEditor
        design={p.design}
        onDesign={p.onDesign}
        text={p.text || caseWord('PLAY')}
        map={p.map}
        size={p.size}
        onSize={p.onSize}
        themes={p.themes}
        table={p.table}
        words={
          <>
            <textarea
              ref={input}
              className="typebox"
              rows={2}
              value={p.text}
              maxLength={MAX_WORDS}
              placeholder="Type your name!"
              onChange={(e) => p.onText(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-label="Your big words: press Enter for a new line"
            />
            <div className="row tight">
              <button
                className="btn small yellow"
                onClick={() => {
                  p.onText(caseWord(WORDS[word % WORDS.length]));
                  setWord(word + 1);
                }}
              >
                🎲 Surprise me
              </button>
              <span className="help">Enter starts a new line. Or tap your letters under the picture.</span>
            </div>
          </>
        }
      />

      <div className="keyboard" aria-label="Your letters keyboard">
        {p.keys.map((k) => {
          const g = lookup(p.map, k);
          return (
            <button key={k} className="key" onClick={() => type(k)} aria-label={`Type ${k}`} disabled={!g}>
              {g ? <GlyphView glyph={g} size={52} /> : <span className="key-wait">{k}</span>}
            </button>
          );
        })}
        <button className="key wide" onClick={() => type(' ')} aria-label="Space">
          space
        </button>
        <button className="key wide" onClick={() => p.onText([...p.text].slice(0, -1).join(''))} aria-label="Delete the last letter">
          ⌫
        </button>
      </div>

      {missing.length > 0 && (
        <div className="missing" style={{ marginTop: 16 }}>
          <span>
            {p.growing ? 'Still coming: ' : 'Your font doesn’t have these, so they’re written by hand: '}
            <strong>{missing.join(' ')}</strong>
          </span>
          {!p.growing && (
            <button className="btn red" onClick={() => p.onAddMore()}>
              + Add more letters
            </button>
          )}
        </div>
      )}
      {party && <Celebrate text={p.text} map={p.map} onClose={() => setParty(false)} />}
    </>
  );
}

function Celebrate({ text, map, onClose }: { text: string; map: Map<string, LetterGlyph>; onClose: () => void }) {
  const bits = useMemo(
    () =>
      Array.from({ length: 70 }, (_, i) => ({
        left: (i * 37) % 100,
        delay: ((i * 13) % 12) / 10,
        dur: 2.2 + ((i * 7) % 20) / 10,
        colour: COLOURS[i % COLOURS.length],
        rot: (i * 53) % 360,
      })),
    [],
  );
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="celebrate" onClick={onClose} role="dialog" aria-label="You made a font!">
      {bits.map((b, i) => (
        <span
          key={i}
          className="confetti"
          style={{ left: `${b.left}%`, background: b.colour, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`, transform: `rotate(${b.rot}deg)` }}
        />
      ))}
      <div className="inner">
        <h2>You made a font! 🎉</h2>
        <TextRender className="word" text={text.trim()} map={map} maxWidth={4200} />
        <p style={{ fontSize: 24, fontWeight: 900 }}>Tap anywhere to keep going</p>
      </div>
    </div>
  );
}
