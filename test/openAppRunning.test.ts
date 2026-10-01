import { describe, it, expect } from 'vitest';
import { resolveStartInstanceId } from '../e2e/intents/operatorActions';
import { DURATION_FIXTURES } from '../e2e/intents/fixtures';

/**
 * open_app / openAppInstance align instance id with start_instance
 * (DURATION_START_INSTANCE_ID / kolibri-grade5a-001).
 */
describe('open_app instance id alignment (Prefer A r18)', () => {
  it('shares resolveStartInstanceId default with start_instance', () => {
    expect(resolveStartInstanceId(undefined, {})).toBe(
      DURATION_FIXTURES.kolibri.instanceId,
    );
    expect(DURATION_FIXTURES.kolibri.instanceId).toBe('kolibri-grade5a-001');
  });

  it('DURATION_START_INSTANCE_ID applies to open path', () => {
    expect(
      resolveStartInstanceId(undefined, {
        DURATION_START_INSTANCE_ID: 'fleet-open-id',
      }),
    ).toBe('fleet-open-id');
  });
});
