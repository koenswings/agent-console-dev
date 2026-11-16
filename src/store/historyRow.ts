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
import { plainSetBackupModeSuccess, setBackupModeErrorText } from './setBackupMode';
import { logJson, logText } from './logText';
import { traceInstanceRefs } from './commandResult';
import {
  appTitleOf, COMMAND as UPDATE_COMMAND, friendlyUpdateError, isTempBackupRefusal, restartFailedFromTraceResult, restartFailedText,
  UNKNOWN_APP_NAME,
} from './updateApp';
import type { Store } from '../types/store';

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
  try {
    const raw = logJson(trace.result);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw as Record<string, unknown>;
  } catch {
    return null;
  }
};

/**
 * App display name for a trace's instance (by id, else by name), for the
 * agreed sentences in History; null when the instance is unknown.
 */
export const traceAppTitle = (store: Store | null, trace: CommandTrace): string | null => {
  const db = store?.instanceDB ?? {};
  for (const ref of traceInstanceRefs(trace)) {
    const inst = db[ref] ?? Object.values(db).find((i) => i?.name === ref);
    if (inst) return appTitleOf(store, inst) || null;
  }
  return null;
};

/**
 * console#227: the agreed sentence for an updateApp error trace whose result
 * says `restartFailed: true`, instead of the raw `ROLLED BACK: …` text; null
 * for any other trace.
 */
export const historyRestartFailedText = (trace: CommandTrace, appTitle?: string | null): string | null =>
  trace.command === UPDATE_COMMAND && trace.status === 'error' && restartFailedFromTraceResult(trace.result)
    ? restartFailedText(appTitle || UNKNOWN_APP_NAME)
    : null;

/**
 * engine#469: the plain sentence for an updateApp refusal about the temporary pre-update
 * backup on the system disk (TEMP_BACKUP_NO_SPACE, TEMP_BACKUP_FAILED, HELPER_OUTDATED for
 * it). Such a refusal comes before the operation, so History is where it stays after a reload.
 */
export const historyTempBackupText = (trace: CommandTrace, appTitle?: string | null): string | null => {
  if (trace.command !== UPDATE_COMMAND || trace.status !== 'error') return null;
  const raw = stripAnsi(logText(trace.errorMessage) ?? '').trim();
  if (!raw || !isTempBackupRefusal(raw)) return null;
  return friendlyUpdateError(raw, { app: appTitle || UNKNOWN_APP_NAME, fromVersion: '', engine: '', diskName: null });
};

/** The agreed plain sentence for an updateApp error trace (raw text behind Technical details), or null. */
export const historyUpdatePlainText = (trace: CommandTrace, appTitle?: string | null): string | null =>
  historyRestartFailedText(trace, appTitle) ?? historyTempBackupText(trace, appTitle);

/** Icon, tone and collapsed-row message for a finished command trace. */
export const historyRowView = (trace: CommandTrace, appTitle?: string | null): HistoryRowView => {
  const updatePlain = historyUpdatePlainText(trace, appTitle);
  if (updatePlain) return { tone: 'error', icon: '✗', message: updatePlain };
  if (trace.command === 'setBackupMode') {
    if (trace.status === 'ok') {
      const result = parseTraceResult(trace);
      const message = plainSetBackupModeSuccess(result ?? {});
      const tone = result?.changed === false ? 'info' : 'ok';
      const icon = tone === 'info' ? 'ℹ' : '✓';
      return { tone, icon, message };
    }
    const raw = stripAnsi(logText(trace.errorMessage) ?? '').trim();
    return { tone: 'error', icon: '✗', message: raw ? setBackupModeErrorText(raw) : null };
  }
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
    const code = trace.errorCode ?? null;
    return { tone: 'error', icon: '✗', message: raw || code ? makeBackupDiskErrorText(raw, code) : null };
  }
  if (trace.status === 'ok') {
    return { tone: 'ok', icon: '✓', message: null };
  }
  const raw = stripAnsi(logText(trace.errorMessage) ?? '').trim();
  return { tone: 'error', icon: '✗', message: raw ? plainEngineText(raw) : null };
};
