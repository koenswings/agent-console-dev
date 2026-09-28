/**
 * Eject result detection (idea#152).
 *
 * The Engine records every command it runs as a CommandTrace in its
 * command-log document (see ../store/commandLog.ts). The Console finds the
 * result of an eject it just sent by snapshotting the trace IDs present at
 * click time (the baseline) and then looking for a *new* `ejectDisk` trace
 * whose `diskId` arg matches the disk. If none completes within
 * EJECT_TIMEOUT_MS, the caller shows a "no response" note.
 */
import type { CommandLogState } from './commandLog';
import type { CommandTrace } from '../types/commandLog';

/** How long to wait for the Engine's eject trace before giving up. */
export const EJECT_TIMEOUT_MS = 15_000;

export type EjectOutcome =
  | { kind: 'ok' }
  | { kind: 'error'; message: string };

/** Engine log lines are chalk-coloured; strip ANSI escape codes for display. */
const ANSI_RE = /\u001b\[[0-9;]*m/g;
const clean = (s: string): string => s.replace(ANSI_RE, '').trim();

/** Returns the trace IDs currently in the command log (empty when not loaded). */
export const traceIdSnapshot = (cls: CommandLogState): Set<string> => {
  if (!cls || 'error' in cls) return new Set();
  return new Set(Object.keys(cls.traces ?? {}));
};

/** Reads the disk ID an `ejectDisk` trace was called with (named or positional args). */
const traceDiskId = (trace: CommandTrace): string | null => {
  try {
    const args: unknown = typeof trace.args === 'string' ? JSON.parse(trace.args) : trace.args;
    if (Array.isArray(args)) return args[0] != null ? String(args[0]) : null;
    if (args && typeof args === 'object') {
      const v = (args as Record<string, unknown>)['diskId'];
      return v != null ? String(v) : null;
    }
  } catch {
    // malformed args — not ours
  }
  return null;
};

/**
 * Looks for the result of an eject sent after `baseline` was taken.
 * Returns null while there is no new, completed `ejectDisk` trace for `diskId`.
 *
 * A trace closed as 'error' is a failure. A trace closed as 'ok' that still
 * logged an error-level line is also a failure: the Engine's eject wrapper
 * reports refusals ("not currently docked", ambiguous name, locked disk) with
 * console.error and returns, which closes the trace as 'ok'.
 */
export const findEjectOutcome = (
  cls: CommandLogState,
  baseline: Set<string>,
  diskId: string
): EjectOutcome | null => {
  if (!cls || 'error' in cls) return null;
  const candidates = Object.values(cls.traces ?? {})
    .filter((t) => !baseline.has(t.traceId)
      && t.command === 'ejectDisk'
      && t.status !== 'running'
      && traceDiskId(t) === diskId)
    .sort((a, b) => b.startedAt - a.startedAt);
  const trace = candidates[0];
  if (!trace) return null;

  const errorLogs = (trace.logs ?? []).filter((l) => l.level === 'error');
  const lastErrorLog = errorLogs.length > 0 ? clean(errorLogs[errorLogs.length - 1].message) : '';

  if (trace.status === 'error') {
    const msg = clean(trace.errorMessage ?? '') || lastErrorLog || 'Eject failed';
    return { kind: 'error', message: msg };
  }
  if (lastErrorLog) return { kind: 'error', message: lastErrorLog };
  return { kind: 'ok' };
};
