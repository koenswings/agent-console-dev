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
import { createCommandLogConnection } from './commandLog';
import type { CommandLogError } from './commandLog';
import { STORAGE_KEY_PORT, formatHostPort, parsePort } from './storage';

/** Fallback WS port when the Engine does not advertise `wsPort` on /api/store-url. */
export const ENGINE_WS_PORT = 4321;
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
  // Treat any non-empty hostname as production web mode — including Tailscale IPs (100.x)
  // and fleet Pi hostnames. Only exclude empty string and localhost/loopback.
  return h !== '' && h !== 'localhost' && h !== '127.0.0.1';
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

async function readFromStorage(key: string): Promise<string | null> {
  if (isExtensionContext()) {
    try {
      const result = await chrome.storage.local.get(key) as Record<string, unknown>;
      if (result[key] != null) return result[key] as string;
      return null;
    } catch {}
  }
  return localStorage.getItem(key);
}

// ---------------------------------------------------------------------------
// Store URL discovery
// ---------------------------------------------------------------------------

export interface EngineStoreInfo {
  /** Automerge document URL, or null if the response had none. */
  url: string | null;
  /** WebSocket port advertised by the Engine, or null when absent/invalid. */
  wsPort: number | null;
}

/**
 * Parse a GET /api/store-url response body: `{ url, wsPort? }`.
 * `wsPort` is optional (older Engines return only `{ url }`).
 */
export function parseStoreUrlResponse(json: unknown): EngineStoreInfo {
  const obj = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const url = typeof obj.url === 'string' && obj.url ? obj.url : null;
  const wsPort = typeof obj.wsPort === 'number' ? parsePort(obj.wsPort) : null;
  return { url, wsPort };
}

/** WebSocket URL for the Engine: advertised port when valid, else 4321. */
export function buildEngineWsUrl(hostname: string, wsPort?: number | null): string {
  return `ws://${hostname}:${parsePort(wsPort) ?? ENGINE_WS_PORT}`;
}

/**
 * Tries to fetch the Automerge document URL (and optional WS port) from the
 * Engine's HTTP API. `host` is `hostname` or `hostname:port`.
 * Returns null if the endpoint is unreachable or not implemented.
 */
async function fetchStoreInfoFromEngine(host: string): Promise<EngineStoreInfo | null> {
  try {
    const res = await fetch(`http://${host}/api/store-url`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return parseStoreUrlResponse(await res.json());
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// createEngineConnection
// ---------------------------------------------------------------------------

export async function createEngineConnection(retries = 3): Promise<StoreConnection> {
  const [store, setStore] = createSignal<Store | null>(null);
  const [connected, setConnected] = createSignal(false);
  let disposed = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let repoRef: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let adapterRef: any = null;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    console.info('[engine] dispose — tearing down connection');
    try { adapterRef?.disconnect?.(); } catch { /* ignore */ }
    try { void repoRef?.shutdown?.(); } catch { /* ignore */ }
  };

  const noopSend = (_e: string, _c: string) => {
    console.warn('[engine] Not connected — command dropped');
  };

  const noopChange = (_fn: (doc: Store) => void) => {
    console.warn('[engine] Not connected — changeDoc dropped');
  };

  try {
    // --- Resolve hostname, HTTP authority (host[:port]) and store URL ---
    let hostname: string;
    let httpHost: string;
    let storeUrl: string | null;
    let wsPort: number | null = null;

    if (isProductionWebMode()) {
      // Served from the Engine — hostname (and HTTP port, if any) is already in the URL
      hostname = window.location.hostname;
      httpHost = formatHostPort(hostname, parsePort(window.location.port));
      console.info(`[engine] Production web mode — using hostname from URL: ${httpHost}`);
      // Try to fetch store URL from the Engine API; fall back to localStorage
      const info = await fetchStoreInfoFromEngine(httpHost);
      wsPort = info?.wsPort ?? null;
      storeUrl = info?.url ?? null;
      if (storeUrl) {
        console.info(`[engine] Store URL from /api/store-url: ${storeUrl}`);
        localStorage.setItem(STORAGE_KEY_STORE_URL, storeUrl);
      } else {
        console.warn('[engine] /api/store-url not available yet — trying localStorage');
        storeUrl = localStorage.getItem(STORAGE_KEY_STORE_URL);
      }
    } else {
      // EXTENSION-ONLY: hostname from storage is only used in extension mode.
      // Web deployments always derive hostname from window.location via isProductionWebMode().
      hostname = (await readFromStorage(STORAGE_KEY_HOSTNAME)) ?? 'appdocker01.local';
      // Saved connections from before idea#100 have no port → default HTTP port.
      httpHost = formatHostPort(hostname, parsePort(await readFromStorage(STORAGE_KEY_PORT)));
      const envStoreUrl = import.meta.env.VITE_STORE_URL as string | undefined;
      storeUrl = envStoreUrl ?? (await readFromStorage(STORAGE_KEY_STORE_URL));

      // Always ask the Engine: it may advertise its WS port, and it provides the
      // store URL when none is saved (so the operator never has to paste it).
      const info = await fetchStoreInfoFromEngine(httpHost);
      wsPort = info?.wsPort ?? null;
      if (!storeUrl && info?.url) {
        storeUrl = info.url;
        console.info(`[engine] Store URL from /api/store-url: ${storeUrl}`);
      }
    }

    if (!storeUrl) {
      console.warn('[engine] No store URL available — cannot connect');
      const clsErr: CommandLogError = { error: true, url: `http://${httpHost}/api/command-log-url`, status: null };
      return { store, connected, sendCommand: noopSend, changeDoc: noopChange, commandLogStore: () => clsErr, dispose };
    }

    // Bail immediately if dispose() was called while we were awaiting storage/fetch.
    if (disposed) {
      const clsErr: CommandLogError = { error: true, url: '', status: null };
      return { store, connected, sendCommand: noopSend, changeDoc: noopChange, commandLogStore: () => clsErr, dispose };
    }

    // --- Connect via Automerge WebSocket ---
    const { Repo } = await import('@automerge/automerge-repo');
    const { BrowserWebSocketClientAdapter } = await import(
      '@automerge/automerge-repo-network-websocket'
    );

    const wsUrl = buildEngineWsUrl(hostname, wsPort);
    console.info(`[engine] Connecting to ${wsUrl}`);

    const adapter = new BrowserWebSocketClientAdapter(wsUrl);
    const repo = new Repo({ network: [adapter] });
    adapterRef = adapter;
    repoRef = repo;

    // Bail if dispose() was called while we were awaiting module imports.
    if (disposed) {
      dispose();
      const clsErr: CommandLogError = { error: true, url: '', status: null };
      return { store, connected, sendCommand: noopSend, changeDoc: noopChange, commandLogStore: () => clsErr, dispose };
    }

    // In automerge-repo 2.3.0-alpha+, repo.find() returns a Promise<DocHandle>.
    // In 2.2.x it returned a DocHandle directly. We await to handle both.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handle: any = await (repo.find(storeUrl as any) as unknown as Promise<any>);

    // NOTE: BrowserWebSocketClientAdapter.whenReady() is NOT a reliable signal
    // of actual connectivity — the adapter calls forceReady() after just 1 second
    // regardless of whether the WebSocket handshake actually succeeded. Waiting
    // on it would cause us to incorrectly set connected=true and cancel the
    // fallback timer even when the engine is unreachable.
    //
    // Instead we use document data as the connectivity signal:
    //   • connected=true fires only when the first real document data arrives
    //   • The 30 s fallback timer in App.tsx handles the "never connected" case
    console.info(`[engine] Repo created — waiting for document data from ${wsUrl}`);

    // Connect to the command-log doc (same WS repo, separate Automerge doc).
    // This runs in parallel; don't let it block the main connection.
    const commandLogStore = await createCommandLogConnection(httpHost, repo);

    if (disposed) {
      dispose();
      return { store, connected, sendCommand: noopSend, changeDoc: noopChange, commandLogStore: () => commandLogStore(), dispose };
    }

    // If the doc is already ready (cached / fast server), apply it immediately.
    const initialDoc = handle.doc();
    if (initialDoc) {
      setStore(initialDoc as Store);
      setConnected(true);
      console.info('[engine] Document already ready on connect');
    }

    // Subscribe to document changes — fires whenever Automerge syncs new data.
    handle.addListener?.('change', ({ doc: d }: { doc: unknown }) => {
      if (disposed) return;
      setStore(d as Store);
      setConnected(true);
    });

    // Also listen for heads-changed which fires even when patches are empty
    // (e.g. first-time sync of a document that was created with no changes).
    handle.addListener?.('heads-changed', ({ doc: d }: { doc: unknown }) => {
      if (disposed) return;
      if (d) {
        setStore(d as Store);
        setConnected(true);
      }
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

    return { store, connected, sendCommand, changeDoc, commandLogStore, dispose };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 'Document ... is unavailable' means the peer hasn't synced the doc yet.
    // This is transient — retry once after 3 s to give Automerge time to propagate.
    if ((msg.includes('unavailable') || msg.includes('Unavailable')) && retries > 0) {
      console.warn(`[engine] Document unavailable — retrying in 3 s... (${retries} left)`);
      await new Promise(r => setTimeout(r, 3_000));
      return createEngineConnection(retries - 1);
    }
    console.error('[engine] Failed to connect:', err);
    setConnected(false);
    dispose();
    const clsErr: CommandLogError = { error: true, url: '', status: null };
    return { store, connected, sendCommand: noopSend, changeDoc: noopChange, commandLogStore: () => clsErr, dispose };
  }
}
