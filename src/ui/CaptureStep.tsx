import { useEffect, useRef, useState } from 'react';
import demoUrl from '../assets/demo-lego.jpg';
import { cleanWord } from '../state';

interface Props {
  /** True when re-running capture to add extra letters. */
  addingMore: boolean;
  busy: boolean;
  error: string | null;
  onPhoto: (blob: Blob, word: string) => void;
}

const canUseCamera = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;

export function CaptureStep({ addingMore, busy, error, onPhoto }: Props) {
  const [word, setWord] = useState(addingMore ? '' : 'PLAY');
  const [camera, setCamera] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ready = cleanWord(word).length > 0;

  if (busy) {
    return (
      <div className="busy">
        <div className="bounce">
          {[...(cleanWord(word) || 'PLAY').slice(0, 4)].map((c, i) => (
            <span key={i} style={{ background: ['var(--yellow)', 'var(--pink)', 'var(--blue)', 'var(--green)'][i % 4] }}>{c}</span>
          ))}
        </div>
        <h1>Finding your letters…</h1>
      </div>
    );
  }

  return (
    <>
      <h1>
        <span className="tag">{addingMore ? 'Add more letters' : 'Snap your letters'}</span>
      </h1>

      <div className="row" style={{ marginBottom: 10 }}>
        <label htmlFor="word" style={{ fontWeight: 900, fontSize: 24 }}>
          What does your photo spell?
        </label>
      </div>
      <input
        id="word"
        className="word-input"
        value={word}
        placeholder={addingMore ? 'e.g. SAM' : 'PLAY'}
        onChange={(e) => setWord(cleanWord(e.target.value))}
        autoComplete="off"
        spellCheck={false}
      />

      <div className="tips">
        <Tip colour="var(--yellow)" text="Plain table or paper behind">
          <rect x="6" y="6" width="44" height="44" rx="8" fill="white" stroke="#1b1b3a" strokeWidth="4" />
        </Tip>
        <Tip colour="var(--pink)" text="Leave gaps between letters">
          <>
            <rect x="4" y="16" width="14" height="24" rx="3" fill="#ff5d8f" stroke="#1b1b3a" strokeWidth="3" />
            <rect x="38" y="16" width="14" height="24" rx="3" fill="#3a86ff" stroke="#1b1b3a" strokeWidth="3" />
            <path d="M22 28h12M22 28l4-4M22 28l4 4M34 28l-4-4M34 28l-4 4" stroke="#1b1b3a" strokeWidth="3" fill="none" />
          </>
        </Tip>
        <Tip colour="var(--blue)" text="Hold the camera straight above">
          <>
            <rect x="14" y="4" width="28" height="18" rx="4" fill="#3a86ff" stroke="#1b1b3a" strokeWidth="3" />
            <path d="M28 24v14M22 32l6 6 6-6" stroke="#1b1b3a" strokeWidth="4" fill="none" />
            <rect x="6" y="42" width="44" height="10" rx="3" fill="#ffd23f" stroke="#1b1b3a" strokeWidth="3" />
          </>
        </Tip>
      </div>

      {error && <p className="card" style={{ background: 'var(--pink)' }}>{error}</p>}

      {camera ? (
        <Camera
          onShot={(b) => { setCamera(false); onPhoto(b, cleanWord(word)); }}
          onError={(msg) => { setCamera(false); setCamError(msg); }}
        />
      ) : (
        <div className="capture-grid">
          {canUseCamera() && (
            <button className="btn big pink" disabled={!ready} onClick={() => setCamera(true)}>
              <CameraIcon /> Take a photo
            </button>
          )}
          <button className="btn big yellow" disabled={!ready} onClick={() => fileRef.current?.click()}>
            <PhotoIcon /> Choose a photo
          </button>
          {!addingMore && (
            <button
              className="btn big"
              onClick={async () => {
                const blob = await (await fetch(demoUrl)).blob();
                setWord('PLAY');
                onPhoto(blob, 'PLAY');
              }}
            >
              Try the Lego demo
            </button>
          )}
        </div>
      )}
      {camError && <p>{camError}</p>}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onPhoto(f, cleanWord(word));
        }}
      />
    </>
  );
}

function Tip({ colour, text, children }: { colour: string; text: string; children: React.ReactNode }) {
  return (
    <div className="tip card" style={{ background: colour === 'var(--blue)' ? '#d7e6ff' : 'white' }}>
      <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden>{children}</svg>
      {text}
    </div>
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
const PhotoIcon = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
    <rect x="3" y="5" width="34" height="30" rx="5" fill="white" stroke="#1b1b3a" strokeWidth="3" />
    <path d="M6 30l10-11 8 8 5-5 8 8" fill="#06d6a0" stroke="#1b1b3a" strokeWidth="3" />
    <circle cx="28" cy="13" r="4" fill="#ffd23f" stroke="#1b1b3a" strokeWidth="2" />
  </svg>
);
