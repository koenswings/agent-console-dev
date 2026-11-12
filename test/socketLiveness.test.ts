import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BACKOFF_MS, FIRST_RETRY_MS, CHECK_MS, DEAD_MS, createSocketLiveness, forceReconnect, type ReconnectableAdapter, type SocketState } from '../src/store/socketLiveness';

const clock = () => ({
  now: () => Date.now(),
  setInterval: (f: () => void, ms: number) => setInterval(f, ms),
  clearInterval: (id: unknown) => clearInterval(id as ReturnType<typeof setInterval>),
  setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
  clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
});

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('socket liveness watchdog (agent-engine-dev#168)', () => {
  it('is not armed until the first idea/hb (old Engines unchanged)', () => {
    const dead = vi.fn();
    const l = createSocketLiveness(dead, { clock: clock() });
    l.heard();
    vi.advanceTimersByTime(10 * DEAD_MS);
    expect(dead).not.toHaveBeenCalled();
    l.dispose();
  });
  it('drops after 25 s of silence, checked every 5 s; hb every 10 s keeps it alive', () => {
    const dead = vi.fn();
    const l = createSocketLiveness(dead, { clock: clock() });
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
    const l = createSocketLiveness(dead, { clock: clock() });
    l.beat();
    for (let i = 0; i < 10; i++) { vi.advanceTimersByTime(CHECK_MS); l.heard(); }
    expect(dead).not.toHaveBeenCalled();
    l.dispose();
  });
  it('logs nothing to the console', () => {
    const spies = (['log', 'warn', 'info', 'error'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    const l = createSocketLiveness(() => {}, { clock: clock() });
    l.beat(); vi.advanceTimersByTime(5 * MAX);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    l.dispose();
  });
  it('dispose stops every timer', () => {
    const dead = vi.fn();
    const l = createSocketLiveness(dead, { clock: clock() });
    l.beat(); l.dispose();
    vi.advanceTimersByTime(10 * MAX);
    l.dropped();
    vi.advanceTimersByTime(10 * MAX);
    expect(dead).not.toHaveBeenCalled();
  });
});

const MAX = BACKOFF_MS[BACKOFF_MS.length - 1];

describe('reconnect backoff 25/50/100 s', () => {
  it('constants', () => { expect([...BACKOFF_MS]).toEqual([25_000, 50_000, 100_000]); expect(FIRST_RETRY_MS).toBe(5_000); });
  it('silent socket: redial at once, then every 50, 100, 100 s until heard', () => {
    const dial = vi.fn();
    const l = createSocketLiveness(dial, { clock: clock() });
    l.beat();
    vi.advanceTimersByTime(DEAD_MS);
    expect(dial).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(50_000 - 1); expect(dial).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1); expect(dial).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(100_000 - 1); expect(dial).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1); expect(dial).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(100_000); expect(dial).toHaveBeenCalledTimes(4);
    l.heard();
    vi.advanceTimersByTime(DEAD_MS - 1); expect(dial).toHaveBeenCalledTimes(4);
    l.dispose();
  });
  it('closed socket: first retry after 5 s, then 25, 50, 100, 100 s; repeated drops add no dials', () => {
    const dial = vi.fn();
    const l = createSocketLiveness(dial, { clock: clock() });
    l.dropped();
    vi.advanceTimersByTime(FIRST_RETRY_MS - 1); expect(dial).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1); expect(dial).toHaveBeenCalledTimes(1);
    l.dropped(); l.dropped();
    for (const [i, gap] of [25_000, 50_000, 100_000, 100_000].entries()) {
      vi.advanceTimersByTime(gap - 1); expect(dial).toHaveBeenCalledTimes(i + 1);
      vi.advanceTimersByTime(1); expect(dial).toHaveBeenCalledTimes(i + 2);
      l.dropped();
    }
    l.heard();
    l.dropped();
    vi.advanceTimersByTime(FIRST_RETRY_MS); expect(dial).toHaveBeenCalledTimes(6);
    l.dispose();
  });
  it('state: live -> reconnecting on loss -> live on the first inbound message', () => {
    const states: SocketState[] = [];
    const l = createSocketLiveness(() => {}, { clock: clock(), onState: (s) => states.push(s) });
    expect(l.state()).toBe('live');
    l.beat(); vi.advanceTimersByTime(DEAD_MS);
    expect(l.state()).toBe('reconnecting');
    vi.advanceTimersByTime(30_000);
    l.heard();
    expect(l.state()).toBe('live');
    expect(states).toEqual(['reconnecting', 'live']);
    l.dispose();
  });
});

class FakeAdapter implements ReconnectableAdapter {
  peerId?: string; peerMetadata?: unknown; remotePeerId?: string; dials = 0;
  emitted: unknown[] = [];
  connect(peerId: string, meta?: unknown) { this.peerId = peerId; this.peerMetadata = meta ?? {}; this.dials++; }
  emit(_e: 'peer-disconnected', p: { peerId: string }) { this.emitted.push(p); return true; }
}

describe('forceReconnect (same adapter, same Repo)', () => {
  it('tells the Repo the peer left once, then dials on the same adapter', () => {
    const a = new FakeAdapter();
    a.connect('console-1');
    a.remotePeerId = 'engine-1';
    expect(forceReconnect(a)).toBe(true);
    expect(a.dials).toBe(2);
    expect(a.peerId).toBe('console-1');
    forceReconnect(a);
    expect(a.emitted).toEqual([{ peerId: 'engine-1' }]);
  });
  it('does nothing before the adapter ever connected', () => {
    expect(forceReconnect(new FakeAdapter())).toBe(false);
  });
});
