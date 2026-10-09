// Feedback on each part of the station: three ratings (five faces, 1–5) and a remark. On the claude.ai page it
// goes to the artifact's shared store (feedback/<viewer>/entries, readable only by the owner and
// editors), where it can be read back and summed up. Elsewhere, or for viewers who can't write
// there, it stays on this device, and a facilitator can download it as a spreadsheet (CSV).
import { useCapability } from './host';

export interface Ratings {
  /** 1–5: how easy it was to understand. */
  understand: number;
  /** 1–5: how easy it was to use. */
  use: number;
  /** 1–5: how rarely they got stuck without a clue what to do (5 = never stuck). */
  stuck: number;
}

export interface FeedbackEntry extends Ratings {
  /** The part of the station: 'capture', 'split', 'clean', 'grow', 'type', 'export', or 'overall'. */
  part: string;
  /** Its name as the kid saw it. */
  partLabel: string;
  remarks: string;
  /** ISO time. */
  at: string;
  /** One id per kid's go at the station (a new one after Start over). */
  session: string;
  /** Screen width in CSS pixels, for telling phones, tablets and computers apart. */
  screen: number;
  /** Extra context, e.g. how the photo was taken. */
  context?: string;
}

const KEY = 'font-station-feedback';
/** Fired on window when feedback is kept on this device. */
export const SAVED_EVENT = 'font-station-feedback-saved';
let session = Math.random().toString(36).slice(2, 10);

/** Starts a new kid's go (feedback after this is grouped separately). */
export function newFeedbackSession() {
  session = Math.random().toString(36).slice(2, 10);
}

/** Feedback kept on this device. */
export function localFeedback(): FeedbackEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as FeedbackEntry[];
  } catch {
    return [];
  }
}

function keepLocally(e: FeedbackEntry): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify([...localFeedback(), e]));
    window.dispatchEvent(new Event(SAVED_EVENT));
    return true;
  } catch {
    return false;
  }
}

interface Db {
  collection(path: string): { add(data: Record<string, unknown>): Promise<unknown> };
}
interface User {
  id(): Promise<string | null>;
}

/** Where a remark went: the shared store, this device, or nowhere (it couldn't be kept). */
export type Sent = 'shared' | 'device' | 'failed';

export async function sendFeedback(part: string, partLabel: string, ratings: Ratings, remarks: string, context?: string): Promise<Sent> {
  const e: FeedbackEntry = { part, partLabel, ...ratings, remarks: remarks.trim().slice(0, 2000), at: new Date().toISOString(), session, screen: window.innerWidth, ...(context ? { context } : {}) };
  const [db, user] = await Promise.all([useCapability<Db>('db'), useCapability<User>('user')]);
  const id = user ? await user.id().catch(() => null) : null;
  if (db && id) {
    try {
      await db.collection(`feedback/${id}/entries`).add({ ...e });
      return 'shared';
    } catch {
      // A viewer who may only look (not write) keeps it on the device instead.
    }
  }
  return keepLocally(e) ? 'device' : 'failed';
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** This device's feedback as a spreadsheet (CSV). */
export function feedbackCsv(entries = localFeedback()): string {
  const cols: (keyof FeedbackEntry)[] = ['at', 'session', 'part', 'partLabel', 'understand', 'use', 'stuck', 'remarks', 'context', 'screen'];
  return [cols.join(','), ...entries.map((e) => cols.map((c) => csvCell(e[c])).join(','))].join('\r\n') + '\r\n';
}
