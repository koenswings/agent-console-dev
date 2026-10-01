import { describe, it, expect } from 'vitest';
import {
  resolveStartInstanceId,
  startSettleTimeoutMs,
} from '../e2e/intents/operatorActions';
import { DURATION_FIXTURES } from '../e2e/intents/fixtures';

describe('resolveStartInstanceId (Prefer A Path A)', () => {
  it('defaults to kolibri-grade5a-001', () => {
    expect(resolveStartInstanceId(undefined, {})).toBe(
      DURATION_FIXTURES.kolibri.instanceId,
    );
  });

  it('ctx instanceId over default', () => {
    expect(resolveStartInstanceId('ctx-inst', {})).toBe('ctx-inst');
  });

  it('DURATION_START_INSTANCE_ID wins', () => {
    expect(
      resolveStartInstanceId('ctx-inst', {
        DURATION_START_INSTANCE_ID: 'fleet-kolibri',
      }),
    ).toBe('fleet-kolibri');
  });
});

describe('startSettleTimeoutMs (Prefer A r32)', () => {
  it('defaults to 120s while Starting / in-progress', () => {
    expect(startSettleTimeoutMs({})).toBe(120_000);
  });

  it('DURATION_START_SETTLE_MS override', () => {
    expect(startSettleTimeoutMs({ DURATION_START_SETTLE_MS: '90000' })).toBe(90_000);
  });
});
