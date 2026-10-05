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

export type SaveOutcome = 'saved' | 'declined' | 'failed';

export async function saveFile(data: Blob, filename: string): Promise<SaveOutcome> {
  if (inClaudeViewer) {
    const downloads = (await claude!.use!('downloads')) as ClaudeDownloads | null;
    if (!downloads) return 'failed';
    try {
      await downloads.save({ filename, data });
      return 'saved';
    } catch (e) {
      return (e as { code?: string })?.code === 'declined' ? 'declined' : 'failed';
    }
  }
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'saved';
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
