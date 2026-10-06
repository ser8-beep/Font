import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { backdropColour, tableColour } from './backdrop';
import { glyphMap } from './font';
import { useAlphabet } from './grow';
import { warmPictures } from './pictures';
import { processPhoto } from './photo';
import { GROW_STEPS, initialState, reducer, STEPS, type Letter, type Step } from './state';
import { CaptureStep } from './ui/CaptureStep';
import { CleanStep } from './ui/CleanStep';
import { ExportStep } from './ui/ExportStep';
import { GrowStep } from './ui/GrowStep';
import { RoomView } from './ui/RoomView';
import { SplitStep } from './ui/SplitStep';
import { TypeStep } from './ui/TypeStep';

const LABELS: Record<Step, string> = { capture: 'Snap', split: 'Check', clean: 'Neaten', grow: 'A–Z', type: 'Play', export: 'Save' };
const COLOURS: Record<Step, string> = {
  capture: 'var(--yellow)',
  split: 'var(--pink)',
  clean: 'var(--blue)',
  grow: 'var(--purple)',
  type: 'var(--green)',
  export: 'var(--orange)',
};

export default function App() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const h = () => setHash(location.hash);
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  if (hash === '#room') return <RoomView />;
  return <Station />;
}

function Station() {
  const [s, dispatch] = useReducer(reducer, initialState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingMore, setAddingMore] = useState(false);

  // The letters the kid made, then the whole font: grown letters with the kid's own on top.
  const captured = useMemo(() => glyphMap(s.letters, s.photos), [s.letters, s.photos]);
  const alphabet = useAlphabet(captured, s.letters, s.photos, s.seeds, GROW_STEPS.includes(s.step), s.category);
  const map = useMemo(() => new Map([...alphabet.grown, ...captured]), [alphabet.grown, captured]);
  // Once the alphabet is finished, quietly start on the font's photo letters for the Save step.
  const finished = alphabet.done >= alphabet.total;
  useEffect(() => {
    if ((s.step === 'type' || s.step === 'export') && finished) warmPictures(map.values());
  }, [s.step, finished, map]);
  const table = tableColour(s.photos[0] ?? null);
  const photo = s.photos.find((p) => p.id === s.currentPhotoId) ?? null;
  const photoLetters = s.letters.filter((l) => l.photoId === s.currentPhotoId);
  const idx = STEPS.indexOf(s.step);

  const go = (step: Step) => {
    dispatch({ type: 'go', step });
    window.scrollTo(0, 0);
  };
  const setLetters = (photoId: string, next: Letter[], record = true) =>
    dispatch({ type: 'letters', letters: [...s.letters.filter((l) => l.photoId !== photoId), ...next], record });
  const onCelebrated = useCallback(() => dispatch({ type: 'celebrated' }), []);

  const onPhoto = async (blob: Blob, word: string) => {
    setBusy(true);
    setError(null);
    try {
      const { photo: p, letters } = await processPhoto(blob, word);
      dispatch({ type: 'addPhoto', photo: p, letters });
      setAddingMore(false);
      window.scrollTo(0, 0);
    } catch (e) {
      console.error(e);
      const name = 'name' in blob ? String((blob as File).name) : '';
      setError(
        /hei[cf]/i.test(blob.type + name)
          ? 'This is an iPhone HEIC photo, which Chrome cannot open. Send it as a JPEG instead (on the iPhone: Settings → Camera → Formats → Most Compatible).'
          : "Hmm, that photo didn't work. Try another one!",
      );
    } finally {
      setBusy(false);
    }
  };

  const addMore = () => {
    setAddingMore(true);
    go('capture');
  };

  // Keyboard undo for the facilitator (Ctrl/Cmd+Z outside text boxes).
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !(t instanceof HTMLInputElement)) {
        e.preventDefault();
        dispatch({ type: 'undo' });
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const canNext =
    s.step === 'capture' ? !!photo && !addingMore
    : s.step === 'split' ? photoLetters.some((l) => l.char)
    : s.step === 'clean' ? captured.size > 0
    : s.step === 'grow' || s.step === 'type';

  // Default the maker's name to the first word they typed.
  const maker = s.maker || (s.text.trim().split(/\s+/)[0] ?? '').slice(0, 30);

  return (
    <div className="app" style={{ ['--step' as string]: COLOURS[s.step] }}>
      <header className="topbar">
        <div className="brand" aria-label="Photo to Font Station">
          {['P', 'L', 'A', 'Y'].map((c, i) => (
            <span key={c} style={{ background: ['var(--yellow)', 'var(--pink)', 'var(--blue)', 'var(--green)'][i] }}>{c}</span>
          ))}
          <span style={{ color: 'white', background: 'none' }}>font station</span>
        </div>
        <nav className="progress" aria-label="Steps">
          {STEPS.map((st, i) => (
            <div key={st} className={`dot ${i <= idx ? 'on' : ''} ${i === idx ? 'now' : ''}`} style={{ background: COLOURS[st], color: 'var(--ink)' }} aria-current={i === idx ? 'step' : undefined}>
              {i + 1}
              <span className="lbl">{LABELS[st]}</span>
            </div>
          ))}
        </nav>
      </header>

      <main className="step">
        {s.step === 'capture' && <CaptureStep addingMore={addingMore} busy={busy} error={error} onPhoto={onPhoto} />}
        {s.step === 'split' && photo && <SplitStep photo={photo} letters={photoLetters} onChange={(ls) => setLetters(photo.id, ls)} />}
        {s.step === 'clean' && (
          <CleanStep photos={s.photos} currentPhotoId={s.currentPhotoId} letters={s.letters} map={captured} onChange={(ls, record) => dispatch({ type: 'letters', letters: ls, record })} />
        )}
        {s.step === 'grow' && (
          <GrowStep
            alphabet={alphabet}
            captured={captured}
            chosen={s.category}
            onCategory={(category) => dispatch({ type: 'category', category })}
            onReroll={(ch) => dispatch({ type: 'reroll', char: ch })}
            onAddMore={addMore}
          />
        )}
        {s.step === 'type' && (
          <TypeStep
            text={s.text}
            map={map}
            keys={alphabet.chars}
            celebrated={s.celebrated}
            size={s.size}
            backdrop={s.backdrop}
            table={table}
            growing={alphabet.done < alphabet.total}
            onText={(t) => dispatch({ type: 'text', text: t })}
            onSize={(size) => dispatch({ type: 'size', size })}
            onBackdrop={(backdrop) => dispatch({ type: 'backdrop', backdrop })}
            onCelebrated={onCelebrated}
            onAddMore={addMore}
          />
        )}
        {s.step === 'export' && (
          <ExportStep
            text={s.text}
            map={map}
            captured={captured}
            backdrop={backdropColour(s.backdrop === 'white' ? 'yellow' : s.backdrop, table)}
            fontName={s.fontName}
            maker={maker}
            onFontName={(n) => dispatch({ type: 'fontName', name: n })}
            onMaker={(n) => dispatch({ type: 'maker', name: n })}
            onAddMore={addMore}
            onStartOver={() => {
              setAddingMore(false);
              dispatch({ type: 'reset' });
            }}
          />
        )}
      </main>

      {!busy && (
        <footer className="navbar">
          <button
            className="btn"
            disabled={idx === 0 && !addingMore}
            onClick={() => {
              if (s.step === 'capture' && addingMore) {
                setAddingMore(false);
                go(s.photos.length ? 'type' : 'capture');
              } else go(STEPS[Math.max(0, idx - 1)]);
            }}
          >
            ◀ Back
          </button>
          <button className="btn" disabled={!s.past.length} onClick={() => dispatch({ type: 'undo' })} aria-label="Undo">
            ↶ Undo
          </button>
          <span className="spacer" />
          {s.step !== 'export' && (
            <button className="btn next" disabled={!canNext} onClick={() => go(STEPS[idx + 1])}>
              Next ▶
            </button>
          )}
        </footer>
      )}
    </div>
  );
}
