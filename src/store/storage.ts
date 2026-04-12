/**
 * storage.ts — Chrome extension storage helpers
 *
 * Centralises all chrome.storage.local / localStorage access.
 * Import from here instead of duplicating in components.
 */

export const STORAGE_KEY_HOSTNAME = 'engineHostname';
export const STORAGE_KEY_STORE_URL = 'storeUrl';
export const STORAGE_KEY_MODE = 'displayMode';
export const STORAGE_KEY_DEMO = 'demoMode';
export const STORAGE_KEY_HISTORY = 'engineHistory';

export type DisplayMode = 'sidePanel' | 'popup' | 'window';

function isExtensionContext(): boolean {
  try { return typeof chrome !== 'undefined' && !!chrome.runtime?.id; } catch { return false; }
}

export async function csGet(keys: string[]): Promise<Record<string, string>> {
  if (isExtensionContext()) {
    try {
      const r = await chrome.storage.local.get(keys);
      return r as Record<string, string>;
    } catch {}
  }
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = localStorage.getItem(k);
    if (v !== null) out[k] = v;
  }
  return out;
}

export async function csSet(data: Record<string, string | boolean>): Promise<void> {
  if (isExtensionContext()) {
    try { await chrome.storage.local.set(data); return; } catch {}
  }
  for (const [k, v] of Object.entries(data)) {
    localStorage.setItem(k, String(v));
  }
}

export async function readStoredHostname(): Promise<string> {
  const r = await csGet([STORAGE_KEY_HOSTNAME]);
  return r[STORAGE_KEY_HOSTNAME] ?? '';
}

export async function saveHostnameAndStoreUrl(hostname: string, storeUrl: string): Promise<void> {
  await csSet({ [STORAGE_KEY_HOSTNAME]: hostname, [STORAGE_KEY_STORE_URL]: storeUrl });
}

export async function readStoredDemoMode(): Promise<boolean> {
  const r = await csGet([STORAGE_KEY_DEMO]);
  if (STORAGE_KEY_DEMO in r) return r[STORAGE_KEY_DEMO] === 'true';
  const hostname = await readStoredHostname();
  return !hostname;
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
