/**
 * The real automerge-repo BrowserWebSocketClientAdapter (2.5.4) on a mock
 * WebSocket (isomorphic-ws is aliased in vitest.config.ts), agent-engine-dev#168.
 * Replays the idea04 run: socket goes silent, network blocked (dials hang in
 * CONNECTING), block lifts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';
import { singleSocketAdapterClass, type WsClientAdapterCtor, type WsClientAdapterLike } from '../src/store/singleSocketAdapter';
import { BACKOFF_MS, DEAD_MS, createSocketLiveness, forceReconnect, type ReconnectableAdapter } from '../src/store/socketLiveness';

class MockWebSocket {
  static all: MockWebSocket[] = [];
  static blocked = false;
  readyState = 0;
  binaryType = '';
  listeners: Record<string, Set<(e?: unknown) => void>> = {};
  constructor(public url: string) { MockWebSocket.all.push(this); }
  addEventListener(t: string, f: (e?: unknown) => void) { (this.listeners[t] ??= new Set()).add(f); }
  removeEventListener(t: string, f: (e?: unknown) => void) { this.listeners[t]?.delete(f); }
  send() {}
  close() { if (this.readyState === 3) return; this.readyState = 3; this.fire('close'); }
  fire(t: string) { for (const f of [...(this.listeners[t] ?? [])]) f({}); }
  /** Handshake completes (network reachable). */
  open() { if (this.readyState !== 0) return; this.readyState = 1; this.fire('open'); }
  static live() { return MockWebSocket.all.filter((s) => s.readyState === 0 || s.readyState === 1); }
  /** The block lifts: every dial still pending completes its handshake. */
  static unblock() { MockWebSocket.blocked = false; for (const s of MockWebSocket.live()) s.open(); }
}

const clock = () => ({
  now: () => Date.now(),
  setInterval: (f: () => void, ms: number) => setInterval(f, ms),
  clearInterval: (id: unknown) => clearInterval(id as ReturnType<typeof setInterval>),
  setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
  clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
});

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.all = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const SingleSocketAdapter = singleSocketAdapterClass(BrowserWebSocketClientAdapter as unknown as WsClientAdapterCtor<WsClientAdapterLike>);

describe('root cause: stock adapter + forced reconnect leaves sockets behind', () => {
  it('the adapter 5 s retry dials again every tick without closing the pending socket', () => {
    const a = new BrowserWebSocketClientAdapter('ws://engine:4321');
    a.connect('console' as never);
    MockWebSocket.all[0].open();
    // Old #174 path: the socket went silent, we called connect() again, network is blocked.
    a.connect('console' as never);
    vi.advanceTimersByTime(15_000); // three adapter retry ticks
    MockWebSocket.unblock();
    expect(MockWebSocket.live().length).toBeGreaterThanOrEqual(4);
    a.disconnect();
  });
});

describe('single socket adapter (agent-engine-dev#168)', () => {
  const setup = () => {
    const a = new SingleSocketAdapter('ws://engine:4321');
    const l = createSocketLiveness(() => forceReconnect(a as unknown as ReconnectableAdapter), { clock: clock() });
    a.hooks.onDrop = () => l.dropped();
    a.connect('console' as never);
    MockWebSocket.all[0].open();
    l.beat();
    return { a, l };
  };

  it('silent socket + network block + unblock: exactly one live socket, older ones closed', () => {
    const { a, l } = setup();
    MockWebSocket.blocked = true;
    vi.advanceTimersByTime(DEAD_MS + 5 * 60_000);
    expect(MockWebSocket.live()).toHaveLength(1);
    MockWebSocket.unblock();
    expect(MockWebSocket.live()).toHaveLength(1);
    expect(MockWebSocket.live()[0]).toBe(MockWebSocket.all[MockWebSocket.all.length - 1]);
    for (const s of MockWebSocket.all.slice(0, -1)) {
      expect(s.readyState).toBe(3);
      expect(Object.values(s.listeners).reduce((n, x) => n + x.size, 0)).toBe(0);
    }
    l.dispose(); a.disconnect();
  });

  it('dials follow 25/50/100 s, not the adapter 5 s retry', () => {
    const { a, l } = setup();
    MockWebSocket.blocked = true;
    vi.advanceTimersByTime(DEAD_MS);           // silent: redial at once
    expect(MockWebSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(BACKOFF_MS[1] - 1);
    expect(MockWebSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.all).toHaveLength(3);
    vi.advanceTimersByTime(BACKOFF_MS[2] - 1);
    expect(MockWebSocket.all).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.all).toHaveLength(4);
    l.dispose(); a.disconnect();
  });

  it('a refused socket (close event) is retried after 5 s, then 25 s', () => {
    const { a, l } = setup();
    MockWebSocket.all[0].close();               // Engine restarted
    expect(l.state()).toBe('reconnecting');
    vi.advanceTimersByTime(5_000 - 1);
    expect(MockWebSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.all).toHaveLength(2);
    MockWebSocket.all[1].close();               // refused again
    vi.advanceTimersByTime(25_000 - 1);
    expect(MockWebSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.all).toHaveLength(3);
    expect(MockWebSocket.live()).toHaveLength(1);
    l.dispose(); a.disconnect();
  });

  it('disconnect leaves no socket and no timers dialling', () => {
    const { a, l } = setup();
    l.dispose(); a.disconnect();
    vi.advanceTimersByTime(10 * 60_000);
    expect(MockWebSocket.live()).toHaveLength(0);
    expect(MockWebSocket.all).toHaveLength(1);
  });
});
