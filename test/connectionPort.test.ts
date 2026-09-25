/**
 * idea#100 — a manually entered `host:port` must survive probing, be persisted
 * with the connection and be used on (re)connect. The WS port comes from an
 * optional `wsPort` on /api/store-url, falling back to 4321.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Automerge mocks: record the WS URL, never open a real socket.
// ---------------------------------------------------------------------------

const wsUrls: string[] = [];

vi.mock('@automerge/automerge-repo-network-websocket', () => ({
  BrowserWebSocketClientAdapter: class {
    constructor(url: string) { wsUrls.push(url); }
    disconnect() { /* no-op */ }
  },
}));

vi.mock('@automerge/automerge-repo', () => ({
  Repo: class {
    find() {
      return Promise.resolve({ doc: () => null, addListener: () => undefined, change: () => undefined });
    }
    shutdown() { return Promise.resolve(); }
  },
}));

import { parseHostPort } from '../src/components/ConnectionManagement';
import {
  saveHostnameAndStoreUrl,
  readStoredHostname,
  readStoredPort,
  formatHostPort,
  parsePort,
  STORAGE_KEY_PORT,
} from '../src/store/storage';
import {
  createEngineConnection,
  buildEngineWsUrl,
  parseStoreUrlResponse,
  ENGINE_WS_PORT,
} from '../src/store/engine';

const STORE_URL = 'automerge:store123';

/** fetch stub: /api/store-url answers with `storeBody`, everything else 404s. */
function stubFetch(storeBody: Record<string, unknown>) {
  const fn = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/api/store-url')) {
      return new Response(JSON.stringify(storeBody), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const fetchedUrls = (fn: ReturnType<typeof stubFetch>) => fn.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  localStorage.clear();
  wsUrls.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('port helpers', () => {
  it('parseHostPort extracts the port and defaults to 80', () => {
    expect(parseHostPort('idea02:8080')).toEqual({ host: 'idea02', port: 8080 });
    expect(parseHostPort('idea02')).toEqual({ host: 'idea02', port: 80 });
  });

  it('parsePort accepts valid ports only', () => {
    expect(parsePort(8080)).toBe(8080);
    expect(parsePort('8080')).toBe(8080);
    expect(parsePort(undefined)).toBeNull();
    expect(parsePort('')).toBeNull();
    expect(parsePort('abc')).toBeNull();
    expect(parsePort(0)).toBeNull();
    expect(parsePort(70000)).toBeNull();
    expect(parsePort(80.5)).toBeNull();
  });

  it('formatHostPort omits missing/default ports', () => {
    expect(formatHostPort('idea02', 8080)).toBe('idea02:8080');
    expect(formatHostPort('idea02', 80)).toBe('idea02');
    expect(formatHostPort('idea02', null)).toBe('idea02');
    expect(formatHostPort('idea02')).toBe('idea02');
  });

  it('parseStoreUrlResponse reads an optional numeric wsPort', () => {
    expect(parseStoreUrlResponse({ url: STORE_URL, wsPort: 5000 })).toEqual({ url: STORE_URL, wsPort: 5000 });
    expect(parseStoreUrlResponse({ url: STORE_URL })).toEqual({ url: STORE_URL, wsPort: null });
    expect(parseStoreUrlResponse({ url: STORE_URL, wsPort: 'x' })).toEqual({ url: STORE_URL, wsPort: null });
    expect(parseStoreUrlResponse({ url: STORE_URL, wsPort: -1 })).toEqual({ url: STORE_URL, wsPort: null });
    expect(parseStoreUrlResponse(null)).toEqual({ url: null, wsPort: null });
  });

  it('buildEngineWsUrl uses the advertised port or falls back to 4321', () => {
    expect(ENGINE_WS_PORT).toBe(4321);
    expect(buildEngineWsUrl('idea02', 5000)).toBe('ws://idea02:5000');
    expect(buildEngineWsUrl('idea02', null)).toBe('ws://idea02:4321');
    expect(buildEngineWsUrl('idea02')).toBe('ws://idea02:4321');
  });
});

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

describe('saved connection storage', () => {
  it('persists the port alongside hostname and store URL', async () => {
    await saveHostnameAndStoreUrl('idea02.local', STORE_URL, 8080);
    expect(await readStoredHostname()).toBe('idea02.local');
    expect(await readStoredPort()).toBe(8080);
  });

  it('clears a previously stored port when saving a plain hostname', async () => {
    await saveHostnameAndStoreUrl('idea02.local', STORE_URL, 8080);
    await saveHostnameAndStoreUrl('idea01.local', STORE_URL);
    expect(localStorage.getItem(STORAGE_KEY_PORT)).toBeNull();
    expect(await readStoredPort()).toBeNull();
  });

  it('old saved connections without a port still load', async () => {
    // Shape written by Console versions before idea#100.
    localStorage.setItem('engineHostname', 'idea01.local');
    localStorage.setItem('storeUrl', STORE_URL);
    expect(await readStoredHostname()).toBe('idea01.local');
    expect(await readStoredPort()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createEngineConnection
// ---------------------------------------------------------------------------

describe('createEngineConnection ports', () => {
  it('parse → persist → reconnect uses the stored port for /api/store-url', async () => {
    const fetchFn = stubFetch({ url: STORE_URL });
    const { host, port } = parseHostPort('idea02:8080');
    await saveHostnameAndStoreUrl(host, STORE_URL, port);

    const conn = await createEngineConnection(0);
    conn.dispose?.();

    const urls = fetchedUrls(fetchFn);
    expect(urls).toContain('http://idea02:8080/api/store-url');
    expect(urls).toContain('http://idea02:8080/api/command-log-url');
    expect(urls.some((u) => u.startsWith('http://idea02/'))).toBe(false);
  });

  it('uses the stored port to fetch the store URL when none is saved', async () => {
    const fetchFn = stubFetch({ url: STORE_URL });
    localStorage.setItem('engineHostname', 'idea02');
    localStorage.setItem(STORAGE_KEY_PORT, '8080');

    const conn = await createEngineConnection(0);
    conn.dispose?.();

    expect(fetchedUrls(fetchFn)[0]).toBe('http://idea02:8080/api/store-url');
    expect(wsUrls).toEqual(['ws://idea02:4321']);
  });

  it('WS URL uses the advertised wsPort when present', async () => {
    stubFetch({ url: STORE_URL, wsPort: 5555 });
    await saveHostnameAndStoreUrl('idea02', STORE_URL, 8080);

    const conn = await createEngineConnection(0);
    conn.dispose?.();

    expect(wsUrls).toEqual(['ws://idea02:5555']);
  });

  it('WS falls back to 4321 when wsPort is absent', async () => {
    stubFetch({ url: STORE_URL });
    await saveHostnameAndStoreUrl('idea02', STORE_URL, 8080);

    const conn = await createEngineConnection(0);
    conn.dispose?.();

    expect(wsUrls).toEqual(['ws://idea02:4321']);
  });

  it('WS falls back to 4321 when /api/store-url is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    await saveHostnameAndStoreUrl('idea02', STORE_URL, 8080);

    const conn = await createEngineConnection(0);
    conn.dispose?.();

    expect(wsUrls).toEqual(['ws://idea02:4321']);
  });

  it('plain hostname behaves as before: default HTTP port, WS 4321', async () => {
    const fetchFn = stubFetch({ url: STORE_URL });
    await saveHostnameAndStoreUrl('idea01.local', STORE_URL);

    const conn = await createEngineConnection(0);
    conn.dispose?.();

    const urls = fetchedUrls(fetchFn);
    expect(urls).toContain('http://idea01.local/api/store-url');
    expect(urls).toContain('http://idea01.local/api/command-log-url');
    expect(wsUrls).toEqual(['ws://idea01.local:4321']);
  });

  it('old saved connection without a port connects on the default ports', async () => {
    const fetchFn = stubFetch({ url: STORE_URL });
    localStorage.setItem('engineHostname', 'idea01.local');
    localStorage.setItem('storeUrl', STORE_URL);

    const conn = await createEngineConnection(0);
    conn.dispose?.();

    expect(fetchedUrls(fetchFn)).toContain('http://idea01.local/api/store-url');
    expect(wsUrls).toEqual(['ws://idea01.local:4321']);
  });
});
