/**
 * socketLiveness.ts: dead-socket detection for the Console's store websocket
 * (agent-engine-dev#168; Engine side is agent-engine-dev PR #285).
 *
 * A browser cannot send or see ws ping/pong frames, and the Engine's ws server
 * answers no app-level ping. What the browser CAN observe without any Engine
 * change is inbound traffic on the adapter: Automerge sync messages and the
 * ephemeral 'idea/hb' every Engine broadcasts every 10 s (relayed by the
 * connected Engine for all its peers, see live.ts). So any inbound message on
 * the adapter counts as "heard".
 *
 * - The watchdog checks every CHECK_MS (5 s). After DEAD_MS (25 s) without any
 *   inbound message the socket counts as lost.
 * - Capability by observation: the watchdog only arms after the first 'idea/hb'
 *   on this connection. A socket close or error counts as lost on any Engine.
 * - Lost: the reconnector redials on the SAME adapter (same Repo, same doc
 *   handles and listeners) and the Repo re-syncs. Redials are spaced by
 *   BACKOFF_MS (25 s, 50 s, 100 s, then 100 s) until anything is heard again.
 *   A silent socket is redialled at once (its 25 s of silence was the first
 *   wait); a closed socket is redialled after 5 s, then 25/50/100 s. The adapter's own 5 s retry is off
 *   (singleSocketAdapter.ts), so this is the only retry, and each redial fully
 *   tears down the previous socket.
 */

export const CHECK_MS = 5_000;
export const DEAD_MS = 25_000;
export const MAX_DEAD_MS = 100_000;
/** Wait before redial n (0-based) while nothing is heard; the last repeats. */
/** First redial after a closed or refused socket. */
export const FIRST_RETRY_MS = 5_000;
export const BACKOFF_MS = [25_000, 50_000, 100_000] as const;

export interface LivenessClock {
  now: () => number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

const realClock: LivenessClock = {
  now: () => Date.now(),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (id) => globalThis.clearInterval(id as ReturnType<typeof setInterval>),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
};

/** 'live': traffic flows. 'reconnecting': the socket was lost and is being redialled. */
export type SocketState = 'live' | 'reconnecting';

export interface SocketLiveness {
  /** Any inbound message on the socket. */
  heard: () => void;
  /** An 'idea/hb' arrived: the Engine beats, so silence means a dead socket. */
  beat: () => void;
  /** The socket closed or errored. */
  dropped: () => void;
  state: () => SocketState;
  /** Redials so far. */
  forcedReconnects: () => number;
  lastHeardAgeMs: () => number;
  dispose: () => void;
}

export interface LivenessOptions {
  clock?: LivenessClock;
  onState?: (s: SocketState) => void;
}

/** `redial` replaces the socket; see forceReconnect. */
export const createSocketLiveness = (redial: () => void, opts: LivenessOptions = {}): SocketLiveness => {
  const clock = opts.clock ?? realClock;
  let armed = false;
  let lastHeard = clock.now();
  let forced = 0;
  let attempt = 0;
  let state: SocketState = 'live';
  let watchdog: unknown = null;
  let pending: unknown = null;
  let disposed = false;

  const setState = (s: SocketState) => { if (s !== state) { state = s; opts.onState?.(s); } };

  const dial = () => {
    pending = null;
    if (disposed) return;
    forced += 1;
    redial();
    // No traffic before the next wait ends: dial again (this also replaces a
    // socket stuck in CONNECTING behind a network block).
    schedule();
  };

  const schedule = () => {
    const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    pending = clock.setTimeout(dial, wait);
  };

  const lost = (silent: boolean) => {
    if (disposed || pending !== null) return;
    setState('reconnecting');
    if (attempt === 0 && silent) { attempt = 1; dial(); return; }
    // First retry after a close/refusal is quick (Engine restart); then 25/50/100 s.
    if (attempt === 0) { pending = clock.setTimeout(dial, FIRST_RETRY_MS); return; }
    schedule();
  };

  const check = () => {
    if (!armed || state !== 'live' || clock.now() - lastHeard < DEAD_MS) return;
    lost(true);
  };

  const heard = () => {
    lastHeard = clock.now();
    attempt = 0;
    if (pending !== null) { clock.clearTimeout(pending); pending = null; }
    setState('live');
  };

  return {
    heard,
    beat: () => {
      heard();
      if (!armed && !disposed) { armed = true; watchdog = clock.setInterval(check, CHECK_MS); }
    },
    dropped: () => lost(false),
    state: () => state,
    forcedReconnects: () => forced,
    lastHeardAgeMs: () => clock.now() - lastHeard,
    dispose: () => {
      disposed = true;
      if (watchdog !== null) clock.clearInterval(watchdog);
      if (pending !== null) clock.clearTimeout(pending);
      watchdog = null; pending = null; armed = false;
    },
  };
};

/** The part of the store adapter (singleSocketAdapter.ts) a redial touches. */
export interface ReconnectableAdapter {
  socket?: unknown;
  peerId?: string;
  peerMetadata?: unknown;
  remotePeerId?: string;
  connect: (peerId: string, meta?: unknown) => void;
  emit: (event: 'peer-disconnected', payload: { peerId: string }) => boolean | void;
}

/**
 * Redial on the same adapter. The Repo is told the old peer is gone first so it
 * re-syncs on the next 'peer'. The single-socket adapter's connect() closes and
 * detaches the old socket before it dials, so exactly one socket remains.
 */
export const forceReconnect = (adapter: ReconnectableAdapter): boolean => {
  const peerId = adapter.peerId;
  if (!peerId) return false;
  if (adapter.remotePeerId) {
    const remote = adapter.remotePeerId;
    adapter.remotePeerId = undefined;
    adapter.emit('peer-disconnected', { peerId: remote });
  }
  adapter.connect(peerId, adapter.peerMetadata);
  return true;
};
