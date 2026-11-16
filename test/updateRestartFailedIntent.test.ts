import { describe, it, expect } from 'vitest';
import { sel } from '../e2e/intents/selectors';
import { restartFailedText } from '../src/store/updateApp';
import {
  RESTART_FAILED_APP_ENV,
  RESTART_FAILED_HOOK_ENV,
  RESTART_FAILED_INSTANCE_ENV,
  RESTART_FAILED_TIMEOUT_ENV,
  RETRY_RESUME_NAME,
  resolveRestartFailedApp,
  resolveRestartFailedInstanceId,
  restartFailedAlertText,
  restartFailedHookEnabled,
  restartFailedMissingHookMessage,
  restartFailedTimeoutMs,
} from '../e2e/intents/updateRestartFailed';

describe('update_restart_failed selectors and text (console#217, engine#442)', () => {
  it('alert text is the exact #217 wording, including the App name', () => {
    const text =
      "The update didn't start, and Kolibri couldn't be started again, so it is stopped. Its version and data are unchanged. Start Kolibri again, or ask for help if it doesn't start.";
    expect(restartFailedAlertText('Kolibri')).toBe(text);
    expect(restartFailedAlertText('Kolibri')).toBe(restartFailedText('Kolibri'));
    expect(restartFailedAlertText('Nextcloud')).toBe(restartFailedText('Nextcloud'));
    expect(restartFailedAlertText('Kolibri')).not.toMatch(/Nothing changed/i);
    expect(restartFailedAlertText('Kolibri')).not.toMatch(/Retry|Resume/);
  });

  it('selectors target the update alert, badge, confirm, and the InstanceRow error hint', () => {
    expect(sel.updateApp('i1')).toBe('[data-testid="update-app-i1"]');
    expect(sel.updateBadge('i1')).toBe('[data-testid="update-badge-i1"]');
    expect(sel.updateConfirm('i1')).toBe('[data-testid="update-confirm-i1"]');
    expect(sel.updateConfirmBtn('i1')).toBe('[data-testid="update-confirm-btn-i1"]');
    expect(sel.updateOutcome('i1')).toBe('[data-testid="update-outcome-i1"]');
    expect(sel.updateError('i1')).toBe('[data-testid="update-error-i1"]');
    expect(sel.updateRestartFailedAlert('i1')).toBe(
      '[data-testid="update-outcome-i1"], [data-testid="update-error-i1"]',
    );
    expect(sel.instanceErrorHint('i1')).toBe('[data-testid="instance-error-hint-i1"]');
    const keys = Object.keys(sel);
    expect(keys.filter((k) => k === 'updateRestartFailedAlert')).toHaveLength(1);
    expect(keys.filter((k) => k === 'instanceErrorHint')).toHaveLength(1);
  });

  it('Retry/Resume name regex matches only those buttons', () => {
    expect(RETRY_RESUME_NAME.test('Retry')).toBe(true);
    expect(RETRY_RESUME_NAME.test('Resume')).toBe(true);
    expect(RETRY_RESUME_NAME.test('retry')).toBe(true);
    expect(RETRY_RESUME_NAME.test('Start Kolibri again')).toBe(false);
    expect(RETRY_RESUME_NAME.test('Update')).toBe(false);
    expect(RETRY_RESUME_NAME.test('Not now')).toBe(false);
  });

  it('is hook-gated: disabled by default, enabled only when the hook env is set', () => {
    expect(restartFailedHookEnabled({})).toBe(false);
    expect(restartFailedHookEnabled({ [RESTART_FAILED_HOOK_ENV]: '' })).toBe(false);
    expect(restartFailedHookEnabled({ [RESTART_FAILED_HOOK_ENV]: '0' })).toBe(false);
    expect(restartFailedHookEnabled({ [RESTART_FAILED_HOOK_ENV]: '1' })).toBe(true);
    expect(restartFailedHookEnabled({ [RESTART_FAILED_HOOK_ENV]: 'true' })).toBe(true);
    expect(restartFailedHookEnabled({ [RESTART_FAILED_HOOK_ENV]: 'yes' })).toBe(true);
    const msg = restartFailedMissingHookMessage();
    expect(msg).toContain(RESTART_FAILED_HOOK_ENV);
    expect(msg).toContain(RESTART_FAILED_INSTANCE_ENV);
    expect(msg).toContain('IDEA_TEST_FAIL_UPDATE_RESTART=<instanceId>');
    expect(msg).toContain('testMode');
    expect(msg).toContain('No soft-pass');
  });

  it('resolves instance id and App name from env, and the wait budget', () => {
    expect(resolveRestartFailedInstanceId('ctx-id', {})).toBe('ctx-id');
    expect(resolveRestartFailedInstanceId('ctx-id', { [RESTART_FAILED_INSTANCE_ENV]: 'env-id' })).toBe('env-id');
    expect(resolveRestartFailedInstanceId(undefined, {})).toBe('');
    expect(resolveRestartFailedApp({})).toBeNull();
    expect(resolveRestartFailedApp({ [RESTART_FAILED_APP_ENV]: 'Kolibri' })).toBe('Kolibri');
    expect(restartFailedTimeoutMs({})).toBe(15 * 60_000);
    expect(restartFailedTimeoutMs({ [RESTART_FAILED_TIMEOUT_ENV]: '60000' })).toBe(60_000);
    expect(restartFailedTimeoutMs({ [RESTART_FAILED_TIMEOUT_ENV]: '1000' })).toBe(30_000);
  });
});
