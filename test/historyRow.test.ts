/**
 * idea#454 — clearBackupLock with nothing to clear is a neutral info History
 * row, not a green success and not a red error (engine#332 result shape).
 */
import { describe, it, expect } from 'vitest';
import { historyRowView, parseTraceResult } from '../src/store/historyRow';
import type { CommandTrace } from '../src/types/commandLog';

const inst = 'i-kolibri';
const NOTHING = `no backup lock to clear for ${inst}`;

const nothingResult = {
  instanceId: inst,
  backupDiskId: 'disk-backup',
  lockPath: '/mnt/backup/.backup-in-progress',
  startedAt: null,
  cleared: false,
  lockFileRemoved: false,
  message: NOTHING,
};

const clearedResult = {
  instanceId: inst,
  backupDiskId: 'disk-backup',
  lockPath: '/mnt/backup/.backup-in-progress',
  startedAt: 1,
  cleared: true,
  lockFileRemoved: true,
};

const trace = (over: Partial<CommandTrace> = {}): CommandTrace => ({
  traceId: 't1',
  command: 'clearBackupLock',
  args: { instanceId: inst, backupDiskId: 'disk-backup' },
  startedAt: 0,
  completedAt: 1,
  status: 'ok',
  errorMessage: null,
  logs: [],
  ...over,
});

describe('parseTraceResult', () => {
  it('parses a JSON string and an already-parsed object', () => {
    expect(parseTraceResult(trace({ result: JSON.stringify(nothingResult) }))).toEqual(nothingResult);
    expect(parseTraceResult(trace({ result: nothingResult as unknown as string }))).toEqual(nothingResult);
  });
  it('null when result is missing or not an object', () => {
    expect(parseTraceResult(trace())).toBeNull();
    expect(parseTraceResult(trace({ result: null }))).toBeNull();
    expect(parseTraceResult(trace({ result: 'not-json' }))).toBeNull();
  });
});

describe('historyRowView — clearBackupLock (idea#454)', () => {
  it('ok + cleared:false → info tone, result.message on the row', () => {
    expect(historyRowView(trace({ result: JSON.stringify(nothingResult) }))).toEqual({
      tone: 'info',
      icon: 'ℹ',
      message: NOTHING,
    });
  });

  it('ok + cleared:true → success, no message', () => {
    expect(historyRowView(trace({ result: JSON.stringify(clearedResult) }))).toEqual({
      tone: 'ok',
      icon: '✓',
      message: null,
    });
  });

  it('ok without a result (or unparseable) stays success', () => {
    expect(historyRowView(trace()).tone).toBe('ok');
    expect(historyRowView(trace({ result: 'nope' })).tone).toBe('ok');
  });

  it('a real error stays red', () => {
    const view = historyRowView(trace({
      status: 'error',
      errorMessage: 'clearBackupLock: the Backup Disk is locked by \'backupApp\'',
    }));
    expect(view.tone).toBe('error');
    expect(view.icon).toBe('✗');
    expect(view.message).toBe("clearBackupLock: the Backup Disk is locked by 'backupApp'");
  });

  it('does not treat other ok commands as info', () => {
    expect(historyRowView(trace({
      command: 'backupApp',
      result: JSON.stringify({ cleared: false, message: NOTHING }),
    }))).toEqual({ tone: 'ok', icon: '✓', message: null });
  });
});
