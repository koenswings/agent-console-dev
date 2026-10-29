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
 * - The watchdog checks every CHECK_MS (5 s). After DEAD_MS (15 s) without any
 *   inbound message it forces a reconnect on the SAME adapter (same Repo, same
 *   doc handles and listeners), and the Repo re-syncs.
 * - Capability by observation: it only arms after the first 'idea/hb' on this
 *   connection. Older Engines that send no hb behave exactly as before.
 * - Backoff: each forced reconnect with nothing heard since doubles the silence
 *   allowed (15 s, 30 s, 60 s, capped at MAX_DEAD_MS). Any inbound message
 *   resets it. The adapter's own retry (every 5 s) redials a refused socket.
 */

export const CHECK_MS = 5_000;
export const DEAD_MS = 15_000;
export const MAX_DEAD_MS = 60_000;

export interface LivenessClock {
  now: () => number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
}

const realClock: LivenessClock = {
  now: () => Date.now(),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (id) => globalThis.clearInterval(id as ReturnType<typeof setInterval>),
};

export interface SocketLiveness {
  /** Any inbound message on the socket. */
  heard: () => void;
  /** An 'idea/hb' arrived: the Engine beats, so silence means a dead socket. */
  beat: () => void;
  /** Silence allowed before the next forced reconnect (for tests and health). */
  deadAfterMs: () => number;
  /** Forced reconnects so far. */
  forcedReconnects: () => number;
  lastHeardAgeMs: () => number;
  dispose: () => void;
}

export const createSocketLiveness = (onDead: () => void, clock: LivenessClock = realClock): SocketLiveness => {
  let armed = false;
  let lastHeard = clock.now();
  let deadAfter = DEAD_MS;
  let forced = 0;
  let timer: unknown = null;

  const check = () => {
    if (!armed || clock.now() - lastHeard < deadAfter) return;
    forced += 1;
    console.warn(`[engine] store socket silent for ${Math.round((clock.now() - lastHeard) / 1000)} s; reconnecting (#${forced})`);
    lastHeard = clock.now();
    deadAfter = Math.min(deadAfter * 2, MAX_DEAD_MS);
    onDead();
  };

  return {
    heard: () => { lastHeard = clock.now(); deadAfter = DEAD_MS; },
    beat: () => {
      lastHeard = clock.now();
      deadAfter = DEAD_MS;
      if (!armed) { armed = true; timer = clock.setInterval(check, CHECK_MS); }
    },
    deadAfterMs: () => deadAfter,
    forcedReconnects: () => forced,
    lastHeardAgeMs: () => clock.now() - lastHeard,
    dispose: () => { if (timer !== null) clock.clearInterval(timer); timer = null; armed = false; },
  };
};

/** The part of automerge-repo's WebSocketClientAdapter (2.5.x) we touch. */
export interface ReconnectableAdapter {
  socket?: { close: () => void; removeEventListener: (t: string, f: unknown) => void } | undefined;
  peerId?: string;
  peerMetadata?: unknown;
  remotePeerId?: string;
  onOpen?: unknown; onClose?: unknown; onMessage?: unknown; onError?: unknown;
  connect: (peerId: string, meta?: unknown) => void;
  emit: (event: 'peer-disconnected', payload: { peerId: string }) => boolean | void;
}

/**
 * Replace a silently dead socket on the same adapter. connect() on an adapter
 * that already has a socket detaches the old socket's listeners and dials a new
 * one; we tell the Repo the old peer is gone first so it re-syncs on 'peer'.
 * The old socket is closed with no listeners left, so its late close event
 * cannot schedule a second redial.
 */
export const forceReconnect = (adapter: ReconnectableAdapter): boolean => {
  const old = adapter.socket;
  const peerId = adapter.peerId;
  if (!old || !peerId) return false;
  if (adapter.remotePeerId) adapter.emit('peer-disconnected', { peerId: adapter.remotePeerId });
  adapter.connect(peerId, adapter.peerMetadata);
  try { old.close(); } catch { /* already closed */ }
  return true;
};
