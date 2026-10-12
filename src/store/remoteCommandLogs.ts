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

/**
 * idea#168 r86i FAIL@105: one view over the connected Engine's command log and the target
 * Engine's own log. A command sent to another Engine (EmptyDiskPanel erase of a disk docked on
 * idea03 while the Console talks to idea01) leaves its trace only in the target's log. Waiting on
 * our own log alone timed out with "The Engine didn't respond" although idea03 had answered
 * summariseDisk within a second. Trace ids are unique, so a union is safe. When neither log is
 * loaded, the first input is returned unchanged (null / error), so callers keep their old behaviour.
 */
export const mergeCommandLogs = (...logs: CommandLogState[]): CommandLogState => {
  const loaded = logs.filter(isLoadedLog) as Exclude<CommandLogState, null | { error: true }>[];
  if (loaded.length === 0) return logs[0] ?? null;
  if (loaded.length === 1) return loaded[0];
  const traces: Record<string, unknown> = {};
  const recent: string[] = [];
  for (const l of loaded) {
    Object.assign(traces, l.traces ?? {});
    for (const id of l.recentTraceIds ?? []) if (!recent.includes(id)) recent.push(id);
  }
  return { ...loaded[0], traces, recentTraceIds: recent } as CommandLogState;
};
