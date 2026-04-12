/**
 * Real Automerge store connection for production.
 *
 * Supports two runtime contexts:
 *   - Chrome Extension: hostname from chrome.storage.local / settings screen
 *   - Production web app: hostname auto-detected from window.location; store URL
 *     fetched from GET /api/store-url on the same origin
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
// Context detection
// ---------------------------------------------------------------------------

export function isExtensionContext(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

/**
 * Returns true when the Console is being served directly by an Engine's HTTP
 * server — i.e. not in dev mode, not as a Chrome Extension, and not on
 * localhost/loopback.
 */
export function isProductionWebMode(): boolean {
  if (import.meta.env.DEV) return false;
  if (isExtensionContext()) return false;
  const h = window.location.hostname;
  return h !== '' && h !== 'localhost' && h !== '127.0.0.1' && !h.startsWith('100.');
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

async function readFromStorage(key: string): Promise<string | null> {
  if (isExtensionContext()) {
    try {
      const result = await chrome.storage.local.get(key);
      if (result[key] != null) return result[key] as string;
      return null;
    } catch {}
  }
  return localStorage.getItem(key);
}

// ---------------------------------------------------------------------------
// Store URL discovery
// ---------------------------------------------------------------------------

/**
 * Tries to fetch the Automerge document URL from the Engine's HTTP API.
 * Returns null if the endpoint does not exist yet (Engine hasn't implemented it).
 */
async function fetchStoreUrlFromEngine(hostname: string): Promise<string | null> {
  try {
    const res = await fetch(`http://${hostname}/api/store-url`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return (json.url as string) ?? null;
  } catch {
    return null;
  }
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

  const noopChange = (_fn: (doc: Store) => void) => {
    console.warn('[engine] Not connected — changeDoc dropped');
  };

  try {
    // --- Resolve hostname and store URL ---
    let hostname: string;
    let storeUrl: string | null;

    if (isProductionWebMode()) {
      // Served from the Engine — hostname is already in the URL
      hostname = window.location.hostname;
      console.log(`[engine] Production web mode — using hostname from URL: ${hostname}`);
      // Try to fetch store URL from the Engine API; fall back to localStorage
      storeUrl = await fetchStoreUrlFromEngine(hostname);
      if (storeUrl) {
        console.log(`[engine] Store URL from /api/store-url: ${storeUrl}`);
        localStorage.setItem(STORAGE_KEY_STORE_URL, storeUrl);
      } else {
        console.warn('[engine] /api/store-url not available yet — trying localStorage');
        storeUrl = localStorage.getItem(STORAGE_KEY_STORE_URL);
      }
    } else {
      // Extension or manual configuration
      hostname = (await readFromStorage(STORAGE_KEY_HOSTNAME)) ?? 'appdocker01.local';
      const envStoreUrl = import.meta.env.VITE_STORE_URL as string | undefined;
      storeUrl = envStoreUrl ?? (await readFromStorage(STORAGE_KEY_STORE_URL));

      // Also try fetching from the Engine even in extension mode — so the operator
      // doesn't have to paste the store URL manually once Axle ships the endpoint.
      if (!storeUrl) {
        storeUrl = await fetchStoreUrlFromEngine(hostname);
        if (storeUrl) {
          console.log(`[engine] Store URL from /api/store-url: ${storeUrl}`);
        }
      }
    }

    if (!storeUrl) {
      console.warn('[engine] No store URL available — cannot connect');
      return { store, connected, sendCommand: noopSend, changeDoc: noopChange };
    }

    // --- Connect via Automerge WebSocket ---
    const { Repo } = await import('@automerge/automerge-repo');
    const { BrowserWebSocketClientAdapter } = await import(
      '@automerge/automerge-repo-network-websocket'
    );

    const wsUrl = `ws://${hostname}:${ENGINE_WS_PORT}`;
    console.log(`[engine] Connecting to ${wsUrl}`);

    const adapter = new BrowserWebSocketClientAdapter(wsUrl);
    const repo = new Repo({ network: [adapter] });

    // In automerge-repo 2.3.0-alpha+, repo.find() returns a Promise<DocHandle>.
    // In 2.2.x it returned a DocHandle directly. We await to handle both.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handle: any = await (repo.find(storeUrl as any) as unknown as Promise<any>);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), 10_000)
    );
    await Promise.race([handle.whenReady(), timeoutPromise]);

    const doc = handle.doc();
    if (doc) {
      setStore(doc as Store);
      setConnected(true);
    }

    // Subscribe to subsequent changes
    handle.addListener?.('change', ({ doc: d }: { doc: unknown }) => {
      setStore(d as Store);
      setConnected(true);
    });

    const sendCommand = (engineId: string, command: string): void => {
      handle.change((d: { engineDB?: { [key: string]: { commands: string[] } } }) => {
        const engine = d.engineDB?.[engineId];
        if (engine) engine.commands.push(command);
      });
    };

    const changeDoc = (fn: (doc: Store) => void): void => {
      handle.change(fn);
    };

    return { store, connected, sendCommand, changeDoc };
  } catch (err) {
    console.error('[engine] Failed to connect:', err);
    setConnected(false);
    return { store, connected, sendCommand: noopSend, changeDoc: noopChange };
  }
}
