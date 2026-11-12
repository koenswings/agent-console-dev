/**
 * singleSocketAdapter.ts: one live store websocket at a time (agent-engine-dev#168
 * follow-up to Console PR #174).
 *
 * Root cause of the 4 sockets seen on idea04: automerge-repo's
 * WebSocketClientAdapter (2.5.x) starts its own 5 s retry interval in connect()
 * and every tick calls connect() again. connect() detaches the listeners of the
 * previous socket but never closes it. Under a network block a dial does not
 * fail, it hangs in CONNECTING, so each tick left one more half-open socket
 * behind (our forced reconnect started that interval). When the block lifted,
 * all the pending handshakes completed within about a second: several open
 * sockets, only the newest one wired to the Repo.
 *
 * This subclass:
 * - fully tears down the previous socket (listeners off, close()) before every
 *   dial, so at most one socket exists;
 * - switches the adapter's own retry off (an interval so long it never fires),
 *   so the reconnector in socketLiveness.ts owns every redial and its
 *   25/50/100 s backoff governs retries;
 * - reports socket close/error to that reconnector.
 */

/** Longest delay a browser timer accepts (~24.8 days): the adapter's retry never fires. */
export const NO_ADAPTER_RETRY_MS = 2_147_483_647;

interface ListenerSocket {
  close: () => void;
  removeEventListener: (type: string, fn: never) => void;
}

/** The part of automerge-repo's WebSocketClientAdapter (2.5.x) this touches. */
export interface WsClientAdapterLike {
  socket?: unknown;
  onOpen: () => void;
  onClose: () => void;
  onMessage: (event: never) => void;
  onError: (event: never) => void;
  connect(peerId: never, peerMetadata?: never): void;
}

export type WsClientAdapterCtor<T extends WsClientAdapterLike> = new (url: string, retryInterval?: number) => T;

export interface SingleSocketHooks {
  /** The live socket closed or failed (after the adapter told the Repo). */
  onDrop?: () => void;
}

export const singleSocketAdapterClass = <T extends WsClientAdapterLike>(Base: WsClientAdapterCtor<T>) => {
  class SingleSocketAdapter extends (Base as WsClientAdapterCtor<WsClientAdapterLike>) {
    hooks: SingleSocketHooks = {};

    constructor(url: string) {
      super(url, NO_ADAPTER_RETRY_MS);
      const baseClose = this.onClose;
      this.onClose = () => { baseClose(); this.hooks.onDrop?.(); };
      const baseError = this.onError;
      this.onError = (e: never) => { baseError(e); this.hooks.onDrop?.(); };
    }

    /** Close and detach the current socket, if any. */
    teardownSocket(): void {
      const old = this.socket as ListenerSocket | undefined;
      if (!old) return;
      old.removeEventListener('open', this.onOpen as never);
      old.removeEventListener('close', this.onClose as never);
      old.removeEventListener('message', this.onMessage as never);
      old.removeEventListener('error', this.onError as never);
      try { old.close(); } catch { /* already closed */ }
    }

    override connect(peerId: never, peerMetadata?: never): void {
      this.teardownSocket();
      super.connect(peerId, peerMetadata);
    }
  }
  return SingleSocketAdapter as unknown as new (url: string) => T & { hooks: SingleSocketHooks; teardownSocket: () => void };
};
