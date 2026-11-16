/**
 * update_restart_failed (console#217, engine#442 / agent-engine-dev#445).
 *
 * After an updateApp failure with restartFailed: true, the Console must show
 * the agreed alert (not "Nothing changed"), no Retry/Resume, and still show
 * the InstanceRow error hint (Steve).
 *
 * This path needs an update that fails before a swap AND a failed restart of
 * the old version. engine#467 (agent-engine-dev 5836f87, engine#449) adds the
 * Engine hook: start the Engine with IDEA_TEST_FAIL_UPDATE_RESTART=<instanceId>
 * and config.settings.testMode on, and updateApp for that one instance fails
 * pre-swap and the old-version restart throws. The hook is ignored when
 * testMode is off, so it never fires on a school Pi.
 *
 * The Intent stays gated on the harness side: it runs only when
 * DURATION_UPDATE_RESTART_FAILED_HOOK is set (meaning the Engine under test was
 * started with the hook armed for the same instance) and an instance id is
 * provided. Without that it loud-fails with a clear missing-hook message (no
 * soft-pass).
 *
 * Live: click Update on the offered instance, wait for the #217 alert, then
 * assert the hint and the absence of Retry/Resume.
 */
import type { Page } from '@playwright/test';
import type { IntentFn } from './types';
import { sel } from './selectors';

/** Must stay in lockstep with src/store/updateApp.ts `restartFailedText`. */
export const restartFailedAlertText = (app: string): string =>
  `The update didn't start, and ${app} couldn't be started again, so it is stopped. Its version and data are unchanged. Start ${app} again, or ask for help if it doesn't start.`;

export const RESTART_FAILED_HOOK_ENV = 'DURATION_UPDATE_RESTART_FAILED_HOOK';
export const RESTART_FAILED_INSTANCE_ENV = 'DURATION_UPDATE_RESTART_FAILED_INSTANCE_ID';
export const RESTART_FAILED_APP_ENV = 'DURATION_UPDATE_RESTART_FAILED_APP';
export const RESTART_FAILED_TIMEOUT_ENV = 'DURATION_UPDATE_RESTART_FAILED_MS';

/** Button names that must not appear (they would imply the update can continue). */
export const RETRY_RESUME_NAME = /^(Retry|Resume)$/i;

export function restartFailedHookEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|yes)$/i.test(env[RESTART_FAILED_HOOK_ENV]?.trim() ?? '');
}

export function resolveRestartFailedInstanceId(
  instanceId?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (env[RESTART_FAILED_INSTANCE_ENV]?.trim() || instanceId?.trim() || '');
}

export function resolveRestartFailedApp(env: NodeJS.ProcessEnv = process.env): string | null {
  const name = env[RESTART_FAILED_APP_ENV]?.trim();
  return name || null;
}

/** Wait budget after clicking Update (same order as e2e/update-app.spec.ts). */
export function restartFailedTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[RESTART_FAILED_TIMEOUT_ENV]?.trim();
  if (raw && /^\d+$/.test(raw)) return Math.max(30_000, Number(raw));
  return 15 * 60_000;
}

export const RESTART_FAILED_MISSING_HOOK =
  `idea#168 update_restart_failed: this Intent needs the Engine fault-injection hook ` +
  `to fail the post-backup restart (engine#442 restartFailed). Start the Engine under test ` +
  `with IDEA_TEST_FAIL_UPDATE_RESTART=<instanceId> and config.settings.testMode on ` +
  `(engine#467); the hook is ignored without testMode. ` +
  `Then set ${RESTART_FAILED_HOOK_ENV}=1 and ${RESTART_FAILED_INSTANCE_ID_PLACEHOLDER()} ` +
  `to the same instance (optional ${RESTART_FAILED_APP_ENV} for the App display name) ` +
  `and include this action in the walk. No soft-pass.`;

function RESTART_FAILED_INSTANCE_ID_PLACEHOLDER(): string {
  return RESTART_FAILED_INSTANCE_ENV;
}

export function restartFailedMissingHookMessage(): string {
  return RESTART_FAILED_MISSING_HOOK;
}

const ensureOverview = async (page: Page): Promise<void> => {
  await page
    .locator(sel.opOverview)
    .or(page.locator(sel.networkTree))
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
};

const collapseRowIfExpanded = async (page: Page, id: string): Promise<void> => {
  const hide = page.locator(`${sel.instance(id)} button[aria-expanded="true"]`);
  if (await hide.count()) {
    await hide.first().click().catch(() => {});
  }
};

/**
 * Hook-gated Intent. When the hook is armed, click Update and assert the #217
 * alert, no Retry/Resume, and the InstanceRow error hint.
 */
export const update_restart_failed: IntentFn = async ({ page, instanceId }) => {
  if (!restartFailedHookEnabled()) {
    throw new Error(restartFailedMissingHookMessage());
  }
  const id = resolveRestartFailedInstanceId(instanceId);
  if (!id) {
    throw new Error(
      `idea#168 update_restart_failed: ${RESTART_FAILED_HOOK_ENV} is set but no instance id ` +
        `was given (${RESTART_FAILED_INSTANCE_ENV} or ctx.instanceId). No soft-pass.`,
    );
  }

  await ensureOverview(page);
  const allApps = page.locator(sel.networkAllApps);
  if (await allApps.isVisible().catch(() => false)) {
    await allApps.click().catch(() => {});
  }

  const row = page.locator(sel.instance(id));
  await row.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  if (!(await row.isVisible().catch(() => false))) {
    throw new Error(
      `idea#168 update_restart_failed: instance row ${id} is not visible. ` +
        `Open ALL APPS / overview first. No soft-pass.`,
    );
  }

  const badge = page.locator(sel.updateBadge(id));
  if (!(await badge.count())) {
    throw new Error(
      `idea#168 update_restart_failed: update-badge-${id} is missing — the instance ` +
        `needs an update offer and the Engine needs the updateApp capability. No soft-pass.`,
    );
  }
  await badge.waitFor({ state: 'visible', timeout: 60_000 });
  if (await badge.isDisabled().catch(() => false)) {
    const title = ((await badge.getAttribute('title')) ?? '').trim();
    throw new Error(
      `idea#168 update_restart_failed: update-badge-${id} is disabled` +
        `${title ? ` (${title})` : ''}. No soft-pass.`,
    );
  }
  await badge.click();

  const confirm = page.locator(sel.updateConfirm(id));
  await confirm.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  if (!(await confirm.isVisible().catch(() => false))) {
    throw new Error(
      `idea#168 update_restart_failed: update confirm dialog for ${id} did not open. No soft-pass.`,
    );
  }
  const confirmBtn = page.locator(sel.updateConfirmBtn(id));
  if (await confirmBtn.isDisabled().catch(() => false)) {
    throw new Error(
      `idea#168 update_restart_failed: Update is disabled for ${id} (backup gate?). No soft-pass.`,
    );
  }
  await confirmBtn.click();

  const app =
    resolveRestartFailedApp() ||
    ((await row.locator('.instance-row__app').textContent().catch(() => '')) ?? '').trim();
  if (!app) {
    throw new Error(
      `idea#168 update_restart_failed: could not read the App display name for ${id}; ` +
        `set ${RESTART_FAILED_APP_ENV}. No soft-pass.`,
    );
  }
  const expected = restartFailedAlertText(app);
  const budget = restartFailedTimeoutMs();
  const alert = page.locator(sel.updateRestartFailedAlert(id));
  const deadline = Date.now() + budget;
  let text = '';
  while (Date.now() < deadline) {
    const n = await alert.count();
    for (let i = 0; i < n; i++) {
      const loc = alert.nth(i);
      if (!(await loc.isVisible().catch(() => false))) continue;
      text = ((await loc.textContent()) ?? '').trim();
      if (text === expected) break;
    }
    if (text === expected) break;
    await page.waitForTimeout(500);
  }
  if (text !== expected) {
    throw new Error(
      `idea#168 update_restart_failed: expected the #217 alert for ${app} within ${budget}ms, ` +
        `got ${JSON.stringify(text || '(missing)')}. The Engine hook must set restartFailed ` +
        `and must not leave the App Running. No soft-pass.`,
    );
  }

  const outcome = page.locator(sel.updateOutcome(id));
  if (await outcome.isVisible().catch(() => false)) {
    const kind = ((await outcome.getAttribute('data-kind')) ?? '').trim();
    if (kind && kind !== 'failed') {
      throw new Error(
        `idea#168 update_restart_failed: update-outcome-${id} data-kind is "${kind}", expected "failed". No soft-pass.`,
      );
    }
  }

  const retry = page.locator(`${sel.updateApp(id)}, ${sel.instance(id)}`).getByRole('button', { name: RETRY_RESUME_NAME });
  const retryCount = await retry.count();
  if (retryCount > 0) {
    throw new Error(
      `idea#168 update_restart_failed: found a Retry/Resume control on ${id} — the App is stopped, ` +
        `the update must not look resumable. No soft-pass.`,
    );
  }

  await collapseRowIfExpanded(page, id);
  const hint = page.locator(sel.instanceErrorHint(id));
  await hint.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  if (!(await hint.isVisible().catch(() => false))) {
    throw new Error(
      `idea#168 update_restart_failed: InstanceRow error hint for ${id} is not visible. ` +
        `Steve kept this hint (status Error + statusCondition, row collapsed). No soft-pass.`,
    );
  }
};
