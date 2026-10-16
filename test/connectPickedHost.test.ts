/**
 * Issue #150 — served from a Pi, an Engine picked in Connection Management must
 * drive the connection (its own /api/store-url and WS), not the page host.
 * A cross-origin 503 arrives as a fetch failure (no CORS header on the Engine's
 * 503 yet): both count as "not ready" and are retried.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import {
  createEngineConnection,
  fetchStoreInfoWithRetry,
  resolveConnectTarget,
  STORE_URL_ATTEMPTS,
  type PageLocation,
} from '../src/store/engine';

const PICKED_URL = 'automerge:picked04';
const PAGE: PageLocation = { productionWeb: true, hostname: 'idea01', port: '8080' };

type Answer = 'ok' | '503' | 'neterr';
/** fetch stub: per host, a queue of answers for /api/store-url (last one repeats). */
function stubFetch(plan: Record<string, Answer[]>) {
  const fn = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/store-url') {
      const q = plan[url.host] ?? ['neterr'];
      const a = q.length > 1 ? q.shift()! : q[0];
      if (a === 'neterr') throw new TypeError('Failed to fetch');
      if (a === '503') return new Response('{"error":"Store URL not available yet"}', { status: 503 });
      return new Response(JSON.stringify({ url: url.host.startsWith('idea04') ? PICKED_URL : 'automerge:page01' }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
const storeUrlCalls = (fn: ReturnType<typeof stubFetch>) =>
  fn.mock.calls.map((c) => String(c[0])).filter((u) => u.endsWith('/api/store-url'));

beforeEach(() => {
  localStorage.clear();
  wsUrls.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

describe('resolveConnectTarget', () => {
  it('a picked Engine wins over the page host when served from a Pi', () => {
    expect(resolveConnectTarget(PAGE, { hostname: 'idea04', port: 8080 })).toEqual({ hostname: 'idea04', httpHost: 'idea04:8080', picked: true });
  });
  it('without a pick, served from a Pi, the page host is the default', () => {
    expect(resolveConnectTarget(PAGE, null)).toEqual({ hostname: 'idea01', httpHost: 'idea01:8080', picked: false });
  });
  it('outside a Pi page with no pick, falls back to saved storage (null)', () => {
    expect(resolveConnectTarget({ productionWeb: false, hostname: 'localhost', port: '5173' }, null)).toBeNull();
  });
});

describe('createEngineConnection with a picked Engine (served from a Pi)', () => {
  it("uses the picked host's /api/store-url and WS, never the page host", async () => {
    const fn = stubFetch({ 'idea04:8080': ['ok'], 'idea01:8080': ['ok'] });
    const conn = await createEngineConnection(0, { page: PAGE, target: { hostname: 'idea04', port: 8080 }, storeUrlRetryMs: 1 });
    conn.dispose?.();
    expect(storeUrlCalls(fn)).toEqual(['http://idea04:8080/api/store-url']);
    expect(wsUrls).toEqual(['ws://idea04:4321']);
    expect(localStorage.getItem('storeUrl')).toBe(PICKED_URL);
  });

  it('without a pick it still connects to the page host', async () => {
    const fn = stubFetch({ 'idea01:8080': ['ok'] });
    const conn = await createEngineConnection(0, { page: PAGE });
    conn.dispose?.();
    expect(storeUrlCalls(fn)).toEqual(['http://idea01:8080/api/store-url']);
    expect(wsUrls).toEqual(['ws://idea01:4321']);
  });

  it('a fetch failure (cross-origin 503 without CORS) is "not ready" and retried, like a 503', async () => {
    const fn = stubFetch({ 'idea04:8080': ['neterr', '503', 'ok'] });
    const conn = await createEngineConnection(0, { page: PAGE, target: { hostname: 'idea04', port: 8080 }, storeUrlRetryMs: 1 });
    conn.dispose?.();
    expect(storeUrlCalls(fn)).toHaveLength(3);
    expect(wsUrls).toEqual(['ws://idea04:4321']);
  });
});

describe('fetchStoreInfoWithRetry', () => {
  it('retries fetch failures and returns the store info once ready', async () => {
    const fn = stubFetch({ idea04: ['neterr', 'neterr', 'ok'] });
    expect(await fetchStoreInfoWithRetry('idea04', { delayMs: 1 })).toEqual({ url: PICKED_URL, wsPort: null });
    expect(storeUrlCalls(fn)).toHaveLength(3);
  });
  it('retries 503s the same way', async () => {
    const fn = stubFetch({ idea04: ['503', 'ok'] });
    expect((await fetchStoreInfoWithRetry('idea04', { delayMs: 1 }))?.url).toBe(PICKED_URL);
    expect(storeUrlCalls(fn)).toHaveLength(2);
  });
  it('gives up after the attempt budget (null), never calling another host', async () => {
    const fn = stubFetch({ idea04: ['neterr'] });
    expect(await fetchStoreInfoWithRetry('idea04', { delayMs: 1 })).toBeNull();
    expect(storeUrlCalls(fn)).toEqual(Array(STORE_URL_ATTEMPTS).fill('http://idea04/api/store-url'));
  });
  it('stops retrying once the connection is disposed', async () => {
    const fn = stubFetch({ idea04: ['neterr'] });
    let n = 0;
    expect(await fetchStoreInfoWithRetry('idea04', { delayMs: 1, isDisposed: () => n++ >= 1 })).toBeNull();
    expect(storeUrlCalls(fn)).toHaveLength(1);
  });
});
