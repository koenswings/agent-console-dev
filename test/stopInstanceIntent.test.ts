import { describe, it, expect } from 'vitest';
import {
  stopSettleTimeoutMs,
  stopRetryIntervalMs,
} from '../e2e/intents/operatorActions';

describe('stopSettleTimeoutMs (Prefer A r38)', () => {
  it('defaults to 180s (infra flap after backup)', () => {
    expect(stopSettleTimeoutMs({})).toBe(180_000);
  });

  it('DURATION_STOP_SETTLE_MS override', () => {
    expect(stopSettleTimeoutMs({ DURATION_STOP_SETTLE_MS: '120000' })).toBe(120_000);
  });

  it('rejects values below 5s floor', () => {
    expect(stopSettleTimeoutMs({ DURATION_STOP_SETTLE_MS: '1000' })).toBe(5_000);
  });
});

describe('stopRetryIntervalMs (Prefer A r38)', () => {
  it('defaults to 15s between Stop re-clicks', () => {
    expect(stopRetryIntervalMs({})).toBe(15_000);
  });

  it('DURATION_STOP_RETRY_MS override', () => {
    expect(stopRetryIntervalMs({ DURATION_STOP_RETRY_MS: '20000' })).toBe(20_000);
  });
});
