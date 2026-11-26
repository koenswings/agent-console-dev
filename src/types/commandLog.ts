/**
 * Automerge ImmutableString as the Console sees it (engine#471 b): `{ val }`
 * marked with Symbol.for('_am_immutableString'). Read it with
 * `logText` / `logJson` from src/store/logText.ts, never directly.
 */
export interface ImmutableStringLike {
  readonly val: string;
  toString(): string;
}

/** A command-log text field: plain string (old logs) or ImmutableString (engine#471 b). */
export type LogTextValue = string | ImmutableStringLike;

export interface LogEntry {
  level: 'log' | 'warn' | 'error' | 'debug';
  message: LogTextValue;
  timestamp: number;
}

export interface CommandTrace {
  traceId: string;
  command: string;       // e.g. "backupApp"
  /** Named args: JSON text (string or ImmutableString), or an object in legacy/mock docs. Read with logJson. */
  args: LogTextValue | Record<string, string>;
  startedAt: number;
  completedAt: number | null;
  status: 'running' | 'ok' | 'error';
  errorMessage: LogTextValue | null;
  /** Error text some Engine paths write next to errorMessage (engine#471 b). Read with logText. */
  error?: LogTextValue | null;
  /** Machine code of the error when the Engine has one (e.g. moveApp, engine#289). */
  errorCode?: string | null;
  logs: LogEntry[];
  /**
   * Optional JSON result (e.g. summariseDisk contentSummary).
   * For an updateApp error, the Engine writes `{"restartFailed":true}` when the
   * old version could not be restarted (engine#442 / agent-engine-dev#445).
   * JSON text as a string or ImmutableString (engine#471 b). Read with logJson.
   */
  result?: LogTextValue | Record<string, unknown> | null;
  /** Queue number of a signed entry (agent-engine-dev#582); unique per Engine. */
  seq?: number;
}

/** Parsed command-log trace result for an updateApp error (engine#442 / #445). */
export interface UpdateAppTraceResult {
  restartFailed?: boolean;
}

export interface CommandLogStore {
  traces: Record<string, CommandTrace>;
  recentTraceIds: string[];   // insertion-ordered ring buffer, max 200 — managed by engine
}
