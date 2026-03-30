/**
 * Real Automerge store connection for production (Chrome Extension / web mode).
 *
 * Reads configuration from:
 *   - Engine hostname: chrome.storage.local (extension) or localStorage (web fallback)
 *   - Store document URL: import.meta.env.VITE_STORE_URL or localStorage
 *
 * Returns a StoreConnection whose store() Accessor updates reactively as
 * Automerge syncs changes from the Engine.
 */
import { createSignal } from 'solid-js';
import type { StoreConnection } from '../mock/mockStore';
import type { Store } from '../types/store';

const ENGINE_WS_PORT = 4321;
const STORAGE_KEY_HOSTNAME = 'engineHostname';
const STORAGE_KEY_STORE_URL = 'storeUrl';

// ---------------------------------------------------------------------------
// Storage helpers — chrome.storage.local (extension) or localStorage (web)
// ---------------------------------------------------------------------------

async function readFromStorage(key: string): Promise<string | null> {
  try {
    const result = await chrome.storage.local.get(key);
    if (result[key] != null) return result[key] as string;
  } catch {
    // Not in extension context — fall through to localStorage
  }
  return localStorage.getItem(key);
}

// ---------------------------------------------------------------------------
// createEngineConnection
// ---------------------------------------------------------------------------

export async function createEngineConnection(): Promise<StoreConnection> {
  const [store, setStore] = createSignal<Store | null>(null);
  const [connected, setConnected] = createSignal(false);

  const noopSend = (_e: string, _c: string) => {
    console.warn('[engine] Not connected — command dropped');
  };

  try {
    const hostname = (await readFromStorage(STORAGE_KEY_HOSTNAME)) ?? 'appdocker01.local';
    const envStoreUrl = import.meta.env.VITE_STORE_URL as string | undefined;
    const storeUrl = envStoreUrl ?? (await readFromStorage(STORAGE_KEY_STORE_URL));

    if (!storeUrl) {
      console.warn('[engine] No store URL configured — cannot connect');
      return { store, connected, sendCommand: noopSend };
    }

    // Dynamic imports to keep these heavy packages out of the dev bundle
    // (dev mode uses mock store; these imports only run in production)
    const { Repo } = await import('@automerge/automerge-repo');
    const { BrowserWebSocketClientAdapter } = await import(
      '@automerge/automerge-repo-network-websocket'
    );

    const wsUrl = `ws://${hostname}:${ENGINE_WS_PORT}`;
    console.log(`[engine] Connecting to ${wsUrl}`);

    const adapter = new BrowserWebSocketClientAdapter(wsUrl);
    const repo = new Repo({ network: [adapter] });

    // repo.find() is synchronous — returns DocHandle immediately
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handle: any = repo.find(storeUrl as any);

    // Subscribe to document changes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handle.on('change', ({ doc }: { doc: any }) => {
      setStore(doc as Store);
      setConnected(true);
    });

    // Wait up to 10 seconds for initial sync
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), 10_000)
    );
    await Promise.race([handle.whenReady(), timeoutPromise]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc: any = handle.doc();
    if (doc) {
      setStore(doc as Store);
      setConnected(true);
    }

    const sendCommand = (engineId: string, command: string): void => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handle.change((d: any) => {
        const engine = d.engineDB?.[engineId];
        if (engine) {
          engine.commands.push(command);
        }
      });
    };

    return { store, connected, sendCommand };
  } catch (err) {
    console.error('[engine] Failed to connect to Engine:', err);
    setConnected(false);
    return { store, connected, sendCommand: noopSend };
  }
}
