import { describe, it, expect } from 'vitest';
import { buildSetBackupModeCommand } from '../src/store/commands';
import {
  DEFAULT_BACKUP_TIME,
  SET_BACKUP_MODE_ERROR_TEXT,
  leadingErrorCode,
  normalizeDailyTime,
  parseDailyTime,
  plainSetBackupModeSuccess,
  setBackupModeErrorText,
  validateBackupTime,
} from '../src/store/setBackupMode';
import { historyRowView } from '../src/store/historyRow';
import type { CommandTrace } from '../src/types/commandLog';

describe('parseDailyTime / normalizeDailyTime / validateBackupTime', () => {
  it('parses HH:MM and H:MM, and rejects invalid times', () => {
    expect(parseDailyTime('02:30')).toEqual({ hours: 2, minutes: 30 });
    expect(parseDailyTime('2:30')).toEqual({ hours: 2, minutes: 30 });
    expect(parseDailyTime('23:59')).toEqual({ hours: 23, minutes: 59 });
    expect(parseDailyTime('00:00')).toEqual({ hours: 0, minutes: 0 });
    expect(parseDailyTime('24:00')).toBeNull();
    expect(parseDailyTime('2:3')).toBeNull();
    expect(parseDailyTime('not-a-time')).toBeNull();
  });

  it('normalises H:MM to HH:MM', () => {
    expect(normalizeDailyTime('9:05')).toBe('09:05');
    expect(normalizeDailyTime('02:30')).toBe('02:30');
    expect(normalizeDailyTime('24:00')).toBeNull();
  });

  it('validates on the client, with a required message when empty', () => {
    expect(validateBackupTime('02:30')).toBeNull();
    expect(validateBackupTime('9:05')).toBeNull();
    expect(validateBackupTime('')).toBe('Enter a time, for example 02:30.');
    expect(validateBackupTime('   ')).toBe('Enter a time, for example 02:30.');
    expect(validateBackupTime('24:00')).toBe(SET_BACKUP_MODE_ERROR_TEXT.BAD_TIME);
    expect(validateBackupTime('25:00')).toBe(SET_BACKUP_MODE_ERROR_TEXT.BAD_TIME);
  });
});

describe('buildSetBackupModeCommand', () => {
  it('sends the disk id and omits a time except for scheduled', () => {
    expect(buildSetBackupModeCommand('DISK004', 'on-demand')).toBe('setBackupMode DISK004 on-demand');
    expect(buildSetBackupModeCommand('DISK004', 'immediate', '02:30'))
      .toBe('setBackupMode DISK004 immediate');
    expect(buildSetBackupModeCommand('DISK004', 'scheduled', '02:30'))
      .toBe('setBackupMode DISK004 scheduled 02:30');
    expect(buildSetBackupModeCommand('DISK004', 'scheduled')).toBe('setBackupMode DISK004 scheduled');
  });

  it('never uses the disk name', () => {
    const cmd = buildSetBackupModeCommand('DISK004', 'scheduled', '07:15');
    expect(cmd).toBe('setBackupMode DISK004 scheduled 07:15');
    expect(cmd).not.toMatch(/backup-disk/);
  });
});

describe('setBackupModeErrorText', () => {
  const codes = [
    'NOT_DOCKED',
    'AMBIGUOUS',
    'SYSTEM_DISK',
    'NOT_A_BACKUP_DISK',
    'BAD_BACKUP_YAML',
    'BAD_MODE',
    'BAD_TIME',
    'BUSY',
  ] as const;

  it('maps every Engine refusal code to plain wording and never returns a code or command name', () => {
    for (const code of codes) {
      const raw = `${code}: setBackupMode: some engine detail`;
      expect(leadingErrorCode(raw)).toBe(code);
      const text = setBackupModeErrorText(raw);
      expect(text).toBe(SET_BACKUP_MODE_ERROR_TEXT[code]);
      expect(text).not.toMatch(/setBackupMode|BACKUP\.yaml|borg|YAML|helper/i);
      expect(text).not.toContain(code);
    }
  });

  it('falls back to plainEngineText for an unmapped message', () => {
    expect(setBackupModeErrorText('The disk is busy right now.')).toBe('The disk is busy right now.');
  });
});

describe('plainSetBackupModeSuccess', () => {
  it('shows Saved or Already set this way, plus a plain note from mode and schedule', () => {
    expect(plainSetBackupModeSuccess({
      mode: 'scheduled',
      schedule: { daily: '07:15' },
      changed: true,
      note: 'daily at 07:15 (Engine local time); a disk that never ran, or that missed its last slot, runs within a minute',
    })).toBe('Saved. This disk will back up every day at 07:15 (this Pi\'s local time).');

    expect(plainSetBackupModeSuccess({
      mode: 'on-demand',
      schedule: { daily: '02:30' },
      changed: false,
      note: 'backs up only on backupApp',
    })).toBe('Already set this way. This disk will back up only when you press Back up.');

    expect(plainSetBackupModeSuccess({
      mode: 'immediate',
      changed: true,
      note: 'backs up on the next dock',
    })).toBe('Saved. This disk will back up when it is next plugged in.');
  });

  it('uses the first-backup line when scheduled and Disk.lastAttempt is absent', () => {
    expect(plainSetBackupModeSuccess({
      mode: 'scheduled',
      schedule: { daily: '07:15' },
      changed: true,
    }, { lastAttempt: null })).toBe('A first backup starts now, then daily at 07:15.');

    expect(plainSetBackupModeSuccess({
      mode: 'scheduled',
      schedule: { daily: '02:30' },
      changed: true,
    }, { lastAttempt: undefined })).toBe('A first backup starts now, then daily at 02:30.');
  });

  it('keeps the normal scheduled wording when Disk.lastAttempt is set', () => {
    expect(plainSetBackupModeSuccess({
      mode: 'scheduled',
      schedule: { daily: '07:15' },
      changed: true,
      note: 'daily at 07:15 (Engine local time)',
    }, { lastAttempt: 1_700_000_000_000 }))
      .toBe('Saved. This disk will back up every day at 07:15 (this Pi\'s local time).');
  });

  it('leaves on-demand and immediate wording unchanged even with no lastAttempt', () => {
    expect(plainSetBackupModeSuccess({
      mode: 'on-demand',
      changed: true,
    }, { lastAttempt: null }))
      .toBe('Saved. This disk will back up only when you press Back up.');
    expect(plainSetBackupModeSuccess({
      mode: 'immediate',
      changed: false,
    }, { lastAttempt: null }))
      .toBe('Already set this way. This disk will back up when it is next plugged in.');
  });

  it('never shows the Engine command name or a result-code token', () => {
    const text = plainSetBackupModeSuccess({
      mode: 'on-demand',
      changed: false,
      note: 'backs up only on backupApp',
    });
    expect(text).not.toMatch(/backupApp|setBackupMode|YAML|borg/i);
    expect(text).toContain('Already set this way.');
    expect(DEFAULT_BACKUP_TIME).toBe('02:30');
  });
});

describe('historyRowView — setBackupMode', () => {
  const trace = (over: Partial<CommandTrace> = {}): CommandTrace => ({
    traceId: 't1',
    command: 'setBackupMode',
    args: { backupDiskId: 'DISK004', mode: 'scheduled', time: ['07:15'] },
    startedAt: 0,
    completedAt: 1,
    status: 'ok',
    errorMessage: null,
    logs: [],
    ...over,
  });

  it('ok + changed:true is a success row with the plain note', () => {
    const view = historyRowView(trace({
      result: JSON.stringify({
        backupDiskId: 'DISK004',
        previousMode: 'on-demand',
        mode: 'scheduled',
        schedule: { daily: '07:15' },
        scheduleError: null,
        changed: true,
        note: 'daily at 07:15 (Engine local time)',
      }),
    }));
    expect(view.tone).toBe('ok');
    expect(view.icon).toBe('✓');
    expect(view.message).toBe('Saved. This disk will back up every day at 07:15 (this Pi\'s local time).');
  });

  it('ok + changed:false is a neutral info row', () => {
    const view = historyRowView(trace({
      result: JSON.stringify({
        backupDiskId: 'DISK004',
        previousMode: 'on-demand',
        mode: 'on-demand',
        schedule: { daily: '02:30' },
        scheduleError: null,
        changed: false,
        note: 'backs up only on backupApp',
      }),
    }));
    expect(view.tone).toBe('info');
    expect(view.icon).toBe('ℹ');
    expect(view.message).toMatch(/^Already set this way\./);
    expect(view.message).not.toMatch(/backupApp/);
  });

  it('maps a refusal code to plain wording and does not show the code', () => {
    const view = historyRowView(trace({
      status: 'error',
      errorMessage: 'BUSY: setBackupMode: the Backup Disk lock is held',
    }));
    expect(view.tone).toBe('error');
    expect(view.message).toBe(SET_BACKUP_MODE_ERROR_TEXT.BUSY);
    expect(view.message).not.toContain('BUSY');
    expect(view.message).not.toContain('setBackupMode');
  });
});
