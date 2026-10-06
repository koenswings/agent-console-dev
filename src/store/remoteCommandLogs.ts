/**
 * Approach (i) for cross-engine commands: follow the TARGET Engine's own
 * command log when the Console can reach it.
 *
 * Engines keep their command log in a separate Automerge doc whose URL is only
 * served over HTTP (GET /api/command-log-url, CORS *). It is not in the store.
 * The connection (engine.ts) can try to load another Engine's log through the
 * same WebSocket repo (the connected Engine relays the request to its peers).
 * Whether that works depends on the network (hostname reachable from the
 * browser, Engines peered), so it is opportunistic: a log is only used when it
 * was already loaded at send time (so the baseline of old traces is real).
 * Otherwise the panel falls back to approach (ii): store confirmation.
 */
import type { Accessor } from 'solid-js';
import type { CommandLogState } from './commandLog';

type RemoteLogFn = (engineId: string) => Accessor<CommandLogState> | null;

let _remoteLog: RemoteLogFn = () => null;

export const setRemoteCommandLogFn = (fn: RemoteLogFn): void => { _remoteLog = fn; };

/** The target Engine's command log accessor, or null when unavailable. */
export const remoteCommandLog = (engineId: string): Accessor<CommandLogState> | null => _remoteLog(engineId);

/** True when the log is loaded (a document, not loading/error). */
export const isLoadedLog = (cls: CommandLogState): boolean => !!cls && !('error' in cls);
