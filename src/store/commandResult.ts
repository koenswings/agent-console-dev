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
import { restartFailedFromTraceResult } from './updateApp';
import { traceIdSnapshot } from './ejectResult';
import { noteConnectedEngine } from './connectedEngine';
import { formatWait, type RemoteWatch } from './remoteConfirm';
import { isImmutableString, logJson, logText } from './logText';
import type { SendResult } from './signedCommand';
import { sendResultMessage } from './sendResultText';
import { pendingEngineConfirm } from './engineConfirm';

/** How long to wait for the Engine's answer. */
export const COMMAND_RESULT_TIMEOUT_MS = 15_000;

/** Timeout message for the Files actions (files-disk.md §4). */
export const FILES_TIMEOUT_MESSAGE = "The Engine didn't respond. It may not support Files Disks yet.";

export type TraceArgKey = 'diskId' | 'targetId' | 'instanceName' | 'operationId' | 'candidateId' | 'instanceId' | 'backupDiskId' | 'targetDiskId' | 'instanceIds' | 'stamp';

export type TraceOutcome =
  | { kind: 'ok'; code?: string | null }
  | { kind: 'error'; message: string; code?: string | null; restartFailed?: boolean }
  /** Finished, but not what was asked (e.g. a Done moveApp that did not move the app, engine#388). */
  | { kind: 'warning'; message: string; code?: string | null };

const ANSI_RE = /\u001b\[[0-9;]*m/g;
const clean = (s: string): string => s.replace(ANSI_RE, '').trim();

/** Parsed trace args: an object (named), an array (positional) or null. */
const parsedArgs = (trace: CommandTrace): unknown => {
  try {
    return logJson(trace.args);
  } catch {
    return null; // malformed args: not ours
  }
};

/**
 * The instance references of a trace (console#227): named args `instanceId` /
 * `instanceName`, or, for a positional trace, the first token of the first
 * arg. updateApp is positional: agent-engine-dev src/data/Commands.ts:726
 * declares one unnamed rest-of-line arg, src/utils/commandUtils.ts:104 keeps the
 * whole line as one token and :153 falls back to the positional array, so its
 * trace args are `["<instance> <newAppId> [--allow-major] [--source <diskId>]"]`.
 */
export const traceInstanceRefs = (trace: CommandTrace): string[] => {
  const args = parsedArgs(trace);
  if (Array.isArray(args)) {
    const first = args[0] == null ? '' : String(args[0]).trim().split(/\s+/)[0];
    return first ? [first] : [];
  }
  if (args && typeof args === 'object') {
    const a = args as Record<string, unknown>;
    return [a.instanceId, a.instanceName]
      .filter((v) => v != null && v !== '')
      .map((v) => String(v));
  }
  return [];
};

/** True when the trace is about this instance (by id, or by name when given). */
export const traceIsForInstance = (trace: CommandTrace, instanceId: string, instanceName?: string | null): boolean => {
  const refs = traceInstanceRefs(trace);
  return refs.includes(instanceId) || (!!instanceName && refs.includes(instanceName));
};

/** The newest trace of `command` for this instance, or null. */
export const latestInstanceTrace = (
  cls: CommandLogState,
  command: string,
  instanceId: string,
  instanceName?: string | null,
): CommandTrace | null => {
  if (!cls || 'error' in cls) return null;
  return Object.values(cls.traces ?? {})
    .filter((t) => t.command === command && traceIsForInstance(t, instanceId, instanceName))
    .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
};

/**
 * Trace args as an object for display (History detail): parsed JSON text
 * (string or ImmutableString, engine#471 b) or a legacy object; null when
 * the args are empty, not an object, or malformed.
 */
export const traceArgsObject = (trace: CommandTrace): Record<string, unknown> | null => {
  const args = parsedArgs(trace);
  return args && typeof args === 'object' ? (args as Record<string, unknown>) : null;
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
 * A second value that also identifies our trace (engine#399): the value that was
 * SENT when the primary match is on something else (an instance sent by name,
 * matched by id on a `traceInstanceId` Engine). Only used in 'key' mode.
 */
export interface TraceAltMatch {
  /** The value sent, e.g. an instance name; may contain spaces. */
  value: string;
  /** Named args: the arg that holds `value` (default: the primary argKey). */
  argKey?: TraceArgKey;
  /**
   * Named args: only match while this arg is null or absent. A traceInstanceId
   * Engine leaves `instanceName` null when the instance did not resolve, so a
   * resolved trace of another instance (whose id happens to equal the value) is not ours.
   */
  nullKey?: TraceArgKey;
  /**
   * The value sent right after it (the instance's disk: diskId, or the copy/move
   * source). In the args, in order, the name's tokens must be followed by it, so a
   * namesake on another disk never matches.
   */
  followedBy?: string;
}

/** The trace's args as tokens in order: a positional array, or the named values (lists flattened, nulls skipped). */
const argTokens = (args: unknown): string[] => {
  if (Array.isArray(args)) return args.map(String);
  if (!args || typeof args !== 'object') return [];
  return Object.values(args as Record<string, unknown>)
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .filter((v) => v != null)
    .map(String);
};

/**
 * True when the trace matches the second value. The Engine splits an unquoted
 * command line on single spaces, so a name "My App" arrives as the tokens `My`,
 * `App`: a refusal before execution ("Too many arguments") holds them as a run,
 * and so do the named values of startInstance (its variadic `options` swallow the
 * shifted rest). So the name matches as a contiguous run of the args in order,
 * followed by `followedBy`. A refusal holding only the name ("Insufficient
 * arguments") matches too: nothing in it tells namesakes apart.
 */
const traceMatchesAlt = (trace: CommandTrace, argKey: TraceArgKey, alt: TraceAltMatch): boolean => {
  const words = alt.value.split(' ').filter((w) => w.length > 0);
  if (words.length === 0) return false;
  const args = parsedArgs(trace);
  const tokens = argTokens(args);
  const positional = Array.isArray(args);
  if (!positional) {
    if (!args || typeof args !== 'object') return false;
    const rec = args as Record<string, unknown>;
    if (alt.nullKey && rec[alt.nullKey] != null) return false;
    const v = rec[alt.argKey ?? argKey];
    if (words.length === 1 && (v == null || String(v) !== alt.value)) return false;
  }
  if (positional && tokens.length === words.length) return words.every((w, j) => tokens[j] === w);
  return tokens.some((_, i) =>
    words.every((w, j) => tokens[i + j] === w)
    && (alt.followedBy == null || tokens[i + words.length] === alt.followedBy));
};

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
  mode: ArgMatchMode = 'key',
  alt?: TraceAltMatch | null
): boolean => {
  if (mode === 'key') {
    if (alt && traceMatchesAlt(trace, argKey, alt)) return true;
    const args = parsedArgs(trace);
    // Sent by name with a second value: the positional match above is the guarded one.
    if (alt && Array.isArray(args)) return false;
    // Pre-execute refusals: positional tokens. An instanceIds list (a,b) needs every id.
    if (Array.isArray(args)) {
      const wanted = argKey === 'instanceIds' ? argValue.split(',') : [argValue];
      return wanted.every((v) => args.some((a) => String(a) === v));
    }
    // A named list arg (removeDemo `instanceIds`, engine#369): the same ids in order.
    const named = args && typeof args === 'object' ? (args as Record<string, unknown>)[argKey] : undefined;
    if (Array.isArray(named)) return named.map(String).join(',') === argValue;
    if (traceArg(trace, argKey) !== argValue) return false;
    // The primary IS the sent name (an older Engine): only with the disk, i.e. the alt above.
    return !alt || alt.value !== argValue;
  }
  const raw = typeof trace.args === 'string' || isImmutableString(trace.args)
    ? logText(trace.args) ?? ''
    : JSON.stringify(trace.args ?? '');
  return raw.includes(argValue);
};

/** The first new `command` trace matching the argument (running or closed), or null. */
export const findCommandTrace = (
  cls: CommandLogState,
  baseline: Set<string>,
  command: string,
  argKey: TraceArgKey,
  argValue: string,
  matchMode: ArgMatchMode = 'key',
  alt?: TraceAltMatch | null
): CommandTrace | null => {
  if (!cls || 'error' in cls) return null;
  return orderedTraces(cls).find((t) =>
    !baseline.has(t.traceId) && t.command === command && traceMatchesArg(t, argKey, argValue, matchMode, alt)
  ) ?? null;
};

/** The trace's machine code: errorCode, else an upper-case `code` in the JSON result; null when none. */
export const traceErrorCode = (trace: CommandTrace): string | null => {
  if (typeof trace.errorCode === 'string' && trace.errorCode) return trace.errorCode;
  try {
    const r = logJson(trace.result) as { code?: unknown } | null;
    return typeof r?.code === 'string' && /^[A-Z][A-Z_]+$/.test(r.code) ? r.code : null;
  } catch {
    return null;
  }
};

/** Outcome of a closed trace (null while running). */
export const traceOutcome = (trace: CommandTrace, command: string): TraceOutcome | null => {
  if (trace.status === 'running') return null;
  const errorLogs = (trace.logs ?? []).filter((l) => l.level === 'error');
  const lastErrorLog = errorLogs.length > 0 ? clean(logText(errorLogs[errorLogs.length - 1].message) ?? '') : '';
  if (trace.status === 'error') {
    const code = traceErrorCode(trace);
    const restartFailed = restartFailedFromTraceResult(trace.result);
    return {
      kind: 'error',
      message: clean(logText(trace.errorMessage) ?? '') || lastErrorLog || `${command} failed`,
      ...(code ? { code } : {}),
      ...(restartFailed ? { restartFailed: true } : {}),
    };
  }
  if (lastErrorLog) return { kind: 'error', message: lastErrorLog };
  // An ok trace may still carry a result code (moveApp SOURCE_CHANGED, engine#388): keep it for `settle`.
  const code = traceErrorCode(trace);
  return code ? { kind: 'ok', code } : { kind: 'ok' };
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
  matchMode: ArgMatchMode = 'key',
  alt?: TraceAltMatch | null
): TraceOutcome | null => {
  const trace = findCommandTrace(cls, baseline, command, argKey, argValue, matchMode, alt);
  return trace ? traceOutcome(trace, command) : null;
};

export type CommandResultState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'success' }
  | { kind: 'error'; message: string; code?: string | null; restartFailed?: boolean }
  /** Finished, but not as asked: a plain sentence, shown as a warning (not red, not success). */
  | { kind: 'warning'; message: string; code?: string | null }
  | { kind: 'timeout' }
  /** Cross-engine: sent to another Engine, waiting for confirmation (neutral, not red). */
  | { kind: 'sent'; engine: string };

/** Per-send overrides, so one result can follow different commands (start/stop/backup on a row). */
export interface CommandResultTarget {
  command?: string;
  argKey?: TraceArgKey;
  matchMode?: ArgMatchMode;
  /** A second value that also matches (engine#399), e.g. the name sent when matching by id. */
  altMatch?: TraceAltMatch | null;
  longRunning?: boolean;
  /** Target Engine: a trace in our own log proves it is the connected one. */
  engineId?: string;
  /**
   * Cross-engine watch (remoteWatchFor), null/absent when the target is the
   * connected Engine. Shows 'sent' instead of timing out after 15 s, resolves
   * from the target's log (if loaded) or the store, red after its timeout.
   */
  remote?: RemoteWatch | null;
  /**
   * Optional: re-read a finished outcome against the store before it is shown (moveApp:
   * an ok trace or Done op that did not move the app becomes a warning, engine#388).
   */
  settle?: (o: TraceOutcome) => TraceOutcome;
  /**
   * Optional store confirmation on any Engine, including the connected one
   * (deleteTempBackup: the entry left Engine.tempBackups). Unlike `remote`,
   * this does not show "Sent to …" and resolves to success when it returns 'ok'.
   */
  confirm?: () => 'ok' | null;
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
  /**
   * Record the baseline, then call `send`, then wait for the answer. When
   * `send` resolves with a SendResult (agent-engine-dev#582) that was not
   * accepted, that is the answer at once (cancelled → idle, else error). The
   * timeout does not fire while the Engine's own confirmation dialog is open,
   * and starts again once a signed command was accepted.
   */
  start: (argValue: string, send: () => void | Promise<SendResult>, target?: CommandResultTarget) => void;
  reset: () => void;
}

/**
 * The trace of the signed queue entry `seq` (agent-engine-dev#582: every trace
 * of a signed entry carries it), when it is in `log` and is `command`.
 */
export const traceBySeq = (
  log: CommandLogState,
  seq: number,
  command: string,
  baseline: Set<string> = new Set(),
): CommandTrace | null => {
  if (!log || 'error' in log) return null;
  for (const t of Object.values(log.traces ?? {})) {
    // New traces only: a merged view holds several Engines' logs, and seq is unique per Engine.
    if (t && !baseline.has(t.traceId) && Number(t.seq) === seq && (!command || logText(t.command) === command)) return t;
  }
  return null;
};

/** Solid primitive around findCommandOutcome with the timeout. Call inside a component. */
export function createCommandResult(opts: CommandResultOptions): CommandResult {
  type Pending = {
    baseline: Set<string>;
    argValue: string;
    command: string;
    argKey: TraceArgKey;
    matchMode: ArgMatchMode;
    altMatch: TraceAltMatch | null;
    longRunning: boolean;
    engineId: string | null;
    remote: RemoteWatch | null;
    remoteBaseline: Set<string>;
    settle: ((o: TraceOutcome) => TraceOutcome) | null;
    confirm: (() => 'ok' | null) | null;
    /** The Engine's queue number from the 202 (signed commands), once known. */
    seq: number | null;
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
    const log = opts.commandLog();
    const trace = (p.seq !== null ? traceBySeq(log, p.seq, p.command, p.baseline) : null)
      ?? findCommandTrace(log, p.baseline, p.command, p.argKey, p.argValue, p.matchMode, p.altMatch);
    if (!trace) return null;
    return { accepted: true, outcome: traceOutcome(trace, p.command) };
  });

  // Store confirmation on this Engine (deleteTempBackup: the entry left the list).
  const confirmed = createMemo((): TraceOutcome | null => {
    const p = pending();
    if (!p?.confirm) return null;
    return p.confirm() === 'ok' ? { kind: 'ok' } : null;
  });

  // Cross-engine: the target's own log (approach i) and the store check (ii).
  const remoteFound = createMemo((): TraceOutcome | null => {
    const p = pending();
    if (!p?.remote) return null;
    if (p.remote.log) {
      const rl = p.remote.log();
      const t = (p.seq !== null ? traceBySeq(rl, p.seq, p.command, p.remoteBaseline) : null)
        ?? findCommandTrace(rl, p.remoteBaseline, p.command, p.argKey, p.argValue, p.matchMode, p.altMatch);
      const o = t ? traceOutcome(t, p.command) : null;
      if (o) return o;
    }
    const c = p.remote.check();
    if (c === 'ok') return { kind: 'ok' };
    if (c && 'warning' in c) return { kind: 'warning', message: c.warning, ...(c.code ? { code: c.code } : {}) };
    if (c) return { kind: 'error', message: c.error, ...(c.code ? { code: c.code } : {}) };
    return null;
  });

  const finish = (raw: TraceOutcome) => {
    const o = pending()?.settle?.(raw) ?? raw;
    if (o.kind === 'warning') {
      clearTimer();
      setPending(null);
      setState(o.code ? { kind: 'warning', message: o.message, code: o.code } : { kind: 'warning', message: o.message });
      return;
    }
    if (o.kind === 'error') {
      clearTimer();
      setPending(null);
      setState({
        kind: 'error',
        message: o.message,
        ...(o.code ? { code: o.code } : {}),
        ...(o.restartFailed ? { restartFailed: true } : {}),
      });
      return;
    }
    if (!opts.isSuccess || opts.isSuccess()) {
      clearTimer();
      setPending(null);
      setState({ kind: 'success' });
    }
  };

  createEffect(() => {
    const f = found();
    const p = pending();
    if (!f || !p) return;
    // A trace in our own log: the target is the connected Engine after all.
    if (p.engineId) noteConnectedEngine(p.engineId);
    // The Engine opened a trace: it received the command. Long operations
    // (restore, backup, copy, move) are no longer at risk of "no response".
    if (p.longRunning && !p.remote) clearTimer();
    if (f.outcome) finish(f.outcome);
  });

  createEffect(() => {
    const o = remoteFound();
    if (!o || !pending()) return;
    finish(o);
  });

  createEffect(() => {
    const o = confirmed();
    if (!o || !pending()) return;
    finish(o);
  });

  let generation = 0;

  const start = (argValue: string, send: () => void | Promise<SendResult>, target?: CommandResultTarget) => {
    clearTimer();
    const gen = ++generation;
    const cmd = target?.command ?? opts.command ?? '';
    setCommand(cmd);
    const remote = target?.remote ?? null;
    setPending({
      baseline: traceIdSnapshot(opts.commandLog()),
      argValue,
      command: cmd,
      argKey: target?.argKey ?? opts.argKey ?? 'diskId',
      matchMode: target?.matchMode ?? opts.matchMode ?? 'key',
      altMatch: target?.altMatch ?? null,
      longRunning: target?.longRunning ?? opts.longRunning ?? false,
      engineId: target?.engineId ?? null,
      remote,
      remoteBaseline: remote?.log ? traceIdSnapshot(remote.log()) : new Set(),
      settle: target?.settle ?? null,
      confirm: target?.confirm ?? null,
      seq: null,
    });
    const arm = () => {
      clearTimer();
      if (remote) {
        timer = setTimeout(() => {
          timer = null;
          if (pending() && pendingEngineConfirm()) { arm(); return; }
          if (pending()) {
            setPending(null);
            setState({
              kind: 'error',
              message: `No confirmation from ${remote.engineLabel} after ${formatWait(remote.timeoutMs)}. Check History on ${remote.engineLabel}.`,
            });
          }
        }, remote.timeoutMs);
      } else {
        timer = setTimeout(() => {
          timer = null;
          if (pending() && pendingEngineConfirm()) { arm(); return; }
          if (pending()) {
            setPending(null);
            setState({ kind: 'timeout' });
          }
        }, opts.timeoutMs ?? COMMAND_RESULT_TIMEOUT_MS);
      }
    };
    // Neutral until confirmed; red only on a real error or the long timeout.
    setState(remote ? { kind: 'sent', engine: remote.engineLabel } : { kind: 'pending' });
    arm();
    const sent = send();
    if (!sent || typeof (sent as Promise<SendResult>).then !== 'function') return;
    void (sent as Promise<SendResult>).then((r) => {
      if (gen !== generation || !pending()) return;
      if (r && r.kind !== 'accepted') {
        clearTimer();
        setPending(null);
        setState(r.kind === 'cancelled' ? { kind: 'idle' } : { kind: 'error', message: sendResultMessage(r) });
        return;
      }
      const seq = r && r.kind === 'accepted' ? r.seq : null;
      if (seq === null) return;
      setPending((prev) => (prev ? { ...prev, seq } : prev));
      // A signed command was accepted now: the wait for its trace starts here.
      arm();
    });
  };

  const reset = () => {
    generation++;
    clearTimer();
    setPending(null);
    setState({ kind: 'idle' });
    setCommand(null);
  };

  return { state, command, start, reset };
}
