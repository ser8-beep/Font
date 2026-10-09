import { strToU8, zipSync } from 'fflate';
import { useEffect, useState } from 'react';
import { buildFont, materialCanvas, safeFileName, type LetterGlyph } from '../font';
import { inClaudeViewer, saveFile, type SaveOutcome } from '../host';
import { fontPictures, warmPictures } from '../pictures';
import { FeedbackForm } from './Feedback';
import { designCanvas, designReady, frameOf, type Design } from '../design';
import type { Size } from '../state';
import { fetchRoom, roomBase, saveRoomBase, submitToRoom } from '../room';

interface Props {
  text: string;
  /** The whole font: the kid's letters and the grown ones. */
  map: Map<string, LetterGlyph>;
  /** Only the letters the kid made (these go to the room wall). */
  captured: Map<string, LetterGlyph>;
  /** Poster background colour. */
  /** The poster designed in the playground. */
  design: Design;
  size: Size;
  fontName: string;
  maker: string;
  onFontName: (n: string) => void;
  onMaker: (n: string) => void;
  /** Photograph another letter (ch: the one to add, when known). */
  onAddMore: (ch?: string) => void;
  onStartOver: () => void;
}

export function ExportStep(p: Props) {
  const [poster, setPoster] = useState<string | null>(null);
  const [fontSave, setFontSave] = useState<SaveOutcome | null>(null);
  const [posterSave, setPosterSave] = useState<SaveOutcome | null>(null);
  const [lettersSave, setLettersSave] = useState<SaveOutcome | null>(null);
  /** Letters done while the font is being made (null = not making it right now). */
  const [making, setMaking] = useState<{ done: number; total: number } | null>(null);
  const [packing, setPacking] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const name = p.fontName || (p.maker ? `${p.maker}'s Font` : 'My Font');

  // Start on the font's photo letters straight away, so saving is quick.
  useEffect(() => warmPictures(p.map.values()), [p.map]);

  const [withName, setWithName] = useState(true);
  const frame = frameOf(p.design);
  const caption = withName ? `${name}${p.maker ? ` · by ${p.maker}` : ''}` : undefined;
  const posterOf = (width?: number) => designCanvas(p.design, { text: p.text, map: p.map, size: p.size, caption }, width);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => designReady(p.design).then(() => live && setPoster(posterOf(900).toDataURL('image/jpeg', 0.9))), 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.text, p.map, p.size, p.design, caption]);

  const saveFont = async () => {
    if (making) return;
    setMaking({ done: 0, total: p.map.size });
    try {
      const pictures = await fontPictures([...p.map.values()], (done, total) => setMaking({ done, total }));
      const ttf = buildFont(p.map, name, p.maker, pictures);
      setFontSave(await saveFile(new Blob([ttf as BlobPart], { type: 'font/ttf' }), `${safeFileName(name)}.ttf`));
    } catch (e) {
      setFontSave(broke(e));
    } finally {
      setMaking(null);
    }
  };
  const saveLetters = async () => {
    if (packing) return;
    setPacking(true);
    try {
      const files: Record<string, Uint8Array> = {};
      for (const [ch, g] of p.map) {
        const blob = await new Promise<Blob | null>((res) => materialCanvas(g).toBlob(res, 'image/png'));
        if (blob) files[`${letterFileName(ch)}.png`] = new Uint8Array(await blob.arrayBuffer());
      }
      files['How to use.txt'] = strToU8(
        `These are the letters of ${name}, as pictures with see-through backgrounds.\r\n` +
          `Drag them into Canva, Google Docs, Google Slides or PowerPoint and line them up to spell anything.\r\n`,
      );
      setLettersSave(await saveFile(new Blob([zipSync(files) as BlobPart], { type: 'application/zip' }), `${safeFileName(name)} letters.zip`));
    } catch (e) {
      setLettersSave(broke(e));
    } finally {
      setPacking(false);
    }
  };
  const savePoster = async () => {
    try {
      // Full size: a wallpaper for the screen it's for, a print-ready A4 or A3, or the invitation.
      await designReady(p.design);
      const c = posterOf();
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
      c.width = c.height = 0;
      setPosterSave(blob ? await saveFile(blob, `${safeFileName(name)} ${frame.label.toLowerCase()}.png`) : { kind: 'failed', why: 'the poster picture could not be made' });
    } catch (e) {
      setPosterSave(broke(e));
    }
  };

  return (
    <>
      <h1>
        <span className="tag">Take it home</span>
      </h1>
      <div className="export-grid">
        <div className="card">
          <label htmlFor="maker" style={{ fontWeight: 900 }}>Your name</label>
          <input id="maker" className="name-input" value={p.maker} maxLength={30} onChange={(e) => p.onMaker(e.target.value)} placeholder="Sam" />
          <div style={{ height: 14 }} />
          <label htmlFor="fontname" style={{ fontWeight: 900 }}>Your font's name</label>
          <input id="fontname" className="name-input" value={p.fontName} maxLength={40} onChange={(e) => p.onFontName(e.target.value)} placeholder={name} />
          <div className="row" style={{ marginTop: 18 }}>
            <button className="btn big green" onClick={saveFont} disabled={p.map.size === 0 || !!making}>
              {making ? `Making your font… ${making.done} of ${making.total}` : '⬇ Save my font'}
            </button>
          </div>
          <p className="help">
            {fontSave && <SaveNote outcome={fontSave} />}Your font types your photo letters. To install it: open <strong>{safeFileName(name)}.ttf</strong> from Downloads, then
            press <strong>Install</strong>. Then pick it in Pages, Keynote, Word or PowerPoint. If an app shows plain shapes instead of your photos, that app can't do
            photo fonts: use your letter pictures there.
          </p>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn blue" onClick={saveLetters} disabled={p.map.size === 0 || packing}>
              {packing ? 'Packing your letters…' : '⬇ Save letter pictures'}
            </button>
          </div>
          <p className="help">
            {lettersSave && <SaveNote outcome={lettersSave} />}Every letter as a picture, for Canva or Google Docs.
          </p>
        </div>

        <div className="card">
          {poster ? (
            <img className="poster-preview" src={poster} alt={`Your ${frame.label.toLowerCase()}`} />
          ) : (
            <div className="poster-preview" style={{ aspectRatio: `${frame.w} / ${frame.h}` }} />
          )}
          <p className="help" style={{ marginTop: 10 }}>
            <strong>{frame.label}</strong> · {frame.w} × {frame.h} px, {frame.note}. Change the background, words and text boxes in the Play step.
          </p>
          <label className="toggle">
            <input type="checkbox" checked={withName} onChange={(e) => setWithName(e.target.checked)} />
            Put the font's name on it
          </label>
          <div className="row" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
            <button className="btn big blue" onClick={savePoster}>
              ⬇ Save {frame.label.toLowerCase()}
            </button>
          </div>
          {posterSave && (
            <p className="help">
              <SaveNote outcome={posterSave} />
            </p>
          )}
        </div>
      </div>

      <section className="card feedback-card" aria-labelledby="overall-title">
        <h2 id="overall-title">How was making your font?</h2>
        <FeedbackForm part="overall" label="The whole font station" />
      </section>

      {/* The room wall talks to a server on the local network, which a claude.ai page can't reach. */}
      {!inClaudeViewer && <RoomPanel map={p.captured} team={p.maker} />}

      <div className="row" style={{ marginTop: 24 }}>
        <button className="btn red" onClick={() => p.onAddMore()}>
          + Add more letters
        </button>
        {confirmReset ? (
          <span className="row card" style={{ padding: '8px 14px' }}>
            <strong>Clear all your letters?</strong>
            <button className="btn small red" onClick={p.onStartOver}>
              Yes, start again
            </button>
            <button className="btn small" onClick={() => setConfirmReset(false)}>
              No, keep them
            </button>
          </span>
        ) : (
          <button className="btn" onClick={() => setConfirmReset(true)}>
            Start a new font
          </button>
        )}
      </div>
    </>
  );
}

const MARKS: Record<string, string> = {
  '!': 'exclamation mark', '?': 'question mark', '.': 'full stop', ',': 'comma', "'": 'apostrophe', '-': 'dash', '&': 'and sign',
  '"': 'quote', ':': 'colon', ';': 'semicolon', '+': 'plus', '=': 'equals', '#': 'hash',
};

/** File names that stay different on Windows and Macs, where A.png and a.png are the same file. */
function letterFileName(ch: string): string {
  if (/^[A-Z]$/.test(ch)) return `capital ${ch}`;
  if (/^[a-z]$/.test(ch)) return `small ${ch}`;
  if (/^[0-9]$/.test(ch)) return `number ${ch}`;
  return MARKS[ch] ?? `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** A save that broke while the file was being made, with the reason for the helper. */
function broke(e: unknown): SaveOutcome {
  console.error(e);
  return { kind: 'failed', why: e instanceof Error ? e.message : String(e) };
}

function SaveNote({ outcome }: { outcome: SaveOutcome }) {
  switch (outcome.kind) {
    case 'saved':
      return <>✅ Saved to Downloads. </>;
    case 'declined':
      return <>Not saved. Press the button again to save it. </>;
    case 'busy':
      return <>Another save is still waiting for an answer. Finish that one, then press the button again. </>;
    case 'link':
      return (
        <>
          <a className="btn small yellow save-link" href={outcome.url} download={outcome.filename} target="_blank" rel="noopener">
            ⬇ Tap here to download {outcome.filename}
          </a>{' '}
        </>
      );
    case 'failed':
      return <>Saving didn't work ({outcome.why}). Ask your helper. </>;
  }
}

function RoomPanel({ map, team }: { map: Map<string, LetterGlyph>; team: string }) {
  const [base, setBase] = useState<string | null>(roomBase());
  const [online, setOnline] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [addr, setAddr] = useState('');
  const [showSetup, setShowSetup] = useState(false);

  useEffect(() => {
    let live = true;
    if (base) fetchRoom(base).then((s) => live && setOnline(!!s));
    return () => {
      live = false;
    };
  }, [base]);

  if (!online) {
    // The room wall is optional; only the facilitator needs this.
    return (
      <div style={{ marginTop: 18 }}>
        {showSetup ? (
          <div className="row card">
            <input className="name-input" style={{ maxWidth: 360 }} value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="192.168.1.20:8787" aria-label="Room wall address" />
            <button
              className="btn"
              onClick={() => {
                saveRoomBase(addr);
                setBase(roomBase());
              }}
            >
              Connect
            </button>
            {base && <span>Can't reach the room wall at {base}.</span>}
          </div>
        ) : (
          <button className="btn small" onClick={() => setShowSetup(true)}>
            Room wall…
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 18, background: 'var(--blue-soft)' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 24 }}>Send your letters to the room wall</strong>
        <button
          className="btn big blue"
          disabled={!map.size}
          onClick={async () => {
            setStatus('Sending…');
            const ok = await submitToRoom(
              base!,
              team.trim() || 'A team',
              [...map].map(([char, g]) => ({ char, svg: g.svg, advance: g.outline.advance })),
            );
            setStatus(ok ? '🎉 Your letters are on the wall!' : "Couldn't send. Ask your helper.");
          }}
        >
          Send {[...map.keys()].join(' ')}
        </button>
      </div>
      {status && <p>{status}</p>}
    </div>
  );
}
