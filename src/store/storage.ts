/**
 * storage.ts — Chrome extension storage helpers
 *
 * Uses chrome.storage.local when running as a real extension (IS_EXTENSION),
 * falls back to localStorage for web/dev mode. Detection is synchronous and
 * done once at module load — no async races, no timeouts.
 *
 * EXTENSION-ONLY: The chrome.storage.local path in csGet/csSet is EXTENSION-ONLY.
 * In web mode (isProductionWebMode or any served-from-server deployment), localStorage
 * is always used. If we ever ship the extension, restore the chrome.storage paths and
 * test carefully — see MEMORY.md note about chrome.storage silent hangs.
 */
import { IS_EXTENSION } from './context';

export const STORAGE_KEY_HOSTNAME = 'engineHostname';
export const STORAGE_KEY_STORE_URL = 'storeUrl';
/** Optional HTTP port for a manually entered `host:port` engine (idea#100). Absent = default port. */
export const STORAGE_KEY_PORT = 'enginePort';
export const STORAGE_KEY_MODE = 'displayMode';
export const STORAGE_KEY_DEMO = 'demoMode';
export const STORAGE_KEY_HISTORY = 'engineHistory';

export type DisplayMode = 'sidePanel' | 'popup' | 'window';

export async function csGet(keys: string[]): Promise<Record<string, string>> {
  if (IS_EXTENSION) {
    try {
      const r = await chrome.storage.local.get(keys);
      return r as Record<string, string>;
    } catch {
      // fall through to localStorage
    }
  }
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = localStorage.getItem(k);
    if (v !== null) out[k] = v;
  }
  return out;
}

export async function csSet(data: Record<string, string | boolean>): Promise<void> {
  if (IS_EXTENSION) {
    try {
      await chrome.storage.local.set(data);
      return;
    } catch {
      // fall through to localStorage
    }
  }
  for (const [k, v] of Object.entries(data)) {
    localStorage.setItem(k, String(v));
  }
}

export async function csRemove(keys: string[]): Promise<void> {
  if (IS_EXTENSION) {
    try {
      await chrome.storage.local.remove(keys);
      return;
    } catch {
      // fall through to localStorage
    }
  }
  for (const k of keys) localStorage.removeItem(k);
}

/**
 * Parse a TCP port from an unknown value (number or numeric string).
 * Returns null when missing or outside 1-65535.
 */
export function parsePort(value: unknown): number | null {
  let n: number;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && /^[0-9]+$/.test(value.trim())) n = parseInt(value.trim(), 10);
  else return null;
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

/**
 * Build the `host[:port]` authority used for HTTP calls to an engine.
 * No port (or port 80) gives the bare hostname, i.e. exactly today's URLs.
 */
export function formatHostPort(hostname: string, port?: number | null): string {
  return port != null && port !== 80 ? `${hostname}:${port}` : hostname;
}

export async function readStoredHostname(): Promise<string> {
  const r = await csGet([STORAGE_KEY_HOSTNAME]);
  return r[STORAGE_KEY_HOSTNAME] ?? '';
}

/**
 * Read the stored engine HTTP port. Returns null for connections saved before
 * ports were persisted (no key) or for invalid values, meaning "default port".
 */
export async function readStoredPort(): Promise<number | null> {
  const r = await csGet([STORAGE_KEY_PORT]);
  return parsePort(r[STORAGE_KEY_PORT]);
}

/**
 * Persist the selected engine. `port` is optional: when it is missing or the
 * default (80) any previously stored port is cleared, so a plain hostname
 * behaves exactly as before.
 */
export async function saveHostnameAndStoreUrl(
  hostname: string,
  storeUrl: string,
  port?: number | null,
): Promise<void> {
  await csSet({ [STORAGE_KEY_HOSTNAME]: hostname, [STORAGE_KEY_STORE_URL]: storeUrl });
  const valid = parsePort(port);
  if (valid !== null && valid !== 80) {
    await csSet({ [STORAGE_KEY_PORT]: String(valid) });
  } else {
    await csRemove([STORAGE_KEY_PORT]);
  }
}

export async function readStoredDemoMode(): Promise<boolean> {
  const r = await csGet([STORAGE_KEY_DEMO]);
  // Only return true if explicitly stored as 'true'.
  // Never default to demo mode — users should see engine discovery, not a mock.
  return r[STORAGE_KEY_DEMO] === 'true';
}

export async function saveDemoMode(val: boolean): Promise<void> {
  await csSet({ [STORAGE_KEY_DEMO]: String(val) });
}

export async function readEngineHistory(): Promise<string[]> {
  const r = await csGet([STORAGE_KEY_HISTORY]);
  try {
    return JSON.parse(r[STORAGE_KEY_HISTORY] ?? '[]');
  } catch {
    return [];
  }
}

export async function addToEngineHistory(hostname: string): Promise<void> {
  const bare = hostname.replace(/\.local$/i, '');
  const history = await readEngineHistory();
  const deduped = [bare, ...history.filter((h) => h !== bare)].slice(0, 10);
  await csSet({ [STORAGE_KEY_HISTORY]: JSON.stringify(deduped) });
}
