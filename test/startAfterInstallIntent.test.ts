import { describe, it, expect } from 'vitest';
import { resolvePostInstallInstanceIdPreference } from '../e2e/intents/operatorDeepActions';

describe('resolvePostInstallInstanceIdPreference (Prefer A r27)', () => {
  it('DURATION_START_AFTER_INSTALL_ID wins', () => {
    expect(
      resolvePostInstallInstanceIdPreference('ctx-uuid', {
        DURATION_START_AFTER_INSTALL_ID: 'fresh-install-id',
      }),
    ).toBe('fresh-install-id');
  });

  it('accepts non-grade5a ctx instanceId', () => {
    expect(
      resolvePostInstallInstanceIdPreference('o7g1hmnnfqnx396pe41', {}),
    ).toBe('o7g1hmnnfqnx396pe41');
  });

  it('ignores grade5a ctx (Path A pin is for start_instance only)', () => {
    expect(
      resolvePostInstallInstanceIdPreference('kolibri-grade5a-001', {}),
    ).toBeUndefined();
  });

  it('undefined when no override and no ctx', () => {
    expect(resolvePostInstallInstanceIdPreference(undefined, {})).toBeUndefined();
  });

  it('does not use DURATION_START_INSTANCE_ID (grade5a Path A)', () => {
    expect(
      resolvePostInstallInstanceIdPreference(undefined, {
        DURATION_START_INSTANCE_ID: 'kolibri-grade5a-001',
      }),
    ).toBeUndefined();
  });
});
