import { useEffect, useState } from 'react';
import { feedbackCsv, localFeedback, SAVED_EVENT, sendFeedback, type Ratings, type Sent } from '../feedback';
import { saveFile } from '../host';

const QUESTIONS: { key: keyof Ratings; q: string; low: string; high: string }[] = [
  { key: 'understand', q: 'How easy was it to understand?', low: 'Very hard', high: 'Very easy' },
  { key: 'use', q: 'How easy was it to use?', low: 'Very hard', high: 'Very easy' },
  { key: 'stuck', q: 'How often did you get stuck, not knowing what to do?', low: 'All the time', high: 'Never' },
];

/** Five faces from unhappy to happy: the 1–5 scale, readable without numbers. */
const FACES = ['😣', '😕', '😐', '🙂', '😄'];

function Faces({ value, onChange, label, low, high }: { value: number; onChange: (n: number) => void; label: string; low: string; high: string }) {
  return (
    <div className="faces-row">
      <div className="faces" role="radiogroup" aria-label={label}>
        {FACES.map((face, i) => {
          const n = i + 1;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${n} of 5${n === 1 ? ` (${low})` : n === 5 ? ` (${high})` : ''}`}
              className={value === n ? 'on' : value ? 'off' : ''}
              onClick={() => onChange(n)}
            >
              {face}
            </button>
          );
        })}
      </div>
      <div className="faces-ends" aria-hidden>
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}

/** Three ratings (five faces each) and a remark about one part of the station. */
export function FeedbackForm({ part, label, context, onSent }: { part: string; label: string; context?: string; onSent?: (where: Sent) => void }) {
  const [r, setR] = useState<Ratings>({ understand: 0, use: 0, stuck: 0 });
  const [remarks, setRemarks] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const ready = r.understand > 0 && r.use > 0 && r.stuck > 0;

  if (sent && sent !== 'failed') {
    return (
      <div className="feedback-thanks" role="status">
        <strong>Thank you! 💛</strong>
        <span>{sent === 'shared' ? 'Your feedback was sent.' : 'Your feedback was saved on this device.'}</span>
      </div>
    );
  }
  return (
    <form
      className="feedback-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready || sending) return;
        setSending(true);
        const where = await sendFeedback(part, label, r, remarks, context);
        setSending(false);
        setSent(where);
        onSent?.(where);
      }}
    >
      {QUESTIONS.map(({ key, q, low, high }) => (
        <div key={key} className="feedback-q">
          <p>{q}</p>
          <Faces value={r[key]} onChange={(n) => setR({ ...r, [key]: n })} label={q} low={low} high={high} />
        </div>
      ))}
      <label className="feedback-q">
        <p>Anything else? What was confusing, or what did you like?</p>
        <textarea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Write here (you can skip this)" />
      </label>
      {sent === 'failed' && <p className="card alert">Your feedback couldn't be saved here. Please tell the person running the station.</p>}
      <div className="row tight">
        <button type="submit" className="btn green" disabled={!ready || sending}>
          {sending ? 'Sending…' : 'Send feedback'}
        </button>
        {!ready && <span className="help">Pick a face for all three questions.</span>}
      </div>
    </form>
  );
}

/** "Rate this step": opens the feedback form for the part of the station on screen. */
export function FeedbackButton({ part, label, context }: { part: string; label: string; context?: string }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  const rated = done.has(part);
  return (
    <>
      <button className={`btn feedback-btn ${rated ? 'rated' : ''}`} onClick={() => setOpen(true)} aria-label={`Rate this step: ${label}`} title="Tell us how this step went">
        <span aria-hidden>{rated ? '✓' : '💬'}</span>
        <span className="feedback-btn-text">{rated ? 'Thanks!' : 'Rate this step'}</span>
      </button>
      {open && (
        <FeedbackSheet title={`How was “${label}”?`} onClose={() => setOpen(false)}>
          <FeedbackForm key={part} part={part} label={label} context={context} onSent={(w) => w !== 'failed' && setDone(new Set(done).add(part))} />
        </FeedbackSheet>
      )}
    </>
  );
}

function FeedbackSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="btn small" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
        <FacilitatorExport />
      </div>
    </div>
  );
}

/** For the person running the station: everything kept on this device, as a spreadsheet. */
export function FacilitatorExport() {
  const [n, setN] = useState(() => localFeedback().length);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    const count = () => setN(localFeedback().length);
    window.addEventListener(SAVED_EVENT, count);
    return () => window.removeEventListener(SAVED_EVENT, count);
  }, []);
  if (!n) return null;
  return (
    <p className="facilitator">
      <button
        className="linkish"
        onClick={async () => {
          const out = await saveFile(new Blob([feedbackCsv()], { type: 'text/csv' }), 'font station feedback.csv');
          if (out.kind === 'link') window.open(out.url, '_blank');
          setNote(out.kind === 'saved' || out.kind === 'link' ? 'Downloaded.' : 'Not downloaded.');
          setN(localFeedback().length);
        }}
      >
        Download feedback saved on this device ({n})
      </button>{' '}
      {note}
    </p>
  );
}
