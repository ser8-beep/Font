import { useEffect, useState } from 'react';
import { buildFont, safeFileName, type LetterGlyph } from '../font';
import { inClaudeViewer, saveFile, type SaveOutcome } from '../host';
import { renderPoster } from '../poster';
import { fetchRoom, roomBase, saveRoomBase, submitToRoom } from '../room';
import { MaterialToggle } from './TypeStep';

interface Props {
  text: string;
  map: Map<string, LetterGlyph>;
  material: boolean;
  fontName: string;
  maker: string;
  onFontName: (n: string) => void;
  onMaker: (n: string) => void;
  onMaterial: (on: boolean) => void;
  onAddMore: () => void;
  onStartOver: () => void;
}

export function ExportStep(p: Props) {
  const [poster, setPoster] = useState<string | null>(null);
  const [fontSave, setFontSave] = useState<SaveOutcome | null>(null);
  const [posterSave, setPosterSave] = useState<SaveOutcome | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const name = p.fontName || (p.maker ? `${p.maker}'s Font` : 'My Font');

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const c = await renderPoster(p.text, p.map, p.material, name, p.maker);
      if (live) setPoster(c.toDataURL('image/png'));
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [p.text, p.map, p.material, name, p.maker]);

  const saveFont = async () => {
    const ttf = buildFont(p.map, name, p.maker);
    setFontSave(await saveFile(new Blob([ttf as BlobPart], { type: 'font/ttf' }), `${safeFileName(name)}.ttf`));
  };
  const savePoster = async () => {
    const c = await renderPoster(p.text, p.map, p.material, name, p.maker);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
    if (blob) setPosterSave(await saveFile(blob, `${safeFileName(name)} poster.png`));
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
            <button className="btn big green" onClick={saveFont} disabled={p.map.size === 0}>
              ⬇ Save my font
            </button>
          </div>
          <p className="help">
            {fontSave && <SaveNote outcome={fontSave} />}To install it: open <strong>{safeFileName(name)}.ttf</strong> from Downloads, then press <strong>Install</strong>. Then pick it in Word.
          </p>
        </div>

        <div className="card">
          {poster ? <img className="poster-preview" src={poster} alt="Your poster" /> : <div className="poster-preview" style={{ aspectRatio: '16/10' }} />}
          <div className="row" style={{ marginTop: 14, justifyContent: 'space-between' }}>
            <MaterialToggle material={p.material} onMaterial={p.onMaterial} />
            <button className="btn big orange" onClick={savePoster}>
              ⬇ Save poster
            </button>
          </div>
          {posterSave && (
            <p className="help">
              <SaveNote outcome={posterSave} />
            </p>
          )}
        </div>
      </div>

      {/* The room wall talks to a server on the local network, which a claude.ai page can't reach. */}
      {!inClaudeViewer && <RoomPanel map={p.map} team={p.maker} />}

      <div className="row" style={{ marginTop: 24 }}>
        <button className="btn pink" onClick={p.onAddMore}>
          + Add more letters
        </button>
        {confirmReset ? (
          <span className="row card" style={{ padding: '8px 14px' }}>
            <strong>Clear all your letters?</strong>
            <button className="btn small pink" onClick={p.onStartOver}>
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

function SaveNote({ outcome }: { outcome: SaveOutcome }) {
  if (outcome === 'saved') return <>✅ Saved to Downloads. </>;
  if (outcome === 'declined') return <>Not saved. Press the button again to save it. </>;
  return <>Saving didn't work here. Ask your helper. </>;
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
    <div className="card" style={{ marginTop: 18, background: '#d7e6ff' }}>
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
