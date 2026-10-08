import { useEffect, useRef, useState } from 'react';
import demoUrl from '../assets/demo-lego.jpg';
import { dataUrlToBlob, inClaudeViewer } from '../host';
import { WORD, type Photo } from '../state';
import { CATEGORY_IDS, CATEGORY_LABELS } from '../core/alphabet/category';
import { letterColour } from './SplitStep';

interface Props {
  /** Photos taken so far, to show which letters of the word already have one. */
  photos: Photo[];
  /** null: snapping the word. '': adding a letter, not chosen yet. 'K': adding that letter. */
  adding: string | null;
  busy: boolean;
  error: string | null;
  /** word: what the photo holds, the whole WORD or the one letter it was taken for; theme: its tag. */
  onPhoto: (blob: Blob, word: string, theme?: string) => void;
  /** Tag a photo already taken with a theme (null: not sure). */
  onTag: (photoId: string, theme: string | null) => void;
}

/** A theme for one letter: what it is made of. "Not sure" leaves it to the app. */
function ThemePick({ value, onChange, label }: { value: string | null; onChange: (theme: string | null) => void; label: string }) {
  return (
    <label className="theme-pick">
      <span className="sr-only">{label}</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} aria-label={label}>
        <option value="">🤔 Theme: not sure</option>
        {CATEGORY_IDS.map((id) => (
          <option key={id} value={id}>
            {CATEGORY_LABELS[id].emoji} {CATEGORY_LABELS[id].label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** One photo of the whole word, or one photo per letter. */
type Mode = 'word' | 'letters';

// The claude.ai viewer refuses camera access, so only offer it on a normal web page.
const canUseCamera = () => !inClaudeViewer && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
const ALPHABET = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

export function CaptureStep({ photos, adding, busy, error, onPhoto, onTag }: Props) {
  // Themes picked for letters not photographed yet (a photo keeps its own tag once taken).
  const [slotTheme, setSlotTheme] = useState<Record<string, string | null>>({});
  const [mode, setMode] = useState<Mode>(photos.some((p) => [...p.word].length === 1) ? 'letters' : 'word');
  const [addLetter, setAddLetter] = useState(adding ?? '');
  // The camera is open for this word or letter.
  const [camera, setCamera] = useState<string | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [pending, setPending] = useState(WORD);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickFor = useRef(WORD);

  const photoOf = (c: string) => [...photos].reverse().find((p) => p.word === c);
  const done = [...WORD].filter((c) => photoOf(c)).length;
  // Where a photo that arrives without a button (dropped, pasted) goes: the word, the letter being
  // added, or the first letter of the word still without a photo.
  const target = adding !== null ? addLetter || null : mode === 'word' ? WORD : [...WORD].find((c) => !photoOf(c)) ?? null;

  const send = (f: Blob | null | undefined, word: string | null) => {
    if (!f) return;
    if (f.type && !f.type.startsWith('image/')) {
      setHint("That isn't a photo. Try a .jpg or .png picture.");
      return;
    }
    if (!word) {
      setHint(adding !== null ? 'First tap the letter you are photographing.' : 'Every letter has a photo. Tap Change under a letter to swap its photo.');
      return;
    }
    setHint(null);
    setPending(word);
    onPhoto(f, word, [...word].length === 1 ? (slotTheme[word] ?? undefined) : undefined);
  };
  const take = (f: Blob | null | undefined) => send(f, target);
  const takeRef = useRef(take);
  takeRef.current = take;
  const choose = (word: string) => {
    pickFor.current = word;
    fileRef.current?.click();
  };

  // Drop a photo anywhere on the page, or paste one (Ctrl+V).
  useEffect(() => {
    if (busy) return;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragOver(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragOver(false);
      takeRef.current(e.dataTransfer!.files[0]);
    };
    const paste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      if (!item) return;
      e.preventDefault();
      takeRef.current(item.getAsFile());
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('paste', paste);
    };
  }, [busy]);

  if (busy) {
    return (
      <div className="busy">
        <div className="bounce">
          {[...pending].map((c, i) => (
            <span key={i} style={{ background: letterColour(c) }}>{c}</span>
          ))}
        </div>
        <h1>{[...pending].length > 1 ? 'Finding your letters…' : `Finding your ${pending}…`}</h1>
      </div>
    );
  }

  const photoButtons = (word: string, label: string) => (
    <div className="capture-grid">
      {canUseCamera() && (
        <button className="btn big pink" onClick={() => setCamera(word)}>
          <CameraIcon /> Take a photo{label}
        </button>
      )}
      <button className="btn big yellow" onClick={() => choose(word)}>
        <PhotoIcon /> Choose a photo{label}
      </button>
      {word === WORD && adding === null && (
        <button
          className="btn big"
          onClick={async () => {
            const blob = demoUrl.startsWith('data:') ? dataUrlToBlob(demoUrl) : await (await fetch(demoUrl)).blob();
            send(blob, WORD);
          }}
        >
          Try the Lego demo
        </button>
      )}
      <button className="dropzone" onClick={() => choose(word)}>
        <DropIcon />
        Or drag your photo here
      </button>
    </div>
  );

  return (
    <>
      <h1>
        <span className="tag">{adding !== null ? 'Add a letter' : 'Snap your letters'}</span>
      </h1>

      {adding === null ? (
        <>
          <p className="lead">
            Build{' '}
            <span className="word-chips" aria-label={WORD}>
              {[...WORD].map((c) => (
                <b key={c} style={{ background: letterColour(c) }}>{c}</b>
              ))}
            </span>{' '}
            out of things you find, then take a photo.
          </p>
          <p className="section-label" id="mode-title">How will you take it?</p>
          <div className="mode-switch" role="group" aria-labelledby="mode-title">
            <button className={mode === 'word' ? 'on' : ''} aria-pressed={mode === 'word'} onClick={() => setMode('word')}>
              All four letters in one photo
            </button>
            <button className={mode === 'letters' ? 'on' : ''} aria-pressed={mode === 'letters'} onClick={() => setMode('letters')}>
              One letter at a time
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="lead">Which letter are you photographing?</p>
          <div className="letter-choices">
            {ALPHABET.map((c) => (
              <button key={c} className={addLetter === c ? 'on' : ''} aria-pressed={addLetter === c} style={addLetter === c ? { background: letterColour(c) } : undefined} onClick={() => setAddLetter(c)}>
                {c}
              </button>
            ))}
          </div>
          {addLetter && (
            <div className="row" style={{ marginTop: 12 }}>
              <span style={{ fontWeight: 800 }}>What is your {addLetter} made of?</span>
              <ThemePick value={slotTheme[addLetter] ?? null} onChange={(t) => setSlotTheme({ ...slotTheme, [addLetter]: t })} label={`Theme for your ${addLetter}`} />
            </div>
          )}
        </>
      )}

      {/* Tips are information, not buttons: a flat panel with no outline or shadow. */}
      <section className="tips" aria-labelledby="tips-title">
        <h2 id="tips-title">Tips for a good photo</h2>
        <ul>
          <Tip text="Plain table or paper behind">
            <rect x="6" y="6" width="44" height="44" rx="8" fill="white" stroke="#1b1b3a" strokeWidth="4" />
          </Tip>
          <Tip text={mode === 'letters' || adding !== null ? 'Fill the photo with your letter' : 'Leave gaps between letters'}>
            <>
              <rect x="4" y="16" width="14" height="24" rx="3" fill="#ff5d8f" stroke="#1b1b3a" strokeWidth="3" />
              <rect x="38" y="16" width="14" height="24" rx="3" fill="#3a86ff" stroke="#1b1b3a" strokeWidth="3" />
              <path d="M22 28h12M22 28l4-4M22 28l4 4M34 28l-4-4M34 28l-4 4" stroke="#1b1b3a" strokeWidth="3" fill="none" />
            </>
          </Tip>
          <Tip text="Hold the camera straight above">
            <>
              <rect x="14" y="4" width="28" height="18" rx="4" fill="#3a86ff" stroke="#1b1b3a" strokeWidth="3" />
              <path d="M28 24v14M22 32l6 6 6-6" stroke="#1b1b3a" strokeWidth="4" fill="none" />
              <rect x="6" y="42" width="44" height="10" rx="3" fill="#ffd23f" stroke="#1b1b3a" strokeWidth="3" />
            </>
          </Tip>
        </ul>
      </section>

      {(hint || error) && <p className="card" style={{ background: 'var(--pink)' }}>{hint || error}</p>}

      {camera ? (
        <Camera
          onShot={(b) => { const w = camera; setCamera(null); send(b, w); }}
          onError={(msg) => { setCamera(null); setCamError(msg); }}
        />
      ) : adding !== null ? (
        addLetter && photoButtons(addLetter, ` of ${addLetter}`)
      ) : mode === 'word' ? (
        photoButtons(WORD, '')
      ) : (
        <>
          <div className="slots">
            {[...WORD].map((c) => {
              const p = photoOf(c);
              return (
                <div key={c} className="slot card">
                  <span className="slot-letter" style={{ background: letterColour(c) }}>{c}</span>
                  <div className="slot-pic">{p ? <img src={p.url} alt={`Your ${c}`} /> : <span>No photo yet</span>}</div>
                  <ThemePick
                    value={p ? (p.theme ?? null) : (slotTheme[c] ?? null)}
                    onChange={(t) => (p ? onTag(p.id, t) : setSlotTheme({ ...slotTheme, [c]: t }))}
                    label={`Theme for ${c}`}
                  />
                  <div className="slot-buttons">
                    {canUseCamera() && (
                      <button className="btn small pink" aria-label={`Take a photo of ${c}`} onClick={() => setCamera(c)}>
                        Take
                      </button>
                    )}
                    <button className="btn small yellow" aria-label={`${p ? 'Change the' : 'Choose a'} photo of ${c}`} onClick={() => choose(c)}>
                      {p ? 'Change' : 'Choose'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <p>
            <strong>{done} of {WORD.length}</strong> letters photographed.{' '}
            {done < WORD.length ? 'Skip any you didn\'t make: they come from the A–Z.' : 'Press Next to see them.'}
          </p>
        </>
      )}
      {camError && <p>{camError}</p>}
      {/* No `capture` attribute: phones then offer both "take photo" and "pick from gallery". */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          send(f, pickFor.current);
        }}
      />
      {dragOver && (
        <div className="drop-overlay" aria-hidden>
          <div>
            <DropIcon />
            {target && [...target].length === 1 ? `Drop your ${target}!` : 'Drop your photo!'}
          </div>
        </div>
      )}
    </>
  );
}

function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <li className="tip">
      <svg width="40" height="40" viewBox="0 0 56 56" aria-hidden>{children}</svg>
      {text}
    </li>
  );
}

function Camera({ onShot, onError }: { onShot: (b: Blob) => void; onError: (msg: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;

  useEffect(() => {
    let stopped = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          video.current.play().catch(() => {});
        }
      })
      .catch(() => errorRef.current("We couldn't open the camera. Try \"Choose a photo\" instead."));
    return () => {
      stopped = true;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const shoot = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    c.toBlob((b) => b && onShot(b), 'image/jpeg', 0.92);
  };

  return (
    <div className="camera">
      <video ref={video} playsInline muted />
      <button className="shutter" aria-label="Take the photo" onClick={shoot} />
    </div>
  );
}

const CameraIcon = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
    <rect x="3" y="10" width="34" height="24" rx="5" fill="white" stroke="#1b1b3a" strokeWidth="3" />
    <circle cx="20" cy="22" r="7" fill="#3a86ff" stroke="#1b1b3a" strokeWidth="3" />
    <rect x="13" y="5" width="14" height="6" rx="2" fill="#1b1b3a" />
  </svg>
);
const DropIcon = () => (
  <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden>
    <rect x="4" y="18" width="40" height="26" rx="6" fill="white" stroke="#1b1b3a" strokeWidth="3" strokeDasharray="6 4" />
    <path d="M24 4v24M15 19l9 9 9-9" stroke="#1b1b3a" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const PhotoIcon = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
    <rect x="3" y="5" width="34" height="30" rx="5" fill="white" stroke="#1b1b3a" strokeWidth="3" />
    <path d="M6 30l10-11 8 8 5-5 8 8" fill="#06d6a0" stroke="#1b1b3a" strokeWidth="3" />
    <circle cx="28" cy="13" r="4" fill="#ffd23f" stroke="#1b1b3a" strokeWidth="2" />
  </svg>
);
