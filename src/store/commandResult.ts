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
 *   5. Timeout after COMMAND_RESULT_TIMEOUT_MS. With `longRunning`, the
 *      timeout only covers "no trace at all": once the Engine has opened a
 *      matching trace (it accepted the command), we keep waiting for it to
 *      close, so a restore or copy that runs for minutes is not reported as
 *      "no response" (r29@97 forensics).
 *
 * Refusals the Engine records BEFORE running a command (unknown command,
 * "Too many arguments", "Insufficient arguments") carry the raw tokens as a
 * positional array, not named args (Engine commandUtils.ts recordErrorTrace),
 * so `key` matching also accepts an exact token in a positional array.
 */
import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from 'solid-js';
import type { CommandLogState } from './commandLog';
import type { CommandLogStore, CommandTrace } from '../types/commandLog';
import { traceIdSnapshot } from './ejectResult';

/** How long to wait for the Engine's answer. */
export const COMMAND_RESULT_TIMEOUT_MS = 15_000;

/** Timeout message for the Files actions (files-disk.md §4). */
export const FILES_TIMEOUT_MESSAGE = "The Engine didn't respond. It may not support Files Disks yet.";

export type TraceArgKey = 'diskId' | 'targetId' | 'instanceName' | 'operationId';

export type TraceOutcome =
  | { kind: 'ok' }
  | { kind: 'error'; message: string };

const ANSI_RE = /\u001b\[[0-9;]*m/g;
const clean = (s: string): string => s.replace(ANSI_RE, '').trim();

/** Parsed trace args: an object (named), an array (positional) or null. */
const parsedArgs = (trace: CommandTrace): unknown => {
  try {
    return typeof trace.args === 'string' ? JSON.parse(trace.args) : trace.args;
  } catch {
    return null; // malformed args: not ours
  }
};

/** Reads a named argument of a trace (object args, or a JSON string). */
export const traceArg = (trace: CommandTrace, key: string): string | null => {
  const args = parsedArgs(trace);
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    const v = (args as Record<string, unknown>)[key];
    return v != null ? String(v) : null;
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

/** How to match the target argument on a new trace (idea#122). */
export type ArgMatchMode = 'key' | 'includes';

/**
 * True when this trace is the one we sent: exact named arg, or an exact
 * token of a positional args array (pre-execute refusals), or (includes)
 * the value appears anywhere in the serialized args — needed for installApp,
 * which records a single positional string rather than named diskId.
 */
export const traceMatchesArg = (
  trace: CommandTrace,
  argKey: TraceArgKey,
  argValue: string,
  mode: ArgMatchMode = 'key'
): boolean => {
  if (mode === 'key') {
    const args = parsedArgs(trace);
    if (Array.isArray(args)) return args.some((a) => String(a) === argValue);
    return traceArg(trace, argKey) === argValue;
  }
  const raw = typeof trace.args === 'string' ? trace.args : JSON.stringify(trace.args ?? '');
  return raw.includes(argValue);
};

/** The first new `command` trace matching the argument (running or closed), or null. */
export const findCommandTrace = (
  cls: CommandLogState,
  baseline: Set<string>,
  command: string,
  argKey: TraceArgKey,
  argValue: string,
  matchMode: ArgMatchMode = 'key'
): CommandTrace | null => {
  if (!cls || 'error' in cls) return null;
  return orderedTraces(cls).find((t) =>
    !baseline.has(t.traceId) && t.command === command && traceMatchesArg(t, argKey, argValue, matchMode)
  ) ?? null;
};

/** Outcome of a closed trace (null while running). */
export const traceOutcome = (trace: CommandTrace, command: string): TraceOutcome | null => {
  if (trace.status === 'running') return null;
  const errorLogs = (trace.logs ?? []).filter((l) => l.level === 'error');
  const lastErrorLog = errorLogs.length > 0 ? clean(errorLogs[errorLogs.length - 1].message) : '';
  if (trace.status === 'error') {
    return { kind: 'error', message: clean(trace.errorMessage ?? '') || lastErrorLog || `${command} failed` };
  }
  if (lastErrorLog) return { kind: 'error', message: lastErrorLog };
  return { kind: 'ok' };
};

/**
 * The outcome of the first new `command` trace whose `argKey` equals
 * `argValue`, or null while there is none or it is still running.
 */
export const findCommandOutcome = (
  cls: CommandLogState,
  baseline: Set<string>,
  command: string,
  argKey: TraceArgKey,
  argValue: string,
  matchMode: ArgMatchMode = 'key'
): TraceOutcome | null => {
  const trace = findCommandTrace(cls, baseline, command, argKey, argValue, matchMode);
  return trace ? traceOutcome(trace, command) : null;
};

export type CommandResultState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'success' }
  | { kind: 'error'; message: string }
  | { kind: 'timeout' };

/** Per-send overrides, so one result can follow different commands (start/stop/backup on a row). */
export interface CommandResultTarget {
  command?: string;
  argKey?: TraceArgKey;
  matchMode?: ArgMatchMode;
  longRunning?: boolean;
}

export interface CommandResultOptions {
  commandLog: Accessor<CommandLogState>;
  /** Default command; a `start` call can override it. */
  command?: string;
  argKey?: TraceArgKey;
  /** 'key' (default): args[argKey] === value. 'includes': value appears in args JSON. */
  matchMode?: ArgMatchMode;
  /** Extra success condition, checked once the trace is ok (e.g. the disk has 'files'). */
  isSuccess?: () => boolean;
  timeoutMs?: number;
  /** Stop the timeout once a matching (running) trace appears; wait for it to close. */
  longRunning?: boolean;
}

export interface CommandResult {
  state: Accessor<CommandResultState>;
  /** The command the current state belongs to (set by the last `start`). */
  command: Accessor<string | null>;
  /** Record the baseline, then call `send`, then wait for the answer. */
  start: (argValue: string, send: () => void, target?: CommandResultTarget) => void;
  reset: () => void;
}

/** Solid primitive around findCommandOutcome with the timeout. Call inside a component. */
export function createCommandResult(opts: CommandResultOptions): CommandResult {
  type Pending = {
    baseline: Set<string>;
    argValue: string;
    command: string;
    argKey: TraceArgKey;
    matchMode: ArgMatchMode;
    longRunning: boolean;
  };
  const [pending, setPending] = createSignal<Pending | null>(null);
  const [state, setState] = createSignal<CommandResultState>({ kind: 'idle' });
  const [command, setCommand] = createSignal<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clearTimer = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };
  onCleanup(clearTimer);

  // Reads the command log only while waiting.
  const found = createMemo(() => {
    const p = pending();
    if (!p) return null;
    const trace = findCommandTrace(opts.commandLog(), p.baseline, p.command, p.argKey, p.argValue, p.matchMode);
    if (!trace) return null;
    return { accepted: true, outcome: traceOutcome(trace, p.command) };
  });

  createEffect(() => {
    const f = found();
    const p = pending();
    if (!f || !p) return;
    // The Engine opened a trace: it received the command. Long operations
    // (restore, backup, copy, move) are no longer at risk of "no response".
    if (p.longRunning) clearTimer();
    const o = f.outcome;
    if (!o) return;
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

  const start = (argValue: string, send: () => void, target?: CommandResultTarget) => {
    clearTimer();
    const cmd = target?.command ?? opts.command ?? '';
    setCommand(cmd);
    setPending({
      baseline: traceIdSnapshot(opts.commandLog()),
      argValue,
      command: cmd,
      argKey: target?.argKey ?? opts.argKey ?? 'diskId',
      matchMode: target?.matchMode ?? opts.matchMode ?? 'key',
      longRunning: target?.longRunning ?? opts.longRunning ?? false,
    });
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
    setCommand(null);
  };

  return { state, command, start, reset };
}
