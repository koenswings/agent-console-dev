import { createSignal } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { CommandLogStore } from '../types/commandLog';

/**
 * Connects to the engine's command-log Automerge document.
 * Fetches the doc URL from GET /api/command-log-url, then calls repo.find()
 * on the same WS-connected repo that syncs the main store.
 *
 * Returns a reactive signal:
 *   null  → still loading
 *   false → failed to connect (show error)
 *   CommandLogStore → connected (may have 0 traces = "no history yet")
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createCommandLogConnection(
  hostname: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  repo: any
): Promise<Accessor<CommandLogStore | null | false>> {
  const [commandLogStore, setCommandLogStore] = createSignal<CommandLogStore | null | false>(null);

  try {
    const res = await fetch(`http://${hostname}/api/command-log-url`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) { setCommandLogStore(false); return commandLogStore; }
    const json = await res.json() as { url?: string };
    const url = json.url;
    if (!url) { setCommandLogStore(false); return commandLogStore; }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handle: any = await (repo.find(url as any) as unknown as Promise<any>);

    const initialDoc = handle.doc() as CommandLogStore | null;
    if (initialDoc) {
      setCommandLogStore(initialDoc);
    }

    handle.addListener?.('change', ({ doc: d }: { doc: unknown }) => {
      setCommandLogStore(d as CommandLogStore);
    });

    handle.addListener?.('heads-changed', ({ doc: d }: { doc: unknown }) => {
      if (d) setCommandLogStore(d as CommandLogStore);
    });

    return commandLogStore;
  } catch (err) {
    console.warn('[commandLog] Failed to connect:', err);
    setCommandLogStore(false);
    return commandLogStore;
  }
}
