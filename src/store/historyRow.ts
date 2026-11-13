/**
 * Collapsed History-row presentation (idea#454).
 *
 * A clearBackupLock trace can close as ok with result.cleared === false when
 * there is nothing to clear. The Engine attaches { cleared, message } and does
 * not throw (agent-engine-dev#332). That row is a neutral info line, not a
 * green success check and not a red error.
 */
import type { CommandTrace } from '../types/commandLog';
import { plainEngineText } from './plainError';
import {
  MAKE_BACKUP_DISK_COMMAND,
  MAKE_BACKUP_DISK_SUCCESS_MESSAGE,
  makeBackupDiskErrorText,
} from './makeBackupDisk';

export type HistoryRowTone = 'ok' | 'error' | 'info';

export interface HistoryRowView {
  tone: HistoryRowTone;
  icon: string;
  message: string | null;
}

const ANSI_RE = /\u001b\[[0-9;]*[mGKHFABCDJsu]|\u001b[\[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g;
const stripAnsi = (s: string): string => s.replace(ANSI_RE, '');

/** Parse a trace result that may be a JSON string or an already-parsed object. */
export const parseTraceResult = (trace: CommandTrace): Record<string, unknown> | null => {
  if (trace.result == null || trace.result === '') return null;
  try {
    const raw = typeof trace.result === 'string' ? JSON.parse(trace.result) : trace.result;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw as Record<string, unknown>;
  } catch {
    return null;
  }
};

/** Icon, tone and collapsed-row message for a finished command trace. */
export const historyRowView = (trace: CommandTrace): HistoryRowView => {
  if (trace.command === 'clearBackupLock' && trace.status === 'ok') {
    const result = parseTraceResult(trace);
    if (result && result.cleared === false) {
      const message = typeof result.message === 'string' && result.message.trim()
        ? result.message
        : null;
      return { tone: 'info', icon: 'ℹ', message };
    }
  }
  if (trace.command === MAKE_BACKUP_DISK_COMMAND) {
    if (trace.status === 'ok') {
      return { tone: 'ok', icon: '✓', message: MAKE_BACKUP_DISK_SUCCESS_MESSAGE };
    }
    const raw = trace.errorMessage ? stripAnsi(trace.errorMessage).trim() : '';
    return { tone: 'error', icon: '✗', message: raw ? makeBackupDiskErrorText(raw) : null };
  }
  if (trace.status === 'ok') {
    return { tone: 'ok', icon: '✓', message: null };
  }
  const raw = trace.errorMessage ? stripAnsi(trace.errorMessage).trim() : '';
  return { tone: 'error', icon: '✗', message: raw ? plainEngineText(raw) : null };
};
