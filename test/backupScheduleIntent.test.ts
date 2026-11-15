import { describe, it, expect } from 'vitest';
import { sel } from '../e2e/intents/selectors';
import {
  FIRST_BACKUP_SHORTLY_COPY,
  MISSED_BACKUP_SHORTLY_COPY,
} from '../src/store/backupStatus';
import {
  BACKUP_SCHEDULE_TIME_ENV,
  DEFAULT_BACKUP_TIME,
  FIRST_BACKUP_SHORTLY_COPY as intentFirstRun,
  MISSED_BACKUP_SHORTLY_COPY as intentMissed,
  isScheduledBackupStatusLine,
  missingScheduledBackupsMessage,
  resolveBackupScheduleTime,
} from '../e2e/intents/backupSchedule';

describe('backup_schedule (console#212)', () => {
  it('status-line copy stays in lockstep with backupStatus (console#212)', () => {
    expect(intentFirstRun).toBe(FIRST_BACKUP_SHORTLY_COPY);
    expect(intentMissed).toBe(MISSED_BACKUP_SHORTLY_COPY);
    expect(DEFAULT_BACKUP_TIME).toBe('02:30');
  });

  it('selectors target the mode controls, save, and RestorePanel schedule line', () => {
    expect(sel.backupModeControls).toBe('[data-testid="backup-mode-controls"]');
    expect(sel.backupMode('scheduled')).toBe('[data-testid="backup-mode-scheduled"]');
    expect(sel.backupModeTime).toBe('[data-testid="backup-mode-time"]');
    expect(sel.backupModeSave).toBe('[data-testid="backup-mode-save"]');
    expect(sel.restoreDiskStatusSchedule).toBe('[data-testid="restore-disk-status-schedule"]');
    const keys = Object.keys(sel);
    expect(keys.filter((k) => k === 'backupModeControls')).toHaveLength(1);
    expect(keys.filter((k) => k === 'restoreDiskStatusSchedule')).toHaveLength(1);
  });

  it('accepts catch-up, first-run, next-run, and clock-untrusted schedule lines', () => {
    expect(isScheduledBackupStatusLine('Scheduled daily at 02:30. First backup will start shortly.')).toBe(true);
    expect(isScheduledBackupStatusLine(`Scheduled daily at 02:30. ${FIRST_BACKUP_SHORTLY_COPY}`)).toBe(true);
    expect(isScheduledBackupStatusLine(`Scheduled daily at 02:30. ${MISSED_BACKUP_SHORTLY_COPY}`)).toBe(true);
    expect(isScheduledBackupStatusLine('Scheduled daily at 02:30. Next run tomorrow at 02:30.')).toBe(true);
    expect(isScheduledBackupStatusLine('Scheduled daily at 03:15. Next run today at 03:15.')).toBe(true);
    expect(isScheduledBackupStatusLine('Scheduled daily at 02:30.')).toBe(true);
    expect(isScheduledBackupStatusLine('The backup completed.')).toBe(false);
    expect(isScheduledBackupStatusLine('Scheduled weekly at 02:30.')).toBe(false);
  });

  it('fails clearly when scheduledBackups controls are missing', () => {
    const msg = missingScheduledBackupsMessage();
    expect(msg).toContain('backup-mode-controls');
    expect(msg).toContain('scheduledBackups');
    expect(msg).toContain('No soft-pass');
  });

  it('resolves the daily time from env, defaulting to 02:30', () => {
    expect(resolveBackupScheduleTime({})).toBe('02:30');
    expect(resolveBackupScheduleTime({ [BACKUP_SCHEDULE_TIME_ENV]: '03:45' })).toBe('03:45');
    expect(resolveBackupScheduleTime({ [BACKUP_SCHEDULE_TIME_ENV]: 'bad' })).toBe('02:30');
  });
});
