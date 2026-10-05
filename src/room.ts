// Client for the optional shared-alphabet server (server/room-server.js).

export interface RoomGlyph {
  char: string;
  svg: string;
  advance: number;
  team: string;
  at: number;
}

export interface RoomState {
  name: string;
  alphabet: Record<string, RoomGlyph>;
  submissions: number;
}

const KEY = 'font-station-room';

/** Where the room server lives: saved address, else this page's own server. */
export function roomBase(): string | null {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return saved;
  } catch {
    /* storage blocked */
  }
  const q = new URLSearchParams(location.search).get('room');
  if (q) return normalise(q);
  return location.protocol.startsWith('http') ? location.origin : null;
}

export function saveRoomBase(addr: string) {
  try {
    if (addr) localStorage.setItem(KEY, normalise(addr));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
}

function normalise(addr: string): string {
  const a = addr.trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(a) ? a : `http://${a}`;
}

export async function fetchRoom(base: string, timeoutMs = 2500): Promise<RoomState | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base}/api/room`, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j && typeof j === 'object' && 'alphabet' in j ? (j as RoomState) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function submitToRoom(base: string, team: string, glyphs: { char: string; svg: string; advance: number }[]): Promise<boolean> {
  try {
    const r = await fetch(`${base}/api/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team, glyphs }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export function connectRoom(base: string, onState: (s: RoomState) => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout>;
  const open = () => {
    ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.type === 'state') onState(m.state);
      } catch {
        /* ignore bad frames */
      }
    };
    ws.onclose = () => {
      if (!closed) retry = setTimeout(open, 2000);
    };
  };
  open();
  return () => {
    closed = true;
    clearTimeout(retry);
    ws?.close();
  };
}
