/**
 * Wait for the result of a command the Console just sent (files-disk.md §8,
 * idea#132). Reusable: createFilesDisk uses it now; Backup Disk, Install App
 * and eraseDisk can use it later.
 *
 *   1. Before sending, record the IDs of the traces that already exist.
 *   2. The result is the first NEW trace of that command whose ID argument
 *      (`args.diskId` or `args.targetId`) matches. No timestamps: a school Pi
 *      may have no NTP.
 *   3. Error: the trace's errorMessage (or its last error log line, for
 *      Engines that log a refusal and close the trace as ok).
 *   4. Success: the trace is ok AND the caller's extra condition holds (for
 *      createFilesDisk: the disk's diskTypes includes 'files').
 *   5. Timeout after COMMAND_RESULT_TIMEOUT_MS.
 */
import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from 'solid-js';
import type { CommandLogState } from './commandLog';
import type { CommandLogStore, CommandTrace } from '../types/commandLog';
import { traceIdSnapshot } from './ejectResult';

/** How long to wait for the Engine's answer. */
export const COMMAND_RESULT_TIMEOUT_MS = 15_000;

/** Timeout message for the Files actions (files-disk.md §4). */
export const FILES_TIMEOUT_MESSAGE = "The Engine didn't respond. It may not support Files Disks yet.";

export type TraceArgKey = 'diskId' | 'targetId';

export type TraceOutcome =
  | { kind: 'ok' }
  | { kind: 'error'; message: string };

const ANSI_RE = /\u001b\[[0-9;]*m/g;
const clean = (s: string): string => s.replace(ANSI_RE, '').trim();

/** Reads a named argument of a trace (object args, or a JSON string). */
export const traceArg = (trace: CommandTrace, key: string): string | null => {
  try {
    const args: unknown = typeof trace.args === 'string' ? JSON.parse(trace.args) : trace.args;
    if (args && typeof args === 'object' && !Array.isArray(args)) {
      const v = (args as Record<string, unknown>)[key];
      return v != null ? String(v) : null;
    }
  } catch {
    // malformed args: not ours
  }
  return null;
};

/** Traces in insertion order (recentTraceIds first, then any others). */
const orderedTraces = (cls: CommandLogStore): CommandTrace[] => {
  const traces = cls.traces ?? {};
  const seen = new Set<string>();
  const out: CommandTrace[] = [];
  for (const id of cls.recentTraceIds ?? []) {
    const t = traces[id];
    if (t && !seen.has(id)) { seen.add(id); out.push(t); }
  }
  for (const [id, t] of Object.entries(traces)) {
    if (!seen.has(id)) out.push(t);
  }
  return out;
};

/**
 * The outcome of the first new `command` trace whose `argKey` equals
 * `argValue`, or null while there is none or it is still running.
 */
/** How to match the target argument on a new trace (idea#122). */
export type ArgMatchMode = 'key' | 'includes';

/**
 * True when this trace is the one we sent: exact named arg, or (includes)
 * the value appears anywhere in the serialized args — needed for installApp,
 * which records a single positional string rather than named diskId.
 */
export const traceMatchesArg = (
  trace: CommandTrace,
  argKey: TraceArgKey,
  argValue: string,
  mode: ArgMatchMode = 'key'
): boolean => {
  if (mode === 'key') return traceArg(trace, argKey) === argValue;
  const raw = typeof trace.args === 'string' ? trace.args : JSON.stringify(trace.args ?? '');
  return raw.includes(argValue);
};

export const findCommandOutcome = (
  cls: CommandLogState,
  baseline: Set<string>,
  command: string,
  argKey: TraceArgKey,
  argValue: string,
  matchMode: ArgMatchMode = 'key'
): TraceOutcome | null => {
  if (!cls || 'error' in cls) return null;
  const trace = orderedTraces(cls).find((t) =>
    !baseline.has(t.traceId) && t.command === command && traceMatchesArg(t, argKey, argValue, matchMode)
  );
  if (!trace || trace.status === 'running') return null;
  const errorLogs = (trace.logs ?? []).filter((l) => l.level === 'error');
  const lastErrorLog = errorLogs.length > 0 ? clean(errorLogs[errorLogs.length - 1].message) : '';
  if (trace.status === 'error') {
    return { kind: 'error', message: clean(trace.errorMessage ?? '') || lastErrorLog || `${command} failed` };
  }
  if (lastErrorLog) return { kind: 'error', message: lastErrorLog };
  return { kind: 'ok' };
};

export type CommandResultState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'success' }
  | { kind: 'error'; message: string }
  | { kind: 'timeout' };

export interface CommandResultOptions {
  commandLog: Accessor<CommandLogState>;
  command: string;
  argKey: TraceArgKey;
  /** 'key' (default): args[argKey] === value. 'includes': value appears in args JSON. */
  matchMode?: ArgMatchMode;
  /** Extra success condition, checked once the trace is ok (e.g. the disk has 'files'). */
  isSuccess?: () => boolean;
  timeoutMs?: number;
}

export interface CommandResult {
  state: Accessor<CommandResultState>;
  /** Record the baseline, then call `send`, then wait for the answer. */
  start: (argValue: string, send: () => void) => void;
  reset: () => void;
}

/** Solid primitive around findCommandOutcome with the timeout. Call inside a component. */
export function createCommandResult(opts: CommandResultOptions): CommandResult {
  type Pending = { baseline: Set<string>; argValue: string };
  const [pending, setPending] = createSignal<Pending | null>(null);
  const [state, setState] = createSignal<CommandResultState>({ kind: 'idle' });
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clearTimer = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };
  onCleanup(clearTimer);

  // Reads the command log only while waiting.
  const outcome = createMemo(() => {
    const p = pending();
    if (!p) return null;
    return findCommandOutcome(opts.commandLog(), p.baseline, opts.command, opts.argKey, p.argValue, opts.matchMode ?? 'key');
  });

  createEffect(() => {
    const o = outcome();
    if (!o || !pending()) return;
    if (o.kind === 'error') {
      clearTimer();
      setPending(null);
      setState({ kind: 'error', message: o.message });
      return;
    }
    if (!opts.isSuccess || opts.isSuccess()) {
      clearTimer();
      setPending(null);
      setState({ kind: 'success' });
    }
  });

  const start = (argValue: string, send: () => void) => {
    clearTimer();
    setPending({ baseline: traceIdSnapshot(opts.commandLog()), argValue });
    setState({ kind: 'pending' });
    timer = setTimeout(() => {
      timer = null;
      if (pending()) {
        setPending(null);
        setState({ kind: 'timeout' });
      }
    }, opts.timeoutMs ?? COMMAND_RESULT_TIMEOUT_MS);
    send();
  };

  const reset = () => {
    clearTimer();
    setPending(null);
    setState({ kind: 'idle' });
  };

  return { state, start, reset };
}
