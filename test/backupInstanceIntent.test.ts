import { describe, it, expect } from 'vitest';
import {
  backupSettleTimeoutMs,
  backupOpAppearTimeoutMs,
} from '../e2e/intents/operatorDeepActions';
import { sidecarReadyTimeoutMs } from '../e2e/intents/sidecarUrls';
import { sel } from '../e2e/intents/selectors';

describe('backupSettleTimeoutMs (Prefer A r23)', () => {
  it('defaults to at least 90s / sidecar budget', () => {
    const ms = backupSettleTimeoutMs({});
    expect(ms).toBeGreaterThanOrEqual(90_000);
    expect(ms).toBeGreaterThanOrEqual(sidecarReadyTimeoutMs({}));
  });

  it('DURATION_BACKUP_SETTLE_MS override', () => {
    expect(backupSettleTimeoutMs({ DURATION_BACKUP_SETTLE_MS: '60000' })).toBe(60_000);
  });
});

describe('backupOpAppearTimeoutMs (Prefer A r42 FAIL@112)', () => {
  it('defaults to 30s — long enough for Automerge click→op without racing 5s', () => {
    expect(backupOpAppearTimeoutMs({})).toBe(30_000);
  });

  it('DURATION_BACKUP_OP_START_MS override (floor 5s)', () => {
    expect(backupOpAppearTimeoutMs({ DURATION_BACKUP_OP_START_MS: '15000' })).toBe(15_000);
    expect(backupOpAppearTimeoutMs({ DURATION_BACKUP_OP_START_MS: '1000' })).toBe(5_000);
  });
});

describe('backup_instance selectors (r42 Operation wait)', () => {
  it('backupAppOpForInstance targets OperationProgress card by kind + instance', () => {
    expect(sel.backupAppOpForInstance('kolibri-grade5a-001')).toBe(
      '[data-testid^="operation-card-"][data-op-kind="backupApp"][data-op-instance="kolibri-grade5a-001"]',
    );
  });

  it('instanceCmdError covers desktop and mobile CommandFeedback', () => {
    expect(sel.instanceCmdError('inst-1')).toContain('instance-cmd-inst-1-error');
    expect(sel.instanceCmdError('inst-1')).toContain('mobile-instance-cmd-inst-1-error');
  });

  it('backup picker option testids', () => {
    expect(sel.backupToDisk('duration-empty-003')).toBe(
      '[data-testid="backup-to-disk-duration-empty-003"]',
    );
    expect(sel.backupPickerOption).toBe('[data-testid^="backup-to-disk-"]');
  });
});
