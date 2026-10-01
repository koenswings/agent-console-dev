import { describe, it, expect } from 'vitest';
import {
  resolveBackupDiskIdPreference,
  SUGGESTED_BACKUP_DISK_ID,
} from '../e2e/intents/backupDisk';
import { DURATION_FIXTURES } from '../e2e/intents/fixtures';

describe('resolveBackupDiskIdPreference (Prefer A RestorePanel)', () => {
  it('defaults to suggested duration-empty-001 (post make_backup_disk)', () => {
    expect(resolveBackupDiskIdPreference({}, {})).toBe(SUGGESTED_BACKUP_DISK_ID);
    expect(DURATION_FIXTURES.backup.diskId).toBe('duration-empty-001');
    expect(DURATION_FIXTURES.backup.diskId).toBe(DURATION_FIXTURES.empty.diskId);
  });

  it('DURATION_BACKUP_DISK_ID wins over ctx', () => {
    expect(
      resolveBackupDiskIdPreference(
        { diskId: 'ctx-disk' },
        { DURATION_BACKUP_DISK_ID: 'fleet-backup-usb' },
      ),
    ).toBe('fleet-backup-usb');
  });

  it('ctx diskId used when env unset', () => {
    expect(resolveBackupDiskIdPreference({ diskId: 'ctx-backup' }, {})).toBe('ctx-backup');
  });
});
