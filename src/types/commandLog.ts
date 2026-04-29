export interface LogEntry {
  level: 'log' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: number;
}

export interface CommandTrace {
  traceId: string;
  command: string;       // e.g. "backupApp"
  args: string;          // JSON.stringify of raw args
  startedAt: number;
  completedAt: number | null;
  status: 'running' | 'ok' | 'error';
  errorMessage: string | null;
  logs: LogEntry[];
}

export interface CommandLogStore {
  traces: Record<string, CommandTrace>;
  recentTraceIds: string[];   // insertion-ordered ring buffer, max 200 — managed by engine
}
