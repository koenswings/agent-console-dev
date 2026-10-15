import { createSignal } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { CommandLogStore } from '../types/commandLog';

export type CommandLogError = { error: true; url: string; status: number | null };
export type CommandLogState = CommandLogStore | null | CommandLogError;

/**
 * How often the Console re-reads GET /api/command-log-url to follow the
 * Engine's daily CommandLog rotation (idea#183). The Engine starts a fresh doc
 * each local day and carries open and just-closed traces into it, so a switch
 * within this window loses nothing the Console is waiting for.
 */
export const COMMAND_LOG_URL_POLL_MS = 60_000;

export interface CommandLogConnectionOptions {
  /** Default COMMAND_LOG_URL_POLL_MS; 0 disables following. */
  pollMs?: number;
  /** Polling stops once this returns true (connection disposed). */
  isDisposed?: () => boolean;
}

/**
 * Connects to the engine's command-log Automerge document.
 * Fetches the doc URL from GET /api/command-log-url, then calls repo.find()
 * on the same WS-connected repo that syncs the main store. The URL is the
 * pointer to the current doc: it is re-read every pollMs, and when the Engine
 * rotated to a new doc (idea#183) the signal switches to it.
 *
 * Returns a reactive signal:
 *   null             → still loading
 *   CommandLogError  → failed to connect (show error with URL)
 *   CommandLogStore  → connected (may have 0 traces = "no history yet")
 */
export async function createCommandLogConnection(
  /** Engine HTTP authority: `hostname` or `hostname:port`. */
  host: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  repo: any,
  options: CommandLogConnectionOptions = {},
): Promise<Accessor<CommandLogState>> {
  const apiUrl = `http://${host}/api/command-log-url`;
  const pollMs = options.pollMs ?? COMMAND_LOG_URL_POLL_MS;
  const isDisposed = options.isDisposed ?? (() => false);
  const [commandLogStore, setCommandLogStore] = createSignal<CommandLogState>(null);

  let currentUrl: string | null = null;
  let generation = 0;

  const fetchUrl = async (): Promise<{ url?: string; status: number | null }> => {
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(8000), mode: 'cors', credentials: 'omit' });
    if (!res.ok) return { status: res.status };
    const json = await res.json() as { url?: string };
    return { url: json.url, status: res.status };
  };

  /** Follow `url`; listeners of an older doc are ignored after the switch. */
  const follow = async (url: string): Promise<void> => {
    const gen = ++generation;
    currentUrl = url;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handle: any = await (repo.find(url as any) as unknown as Promise<any>);
    if (gen !== generation) return;
    const initialDoc = handle.doc() as CommandLogStore | null;
    if (initialDoc) setCommandLogStore(initialDoc);
    handle.addListener?.('change', ({ doc: d }: { doc: unknown }) => {
      if (gen === generation) setCommandLogStore(d as CommandLogStore);
    });
    handle.addListener?.('heads-changed', ({ doc: d }: { doc: unknown }) => {
      if (gen === generation && d) setCommandLogStore(d as CommandLogStore);
    });
  };

  try {
    const { url, status } = await fetchUrl();
    if (!url) { setCommandLogStore({ error: true, url: apiUrl, status: status === 200 ? null : status }); return commandLogStore; }
    await follow(url);
  } catch (err) {
    console.warn('[commandLog] Failed to connect:', err);
    setCommandLogStore({ error: true, url: apiUrl, status: null });
    return commandLogStore;
  }

  if (pollMs > 0) {
    const timer = setInterval(async () => {
      if (isDisposed()) { clearInterval(timer); return; }
      try {
        const { url } = await fetchUrl();
        if (url && url !== currentUrl && !isDisposed()) {
          console.info(`[commandLog] Engine rotated its command log: ${currentUrl} -> ${url}`);
          await follow(url);
        }
      } catch { /* transient: keep the current doc, retry next tick */ }
    }, pollMs);
  }

  return commandLogStore;
}
