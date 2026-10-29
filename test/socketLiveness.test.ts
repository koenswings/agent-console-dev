import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CHECK_MS, DEAD_MS, MAX_DEAD_MS, createSocketLiveness, forceReconnect, type ReconnectableAdapter } from '../src/store/socketLiveness';

const clock = () => ({ now: () => Date.now(), setInterval: (f: () => void, ms: number) => setInterval(f, ms), clearInterval: (id: unknown) => clearInterval(id as ReturnType<typeof setInterval>) });

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('socket liveness watchdog (agent-engine-dev#168)', () => {
  it('is not armed until the first idea/hb (old Engines unchanged)', () => {
    const dead = vi.fn();
    const l = createSocketLiveness(dead, clock());
    l.heard();
    vi.advanceTimersByTime(10 * DEAD_MS);
    expect(dead).not.toHaveBeenCalled();
    l.dispose();
  });
  it('drops after 25 s of silence, checked every 5 s; hb every 10 s keeps it alive', () => {
    const dead = vi.fn();
    const l = createSocketLiveness(dead, clock());
    l.beat();
    for (let i = 0; i < 6; i++) { vi.advanceTimersByTime(10_000); l.beat(); }
    expect(dead).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DEAD_MS - 1);
    expect(dead).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CHECK_MS);
    expect(dead).toHaveBeenCalledTimes(1);
    expect(l.forcedReconnects()).toBe(1);
    l.dispose();
  });
  it('any inbound message counts as heard', () => {
    const dead = vi.fn();
    const l = createSocketLiveness(dead, clock());
    l.beat();
    for (let i = 0; i < 10; i++) { vi.advanceTimersByTime(CHECK_MS); l.heard(); }
    expect(dead).not.toHaveBeenCalled();
    l.dispose();
  });
  it('backs off 25, 50, 100, 100 s while nothing is heard, and resets on traffic', () => {
    const dead = vi.fn();
    const l = createSocketLiveness(dead, clock());
    l.beat();
    expect(l.deadAfterMs()).toBe(DEAD_MS);
    expect([DEAD_MS, MAX_DEAD_MS]).toEqual([25_000, 100_000]);
    vi.advanceTimersByTime(DEAD_MS); expect(dead).toHaveBeenCalledTimes(1); expect(l.deadAfterMs()).toBe(50_000);
    vi.advanceTimersByTime(50_000); expect(dead).toHaveBeenCalledTimes(2); expect(l.deadAfterMs()).toBe(MAX_DEAD_MS);
    vi.advanceTimersByTime(MAX_DEAD_MS); expect(dead).toHaveBeenCalledTimes(3); expect(l.deadAfterMs()).toBe(MAX_DEAD_MS);
    l.heard();
    expect(l.deadAfterMs()).toBe(DEAD_MS);
    expect([DEAD_MS, MAX_DEAD_MS]).toEqual([25_000, 100_000]);
    l.dispose();
  });
  it('dispose stops the timer', () => {
    const dead = vi.fn();
    const l = createSocketLiveness(dead, clock());
    l.beat(); l.dispose();
    vi.advanceTimersByTime(10 * MAX_DEAD_MS);
    expect(dead).not.toHaveBeenCalled();
  });
});

/**
 * Mirrors WebSocketClientAdapter.connect() in automerge-repo-network-websocket
 * 2.5.4: on a reconnect it detaches the old socket's four listeners and dials a
 * new socket. (The real class can't load here: vitest resolves ws to its
 * browser stub.)
 */
class FakeSocket {
  listeners: Record<string, Set<unknown>> = {};
  closed = false;
  addEventListener(t: string, f: unknown) { (this.listeners[t] ??= new Set()).add(f); }
  removeEventListener(t: string, f: unknown) { this.listeners[t]?.delete(f); }
  count() { return Object.values(this.listeners).reduce((n, x) => n + x.size, 0); }
  close() { this.closed = true; }
}
class FakeAdapter implements ReconnectableAdapter {
  socket?: FakeSocket; peerId?: string; peerMetadata?: unknown; remotePeerId?: string; sockets: FakeSocket[] = [];
  emitted: unknown[] = [];
  onOpen = () => {}; onClose = () => {}; onMessage = () => {}; onError = () => {};
  connect(peerId: string, meta?: unknown) {
    if (!this.socket || !this.peerId) { this.peerId = peerId; this.peerMetadata = meta ?? {}; }
    else for (const [t, f] of [['open', this.onOpen], ['close', this.onClose], ['message', this.onMessage], ['error', this.onError]] as const) this.socket.removeEventListener(t, f);
    this.socket = new FakeSocket(); this.sockets.push(this.socket);
    for (const [t, f] of [['open', this.onOpen], ['close', this.onClose], ['message', this.onMessage], ['error', this.onError]] as const) this.socket.addEventListener(t, f);
  }
  emit(_e: 'peer-disconnected', p: { peerId: string }) { this.emitted.push(p); return true; }
}

describe('forceReconnect (same adapter, same Repo)', () => {
  it('one new socket; the old one is detached and closed; the Repo is told the peer left', () => {
    const a = new FakeAdapter();
    a.connect('console-1');
    a.remotePeerId = 'engine-1';
    expect(forceReconnect(a)).toBe(true);
    expect(a.sockets).toHaveLength(2);
    expect(a.sockets[0].count()).toBe(0);
    expect(a.sockets[0].closed).toBe(true);
    expect(a.sockets[1].count()).toBe(4);
    expect(a.peerId).toBe('console-1');
    expect(a.emitted).toEqual([{ peerId: 'engine-1' }]);
    forceReconnect(a);
    expect(a.sockets.map((x) => x.count())).toEqual([0, 0, 4]);
  });
  it('does nothing before the adapter ever connected', () => {
    expect(forceReconnect(new FakeAdapter())).toBe(false);
  });
});
