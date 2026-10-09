import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { tableColour } from './backdrop';
import { glyphMap } from './font';
import { useAlphabet } from './grow';
import { warmPictures } from './pictures';
import { processPhoto } from './photo';
import { GROW_STEPS, initialState, inWordOrder, reducer, STEPS, type Letter, type Step } from './state';
import { newFeedbackSession } from './feedback';
import { CaptureStep } from './ui/CaptureStep';
import { CleanStep } from './ui/CleanStep';
import { ExportStep } from './ui/ExportStep';
import { FeedbackButton } from './ui/Feedback';
import { GrowStep } from './ui/GrowStep';
import { RoomView } from './ui/RoomView';
import { SplitStep } from './ui/SplitStep';
import { TypeStep } from './ui/TypeStep';

const LABELS: Record<Step, string> = { capture: 'Snap', split: 'Match', clean: 'Neaten', grow: 'A–Z', type: 'Play', export: 'Save' };
/** Each part's name as the kid sees it, for feedback. */
const PART_NAMES: Record<Step | 'add', string> = {
  capture: 'Snap your letters',
  add: 'Add a letter',
  split: 'Match your letters',
  clean: 'Neaten your letters',
  grow: 'Your whole A–Z',
  type: 'Play with your font',
  export: 'Save your font',
};
const COLOURS: Record<Step, string> = {
  capture: 'var(--yellow)',
  split: 'var(--red)',
  clean: 'var(--blue)',
  grow: 'var(--green)',
  type: 'var(--yellow)',
  export: 'var(--red)',
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
  // null: snapping the word. '': adding a letter, not chosen yet. 'K': adding that letter.
  const [adding, setAdding] = useState<string | null>(null);

  // The letters the kid made, then the whole font: grown letters with the kid's own on top.
  const captured = useMemo(() => glyphMap(s.letters, s.photos), [s.letters, s.photos]);
  const alphabet = useAlphabet(captured, s.letters, s.photos, s.seeds, GROW_STEPS.includes(s.step), s.mix, s.alphabet);
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
  // Letters photographed one at a time are already matched, so Match is skipped.
  const skipMatch = s.photos.length > 0 && s.photos.every((p) => [...p.word].length === 1);
  const prevStep = s.step === 'clean' && skipMatch ? 'capture' : STEPS[Math.max(0, idx - 1)];
  const nextStep = s.step === 'capture' && skipMatch ? 'clean' : STEPS[idx + 1];

  const go = (step: Step) => {
    dispatch({ type: 'go', step });
    window.scrollTo(0, 0);
  };
  const setLetters = (photoId: string, next: Letter[], record = true) =>
    dispatch({ type: 'letters', letters: [...s.letters.filter((l) => l.photoId !== photoId), ...next], record });
  const onCelebrated = useCallback(() => dispatch({ type: 'celebrated' }), []);

  const onPhoto = async (blob: Blob, word: string, theme?: string) => {
    setBusy(true);
    setError(null);
    try {
      const { photo: p0, letters } = await processPhoto(blob, word);
      // A letter photographed on its own keeps the theme it was tagged with (or its old photo's tag).
      const old = s.photos.find((ph) => ph.word === word);
      const p = { ...p0, theme: theme ?? old?.theme };
      // Letters photographed one at a time stay on Snap until the kid has all they want. A new photo
      // of the same letters (or the whole word again) takes the place of the old one.
      const stay = adding === null && [...word].length === 1;
      const replaces = s.photos.filter((ph) => ph.word === word).map((ph) => ph.id);
      dispatch({ type: 'addPhoto', photo: p, letters, replaces, stay });
      if (!stay) setAdding(null);
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

  const addMore = (ch?: string) => {
    setAdding(ch ?? '');
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
    s.step === 'capture' ? s.photos.length > 0 && adding === null
    : s.step === 'split' ? s.letters.some((l) => l.char)
    : s.step === 'clean' ? captured.size > 0
    : s.step === 'grow' || s.step === 'type';

  // Default the maker's name to the first word they typed.
  const maker = s.maker || (s.text.trim().split(/\s+/)[0] ?? '').slice(0, 30);

  return (
    <div className="app" style={{ ['--step' as string]: COLOURS[s.step] }}>
      <header className="topbar">
        <div className="brand" aria-label="Photo to Font Station">
          {['P', 'L', 'A', 'Y'].map((c, i) => (
            <span key={c} style={{ background: ['var(--yellow)', 'var(--red)', 'var(--blue)', 'var(--green)'][i] }}>{c}</span>
          ))}
          <span style={{ color: 'white', background: 'none' }}>font station</span>
        </div>
        <nav className="progress" aria-label="Steps">
          {STEPS.map((st, i) => (
            <div key={st} className={`dot ${i <= idx ? 'on' : ''} ${i === idx ? 'now' : ''} ${st === 'split' && skipMatch ? 'skipped' : ''}`} style={{ background: COLOURS[st], color: 'var(--ink)' }} aria-current={i === idx ? 'step' : undefined}>
              {i + 1}
              <span className="lbl">{LABELS[st]}</span>
            </div>
          ))}
        </nav>
      </header>

      <main className="step">
        {s.step === 'capture' && <CaptureStep
            key={adding ?? 'word'}
            photos={s.photos}
            adding={adding}
            busy={busy}
            error={error}
            onPhoto={onPhoto}
            onTag={(photoId, theme) => dispatch({ type: 'tagPhoto', photoId, theme })}
          />}
        {s.step === 'split' && photo && (
          <SplitStep
            photo={photo}
            letters={photoLetters}
            onChange={(ls) => setLetters(photo.id, ls)}
            photos={s.photos}
            allLetters={s.letters}
            onShow={(photoId) => dispatch({ type: 'showPhoto', photoId })}
          />
        )}
        {s.step === 'clean' && (
          <CleanStep photos={s.photos} currentPhotoId={s.currentPhotoId} letters={s.letters} map={captured} onChange={(ls, record) => dispatch({ type: 'letters', letters: ls, record })} />
        )}
        {s.step === 'grow' && (
          <GrowStep
            alphabet={alphabet}
            captured={captured}
            onMix={(mix) => dispatch({ type: 'mix', mix })}
            onAlphabet={(alphabet) => dispatch({ type: 'alphabet', alphabet })}
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
            design={s.design}
            themes={alphabet.themes.map((t) => t.id)}
            table={table}
            growing={alphabet.done < alphabet.total}
            onText={(t) => dispatch({ type: 'text', text: t })}
            onSize={(size) => dispatch({ type: 'size', size })}
            onDesign={(patch) => dispatch({ type: 'design', patch })}
            onCelebrated={onCelebrated}
            onAddMore={addMore}
          />
        )}
        {s.step === 'export' && (
          <ExportStep
            text={s.text}
            map={map}
            captured={captured}
            design={s.design}
            size={s.size}
            fontName={s.fontName}
            maker={maker}
            onFontName={(n) => dispatch({ type: 'fontName', name: n })}
            onMaker={(n) => dispatch({ type: 'maker', name: n })}
            onAddMore={addMore}
            onStartOver={() => {
              setAdding(null);
              newFeedbackSession();
              dispatch({ type: 'reset' });
            }}
          />
        )}
      </main>

      {!busy && (
        <footer className="navbar">
          <button
            className="btn"
            disabled={idx === 0 && adding === null}
            onClick={() => {
              if (s.step === 'capture' && adding !== null) {
                setAdding(null);
                go(s.photos.length ? 'type' : 'capture');
              } else go(prevStep);
            }}
          >
            ◀ Back
          </button>
          <button className="btn" disabled={!s.past.length} onClick={() => dispatch({ type: 'undo' })} aria-label="Undo">
            ↶ Undo
          </button>
          <span className="spacer" />
          <FeedbackButton
            part={s.step === 'capture' && adding !== null ? 'add' : s.step}
            label={PART_NAMES[s.step === 'capture' && adding !== null ? 'add' : s.step]}
            context={s.photos.length ? (skipMatch ? 'one letter at a time' : 'whole word photo') : undefined}
          />
          {s.step !== 'export' && (
            <button
              className="btn next"
              disabled={!canNext}
              onClick={() => {
                if (s.step === 'capture' && s.photos.length > 1) dispatch({ type: 'showPhoto', photoId: inWordOrder(s.photos)[0].id });
                go(nextStep);
              }}
            >
              Next ▶
            </button>
          )}
        </footer>
      )}
    </div>
  );
}
