import { describe, it, expect } from 'vitest';
import { backupSettleTimeoutMs } from '../e2e/intents/operatorDeepActions';
import { sidecarReadyTimeoutMs } from '../e2e/intents/sidecarUrls';

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
