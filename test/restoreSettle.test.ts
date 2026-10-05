import { describe, it, expect } from 'vitest';
import {
  restoreSettleTimeoutMs,
  restoreMinDwellMs,
} from '../e2e/intents/operatorDeepActions';
import { copyMoveSettleTimeoutMs } from '../e2e/intents/copyMoveApp';
import { sidecarReadyTimeoutMs } from '../e2e/intents/sidecarUrls';

describe('restoreSettleTimeoutMs (Prefer A r21/r22)', () => {
  it('defaults to at least sidecar budget (min 120s)', () => {
    const ms = restoreSettleTimeoutMs({});
    expect(ms).toBeGreaterThanOrEqual(120_000);
    expect(ms).toBeGreaterThanOrEqual(sidecarReadyTimeoutMs({}));
  });

  it('DURATION_RESTORE_SETTLE_MS override', () => {
    expect(restoreSettleTimeoutMs({ DURATION_RESTORE_SETTLE_MS: '180000' })).toBe(180_000);
  });
});

describe('restoreMinDwellMs (r22 async SIGTERM)', () => {
  it('defaults to 10s so unlock ~3.4s is not enough', () => {
    expect(restoreMinDwellMs({})).toBe(10_000);
  });

  it('DURATION_RESTORE_MIN_DWELL_MS override', () => {
    expect(restoreMinDwellMs({ DURATION_RESTORE_MIN_DWELL_MS: '15000' })).toBe(15_000);
  });
});

describe('copyMoveSettleTimeoutMs (Prefer A r22)', () => {
  it('defaults to at least 120s', () => {
    expect(copyMoveSettleTimeoutMs({})).toBeGreaterThanOrEqual(120_000);
  });

  it('DURATION_COPY_MOVE_SETTLE_MS override', () => {
    expect(copyMoveSettleTimeoutMs({ DURATION_COPY_MOVE_SETTLE_MS: '90000' })).toBe(90_000);
  });
});
