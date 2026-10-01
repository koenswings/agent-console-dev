import { describe, it, expect } from 'vitest';
import { restoreSettleTimeoutMs } from '../e2e/intents/operatorDeepActions';
import { sidecarReadyTimeoutMs } from '../e2e/intents/sidecarUrls';

describe('restoreSettleTimeoutMs (Prefer A r21)', () => {
  it('defaults to at least sidecar budget (min 120s)', () => {
    const ms = restoreSettleTimeoutMs({});
    expect(ms).toBeGreaterThanOrEqual(120_000);
    expect(ms).toBeGreaterThanOrEqual(sidecarReadyTimeoutMs({}));
  });

  it('DURATION_RESTORE_SETTLE_MS override', () => {
    expect(restoreSettleTimeoutMs({ DURATION_RESTORE_SETTLE_MS: '180000' })).toBe(180_000);
  });
});
