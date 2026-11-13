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
  /** Optional JSON result (e.g. summariseDisk contentSummary). */
  result?: string | null;
}

export interface CommandLogStore {
  traces: Record<string, CommandTrace>;
  recentTraceIds: string[];   // insertion-ordered ring buffer, max 200 — managed by engine
}
