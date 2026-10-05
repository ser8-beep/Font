import { useEffect, useMemo, useRef, useState } from 'react';
import type { LetterGlyph } from '../font';
import { COLOURS } from './SplitStep';
import { TextRender } from './TextRender';

interface Props {
  text: string;
  map: Map<string, LetterGlyph>;
  material: boolean;
  celebrated: boolean;
  onText: (t: string) => void;
  onMaterial: (on: boolean) => void;
  onCelebrated: () => void;
  onAddMore: () => void;
}

export function MaterialToggle({ material, onMaterial }: { material: boolean; onMaterial: (on: boolean) => void }) {
  return (
    <div className="row" role="group" aria-label="Letter style">
      <button className={`btn small ${material ? '' : 'on'}`} onClick={() => onMaterial(false)} aria-pressed={!material}>
        Ink letters
      </button>
      <button className={`btn small ${material ? 'on' : ''}`} onClick={() => onMaterial(true)} aria-pressed={material}>
        Photo letters
      </button>
    </div>
  );
}

export function TypeStep({ text, map, material, celebrated, onText, onMaterial, onCelebrated, onAddMore }: Props) {
  const [party, setParty] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const missing = useMemo(() => [...new Set([...text.toUpperCase()].filter((c) => c.trim() && !map.has(c)))], [text, map]);

  useEffect(() => input.current?.focus(), []);

  // The first time they type a word (2+ letters, then a short pause), throw a party.
  useEffect(() => {
    if (celebrated || text.trim().length < 2) return;
    const t = setTimeout(() => {
      setParty(true);
      onCelebrated();
    }, 1100);
    return () => clearTimeout(t);
  }, [text, celebrated, onCelebrated]);

  return (
    <>
      <h1>
        <span className="tag">Type with your font!</span>
      </h1>
      <input
        ref={input}
        className="typebox"
        value={text}
        maxLength={60}
        placeholder="Type your name!"
        onChange={(e) => onText(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        aria-label="Type here"
      />
      <div className="render">
        <TextRender text={text || 'PLAY'} map={map} material={material} caret={!!text} />
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <MaterialToggle material={material} onMaterial={onMaterial} />
      </div>
      {missing.length > 0 && (
        <div className="missing" style={{ marginTop: 16 }}>
          <span>
            Grey boxes are letters you haven't made yet: <strong>{missing.join(' ')}</strong>
          </span>
          <button className="btn pink" onClick={onAddMore}>
            + Add more letters
          </button>
        </div>
      )}
      {party && <Celebrate text={text} map={map} material={material} onClose={() => setParty(false)} />}
    </>
  );
}

function Celebrate({ text, map, material, onClose }: { text: string; map: Map<string, LetterGlyph>; material: boolean; onClose: () => void }) {
  const bits = useMemo(
    () =>
      Array.from({ length: 70 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 1.2,
        dur: 2.2 + Math.random() * 2,
        colour: COLOURS[i % COLOURS.length],
        rot: Math.random() * 360,
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
        <TextRender className="word" text={text.trim()} map={map} material={material} maxWidth={4200} />
        <p style={{ fontSize: 24, fontWeight: 900 }}>Tap anywhere to keep going</p>
      </div>
    </div>
  );
}
