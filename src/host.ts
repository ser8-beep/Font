// Differences between running as a normal web page and inside a claude.ai artifact viewer.
// The viewer provides `window.claude.use` before any script runs; it blocks plain downloads,
// the webcam and requests to other hosts, so those features change or hide there.

interface ClaudeDownloads {
  save(req: { filename: string; data: Blob | ArrayBuffer | ArrayBufferView | string }): Promise<{ status: string }>;
}
interface ClaudeHost {
  use(name: string): Promise<unknown>;
}

const claude = (window as unknown as { claude?: Partial<ClaudeHost> }).claude;

export const inClaudeViewer = typeof claude?.use === 'function';

/**
 * How a save went. 'link': the page could not start the download itself, so it hands back a link
 * for the viewer to tap (a real tap on a download link works where scripted downloads are blocked).
 */
export type SaveOutcome =
  | { kind: 'saved' }
  | { kind: 'declined' }
  | { kind: 'busy' }
  | { kind: 'link'; url: string; filename: string }
  | { kind: 'failed'; why: string };

/** Viewer error codes that mean "this view can't save": try the ordinary ways instead. */
const CANT_SAVE_HERE = new Set(['unavailable', 'not_granted', 'capability_disabled', 'capability_removed', 'extension_not_enabled']);

export async function saveFile(data: Blob, filename: string): Promise<SaveOutcome> {
  if (!data.size) return { kind: 'failed', why: 'the file came out empty' };
  if (inClaudeViewer) {
    // Inside the claude.ai viewer pages can't download directly; the viewer asks the person instead.
    // Opened on its own (full screen, the artifact's own page, some apps) the viewer may not serve
    // this, and the page then saves the ordinary way.
    const downloads = (await claude!.use!('downloads').catch(() => null)) as ClaudeDownloads | null;
    if (downloads) {
      try {
        await downloads.save({ filename, data });
        return { kind: 'saved' };
      } catch (e) {
        const code = String((e as { code?: string })?.code ?? 'unknown');
        if (code === 'declined') return { kind: 'declined' };
        if (code === 'rate_limited') return { kind: 'busy' };
        if (!CANT_SAVE_HERE.has(code)) return { kind: 'failed', why: (e as { message?: string })?.message || code };
      }
    }
    return { kind: 'link', url: URL.createObjectURL(data), filename };
  }
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return { kind: 'saved' };
}

/** data: URL -> Blob without fetch (the viewer's content policy may block fetching data: URLs). */
export function dataUrlToBlob(url: string): Blob {
  const [head, body] = url.split(',', 2);
  const type = head.match(/^data:([^;,]+)/)?.[1] ?? 'application/octet-stream';
  if (!head.includes(';base64')) return new Blob([decodeURIComponent(body)], { type });
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
