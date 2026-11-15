export interface LogEntry {
  level: 'log' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: number;
}

export interface CommandTrace {
  traceId: string;
  command: string;       // e.g. "backupApp"
  args: string | Record<string, string>;  // named args — object in Automerge, JSON string in legacy/mock
  startedAt: number;
  completedAt: number | null;
  status: 'running' | 'ok' | 'error';
  errorMessage: string | null;
  /** Machine code of the error when the Engine has one (e.g. moveApp, engine#289). */
  errorCode?: string | null;
  logs: LogEntry[];
  /**
   * Optional JSON result (e.g. summariseDisk contentSummary).
   * For an updateApp error, the Engine writes `{"restartFailed":true}` when the
   * old version could not be restarted (engine#442 / agent-engine-dev#445).
   */
  result?: string | null;
}

/** Parsed command-log trace result for an updateApp error (engine#442 / #445). */
export interface UpdateAppTraceResult {
  restartFailed?: boolean;
}

export interface CommandLogStore {
  traces: Record<string, CommandTrace>;
  recentTraceIds: string[];   // insertion-ordered ring buffer, max 200 — managed by engine
}
