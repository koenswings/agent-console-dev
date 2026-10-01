/**
 * Operator deep-path Intents (idea#166/#168 grow toward full Markov proposal).
 * Real Console click sequences — fail loud; never silent skip.
 *
 * Axle locked snake_case keys from proposal UI Interaction titles.
 */
import type { Page } from '@playwright/test';
import type { IntentFn } from './types';
import { sel } from './selectors';
import { DURATION_FIXTURES } from './fixtures';
import {
  openAppInstance,
  ensureInstanceRunningForOpen,
} from './openApp';
import { start_instance, resolveStartInstanceId } from './operatorActions';
import { appKindForInstance, sidecarReadyTimeoutMs } from './sidecarUrls';
import { performOperatorSignIn } from './signInReady';
import { ensureEmptyDiskPanel } from './emptyDisk';
import {
  ensureBackupDiskPanel,
  completeMakeBackupDiskForm,
  assertBackupConfigured,
} from './backupDisk';

const ensureOpLayout = async (page: Page): Promise<void> => {
  await page
    .locator(sel.opOverview)
    .or(page.locator(sel.networkTree))
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
};

/** Throw if a menu card is missing or disabled (capability / diskArg gate). */
const clickCardOrFail = async (
  page: Page,
  testId: string,
  intent: string,
): Promise<void> => {
  const card = page.locator(`[data-testid="${testId}"]`);
  if (!(await card.count())) {
    throw new Error(
      `idea#168 ${intent}: [data-testid="${testId}"] not found — open an empty disk ` +
        `(ensureEmptyDiskPanel / dock duration-empty-001) so EmptyDiskPanel menu is visible.`,
    );
  }
  await card.waitFor({ state: 'visible', timeout: 10_000 });
  if (await card.isDisabled()) {
    const title = (await card.getAttribute('title'))?.trim() || 'disabled';
    throw new Error(
      `idea#168 ${intent}: ${testId} is greyed out (${title}). ` +
        `Engine may lack diskIdArgs / capabilities — fail loud, not silent skip.`,
    );
  }
  await card.click();
};

/**
 * Install App (proposal) — EmptyDiskPanel catalog → pick app → Install.
 * Defaults to first catalog radio; prefer Kolibri title when present.
 */
export const install_app: IntentFn = async ({ page, diskId }) => {
  await ensureEmptyDiskPanel(page, { diskId }, 'install_app');
  await clickCardOrFail(page, 'install-app', 'install_app');

  // Prefer Kolibri catalog item by label text, else first install-app-item-*
  const kolibri = page
    .locator('[data-testid^="install-app-item-"]')
    .filter({ hasText: /kolibri/i })
    .first();
  if (await kolibri.count()) {
    await kolibri.click();
  } else {
    const any = page.locator('[data-testid^="install-app-item-"]').first();
    if (!(await any.count())) {
      throw new Error(
        'idea#168 install_app: EmptyDiskPanel Install catalog has no apps (appDB empty).',
      );
    }
    await any.click();
  }

  const submit = page.locator(sel.installAppSubmit);
  await submit.waitFor({ state: 'visible', timeout: 10_000 });
  if (await submit.isDisabled()) {
    throw new Error('idea#168 install_app: Install App submit disabled (no app selected?).');
  }
  await submit.click();
  // Best-effort: wait for pending indicator or leave for walker settle
  const pending = page.locator(sel.installPending);
  if (await pending.isVisible().catch(() => false)) {
    await pending.waitFor({ state: 'hidden', timeout: 5 * 60_000 }).catch(() => {});
  }
};

/** Start after install — reuse start_instance on the just-installed (or ctx) instance. */
export const start_after_install: IntentFn = async (ctx) => {
  await start_instance(ctx);
};

/** Stay on disk — assert DiskView / EmptyDiskPanel for diskId and dwell briefly. */
export const stay_on_disk: IntentFn = async ({ page, diskId }) => {
  await ensureOpLayout(page);
  const id = diskId ?? DURATION_FIXTURES.kolibri.diskId;
  const view = page.locator(sel.diskView(id));
  const empty = page.locator(sel.emptyDiskPanel);
  const visible = view.or(empty).first();
  // If not already on the disk panel, click the disk row
  if (!(await visible.isVisible().catch(() => false))) {
    const row = page.locator(sel.disk(id));
    await row.waitFor({ state: 'visible', timeout: 15_000 });
    await row.click();
  }
  await visible.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(400);
};

/**
 * Make Backup Disk — EmptyDiskPanel → on-demand → check ≥1 instance → Configure.
 * Wait until backup role / success. Prefer A: no soft-pass on validation banner.
 */
export const make_backup_disk: IntentFn = async ({ page, diskId, instanceId }) => {
  const emptyId = await ensureEmptyDiskPanel(page, { diskId }, 'make_backup_disk');
  await clickCardOrFail(page, 'make-backup-disk', 'make_backup_disk');
  await completeMakeBackupDiskForm(page, {
    diskId: emptyId,
    instanceId,
    intent: 'make_backup_disk',
  });
};

/**
 * Open app — ensure Running → Path A Open ↗ / Path B sidecar (defaults Kolibri).
 * Prefer A: never open against Stopped (r18 FAIL@79). Distinct from open_kolibri_as_* (no login).
 */
export const open_app: IntentFn = async ({ page, instanceId }) => {
  const id = resolveStartInstanceId(instanceId);
  await openAppInstance(page, id);
};

/**
 * Backup instance — InstanceRow Back up (requires linked Backup Disk in UI).
 */
export const backup_instance: IntentFn = async ({ page, instanceId }) => {
  await ensureOpLayout(page);
  const id = instanceId ?? DURATION_FIXTURES.kolibri.instanceId;
  const row = page.locator(sel.instance(id));
  await row.waitFor({ state: 'visible', timeout: 15_000 });
  // Expand/focus row so actions are visible
  await row.click();
  const btn = page.locator(sel.backupInstance(id));
  if (!(await btn.count())) {
    throw new Error(
      `idea#168 backup_instance: backup-instance-${id} not in Console UI — ` +
        `InstanceRow only shows Back up when a Backup Disk is linked to this instance ` +
        `(hasBackupDisks). Dock/configure a Backup Disk first, or graph should not sample this edge.`,
    );
  }
  await btn.waitFor({ state: 'visible', timeout: 10_000 });
  if (await btn.isDisabled()) {
    throw new Error(
      `idea#168 backup_instance: backup-instance-${id} disabled (status/locked).`,
    );
  }
  await btn.click();
};

/** Back to disk — select parent disk row (ctx.diskId) → DiskView / EmptyDiskPanel. */
export const back_to_disk: IntentFn = async ({ page, diskId }) => {
  await ensureOpLayout(page);
  const id = diskId ?? DURATION_FIXTURES.kolibri.diskId;
  const row = page.locator(sel.disk(id));
  await row.waitFor({ state: 'visible', timeout: 15_000 });
  await row.click();
  await page
    .locator(sel.diskView(id))
    .or(page.locator(sel.emptyDiskPanel))
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 });
};

/** Back to overview — NetworkTree "All apps" → op_overview without disk focus. */
export const back_to_overview: IntentFn = async ({ page }) => {
  await ensureOpLayout(page);
  // Close account/settings overlays if they cover the tree
  if (await page.locator(sel.opEntry).isVisible().catch(() => false)) {
    await page.locator(sel.accountBtn).click().catch(() => {});
  }
  if (await page.locator(sel.settingsPanel).isVisible().catch(() => false)) {
    await page.locator(sel.settingsBtn).click().catch(() => {});
  }
  const allApps = page.locator(sel.networkAllApps);
  await allApps.waitFor({ state: 'visible', timeout: 15_000 });
  await allApps.click();
  await page.locator(sel.opOverview).waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator(sel.networkTree).waitFor({ state: 'visible', timeout: 5_000 });
};

/** Log out — Account → Log out → login form / user mode. */
export const log_out: IntentFn = async ({ page }) => {
  if (!(await page.locator(sel.opEntry).isVisible().catch(() => false))) {
    await page.locator(sel.accountBtn).click();
  }
  await page.locator(sel.opEntry).waitFor({ state: 'visible', timeout: 10_000 });
  const logout = page.locator(sel.logOut);
  if (!(await logout.count())) {
    throw new Error(
      'idea#168 log_out: [data-testid="log-out"] not found — Account may already be logged out ' +
        '(login form visible). Open Account while authenticated first.',
    );
  }
  await logout.click();
  await page.locator(sel.loginForm).waitFor({ state: 'visible', timeout: 10_000 });
};

/**
 * Notice USB dock — soft dwell: assert NetworkTree visible after a dock event.
 * Hardware dock is Engine/fleet-owned; this Intent only settles the Console UI.
 */
export const notice_usb_dock: IntentFn = async ({ page }) => {
  await ensureOpLayout(page);
  await page.locator(sel.networkTree).waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(500);
};

/**
 * Retry login / first-time setup — wait out Connecting… after dock/undock,
 * then complete first-time setup or operator login. Already-logged-in = hardpass.
 * Loud-fail with status-bar / sign-in diagnostics if store never syncs.
 */
export const retry_login_first_time_setup: IntentFn = async ({ page }) => {
  const intent = 'retry_login_first_time_setup';
  const state = await performOperatorSignIn(page, { intent });

  if (state === 'first_time_setup') {
    const setupForm = page.locator(sel.firstTimeSetupForm);
    await setupForm.waitFor({ state: 'visible', timeout: 10_000 });
    const uname = process.env.DURATION_OPERATOR_USERNAME?.trim() || 'admin';
    const pw = process.env.DURATION_OPERATOR_PASSWORD?.trim() || 'admin911!';
    await setupForm.locator('input[autocomplete="username"]').fill(uname);
    await setupForm.locator('input[autocomplete="new-password"]').first().fill(pw);
    const pwInputs = setupForm.locator('input[type="password"]');
    if ((await pwInputs.count()) >= 2) await pwInputs.nth(1).fill(pw);
    await setupForm.locator('button[type="submit"]').click();
    await page.locator(sel.opOverview).waitFor({ state: 'visible', timeout: 30_000 });
    return;
  }

  if (state === 'already_logged_in') {
    // Session restore after open_console — close Account → overview
    if (await page.locator(sel.opEntry).isVisible().catch(() => false)) {
      await page.locator(sel.accountBtn).click().catch(() => {});
    }
    await page.locator(sel.opOverview).waitFor({ state: 'visible', timeout: 20_000 });
    return;
  }

  // Just signed in — dismiss Account overlay
  if (await page.locator(sel.opEntry).isVisible().catch(() => false)) {
    await page.locator(sel.accountBtn).click().catch(() => {});
  }
  await page.locator(sel.opOverview).waitFor({ state: 'visible', timeout: 20_000 });
};

/** Settle budget after restore Confirm (env DURATION_RESTORE_SETTLE_MS or sidecar budget). */
export function restoreSettleTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DURATION_RESTORE_SETTLE_MS?.trim();
  if (raw && /^\d+$/.test(raw)) return Math.max(5_000, Number(raw));
  // Restore+docker restart often > sidecar poll alone
  return Math.max(sidecarReadyTimeoutMs(env), 120_000);
}

/**
 * After Confirm Restore: wait unlock, return to overview, ensure real Running + sidecar.
 * Prefer A r21: restore SIGTERM leaves Automerge ghost Running → docker-missing on move_app.
 */
export async function settleAfterRestoreConfirm(
  page: Page,
  linkedId: string,
): Promise<void> {
  const confirm = page.locator(sel.restoreConfirm(linkedId));
  try {
    await confirm.waitFor({ state: 'hidden', timeout: 15_000 });
  } catch {
    throw new Error(
      `idea#168 restore_from_backup: restore-confirm-${linkedId} still visible after Confirm. No soft-pass.`,
    );
  }

  // Restore locks the instance ("Operation in progress" on Restore btn)
  const btn = page.locator(sel.restoreBtn(linkedId));
  const budget = restoreSettleTimeoutMs();
  const deadline = Date.now() + budget;
  let sawProgress = false;
  while (Date.now() < deadline) {
    if (await btn.isVisible().catch(() => false)) {
      const label = ((await btn.textContent()) ?? '').trim();
      if (/operation in progress/i.test(label)) {
        sawProgress = true;
        await page.waitForTimeout(500);
        continue;
      }
      // Unlocked — restore command finished (or never locked briefly)
      break;
    }
    // Confirm cleared; btn may briefly be absent while confirmingId flips
    await page.waitForTimeout(400);
  }
  if (sawProgress && Date.now() >= deadline) {
    throw new Error(
      `idea#168 restore_from_backup: restore still "Operation in progress" after ${budget}ms ` +
        `(instance=${linkedId}). Docker/store did not settle. No soft-pass.`,
    );
  }
  // Brief quiet even if lock was too fast to observe
  await page.waitForTimeout(800);

  // Back to Operator overview / ALL APPS so instance cards are visible
  if (await page.locator(sel.opEntry).isVisible().catch(() => false)) {
    await page.locator(sel.accountBtn).click().catch(() => {});
  }
  if (await page.locator(sel.settingsPanel).isVisible().catch(() => false)) {
    await page.locator(sel.settingsBtn).click().catch(() => {});
  }
  await ensureOpLayout(page);
  const allApps = page.locator(sel.networkAllApps);
  if (await allApps.isVisible().catch(() => false)) {
    await allApps.click().catch(() => {});
  }

  // Ghost Running after restore SIGTERM — force-restart + sidecar HTTP (same as open_app r19)
  const kind = appKindForInstance(linkedId);
  try {
    await ensureInstanceRunningForOpen(page, linkedId, kind);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `idea#168 restore_from_backup: post-Confirm settle failed for ${linkedId} — ${msg} ` +
        `r21: restore may SIGTERM while Automerge stays Running; must force-restart + sidecar ready ` +
        `before move_app. No soft-pass / no demo remap.`,
    );
  }
}

/**
 * Restore from Backup — ensure Backup Disk selected (RestorePanel), then
 * pick target disk → Restore → Confirm → settle Running+sidecar.
 * Prefer A: no soft-skip / no Grade5A remap.
 */
export const restore_from_backup: IntentFn = async ({ page, instanceId, diskId }) => {
  await ensureBackupDiskPanel(page, { diskId }, 'restore_from_backup');
  const id = instanceId ?? DURATION_FIXTURES.kolibri.instanceId;
  const row = page.locator(sel.restoreInstance(id));
  // Fall back to first restore-instance-* if fixture id not on this backup disk
  const targetRow =
    (await row.count()) > 0 ? row : page.locator('[data-testid^="restore-instance-"]').first();
  if (!(await targetRow.count())) {
    throw new Error(
      'idea#168 restore_from_backup: no restore-instance-* rows (Backup Disk has no linked instances).',
    );
  }
  const rowTestId = (await targetRow.getAttribute('data-testid')) ?? '';
  const linkedId = rowTestId.replace(/^restore-instance-/, '') || id;
  const select = page.locator(sel.restoreTarget(linkedId));
  await select.waitFor({ state: 'visible', timeout: 10_000 });
  const options = select.locator('option');
  const optCount = await options.count();
  let chosen = '';
  for (let i = 0; i < optCount; i++) {
    const v = await options.nth(i).getAttribute('value');
    if (v) {
      chosen = v;
      break;
    }
  }
  if (!chosen) {
    throw new Error(
      'idea#168 restore_from_backup: no available target disks in restore-target select.',
    );
  }
  await select.selectOption(chosen);
  await page.locator(sel.restoreBtn(linkedId)).click();
  await page.locator(sel.restoreConfirm(linkedId)).click();
  await settleAfterRestoreConfirm(page, linkedId);
};

/**
 * Change password — works on AccountScreen OR OperatorManagement (same testids).
 * Prefer A walk often lands on operator-mgmt after add/remove; that form must
 * carry data-testid="change-password-form" (was missing → false "not logged in").
 * Idempotent: current=new=admin911! (or DURATION_OPERATOR_PASSWORD).
 */
export const change_password: IntentFn = async ({ page }) => {
  const pw =
    process.env.DURATION_OPERATOR_PASSWORD?.trim() || 'admin911!';

  // Ensure Account chrome (operator-mgmt is inside Account)
  if (
    !(await page.locator(sel.opEntry).isVisible().catch(() => false)) &&
    !(await page.locator(sel.operatorManagement).isVisible().catch(() => false))
  ) {
    await page.locator(sel.accountBtn).click();
    await page.locator(sel.opEntry).waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  }

  let form = page.locator(sel.changePasswordForm);
  if (!(await form.isVisible().catch(() => false))) {
    // On Account main without form → not operator; on operator-mgmt form must exist
    const onMgmt = await page.locator(sel.operatorManagement).isVisible().catch(() => false);
    const onAccount = await page.locator(sel.opEntry).isVisible().catch(() => false);
    if (onMgmt) {
      throw new Error(
        'idea#168 change_password: Operator Management is open but ' +
          '[data-testid="change-password-form"] is missing on Change My Password. ' +
          'UI bug — not an auth failure.',
      );
    }
    if (onAccount) {
      // Main account view should have the form when isOperator
      throw new Error(
        'idea#168 change_password: Account is open but change-password-form not visible. ' +
          'If login form is showing, sign_in as operator first. ' +
          'If Manage Operators is needed, form also exists there after testid fix.',
      );
    }
    throw new Error(
      'idea#168 change_password: change-password-form not found — open Account ' +
        '(op-entry) or Operator Management first.',
    );
  }

  const current = form.locator(sel.changePasswordCurrent).or(form.locator('input[type="password"]').nth(0));
  const next = form.locator(sel.changePasswordNew).or(form.locator('input[type="password"]').nth(1));
  const confirm = form.locator(sel.changePasswordConfirm).or(form.locator('input[type="password"]').nth(2));
  await current.first().fill(pw);
  await next.first().fill(pw);
  await confirm.first().fill(pw);
  await form.locator(sel.changePassword).click();
  // Success toast optional (wrong current pw → error); accept either success or stay filled
  const success = page.locator(sel.changePasswordSuccess);
  const err = form.locator('.form-error');
  await Promise.race([
    success.waitFor({ state: 'visible', timeout: 10_000 }),
    err.waitFor({ state: 'visible', timeout: 10_000 }),
  ]).catch(() => {});
  if (await err.isVisible().catch(() => false)) {
    const msg = (await err.textContent())?.trim() || 'unknown';
    throw new Error(
      `idea#168 change_password: form rejected submit (${msg}). ` +
        `Check DURATION_OPERATOR_PASSWORD / admin911! matches live admin password.`,
    );
  }
};

/**
 * Add operator — Manage Operators → Add operator form.
 * Username derived from timestamp so repeats don't collide.
 * Hardens: wait until the new row appears (toast alone ≠ list sync).
 */
export const add_operator: IntentFn = async ({ page }) => {
  if (
    !(await page.locator(sel.operatorManagement).isVisible().catch(() => false))
  ) {
    if (!(await page.locator(sel.opEntry).isVisible().catch(() => false))) {
      await page.locator(sel.accountBtn).click();
    }
    const manage = page.locator(sel.manageOperators);
    if (!(await manage.count())) {
      throw new Error(
        'idea#168 add_operator: manage-operators not found — must be logged in as operator ' +
          '(Account → Manage Operators).',
      );
    }
    await manage.click();
    await page.locator(sel.operatorManagement).waitFor({ state: 'visible', timeout: 10_000 });
  }
  const form = page.locator(sel.addOperatorForm);
  const uname =
    process.env.DURATION_ADD_OPERATOR_USERNAME?.trim() ||
    `opwalk${Date.now().toString(36).slice(-6)}`;
  const opPw =
    process.env.DURATION_ADD_OPERATOR_PASSWORD?.trim() || 'operator911!';
  await form.locator('input[type="text"]').fill(uname);
  await form.locator('input[type="password"]').fill(opPw);
  await page.locator(sel.addOperator).click();

  // Toast
  const toast = page.locator(sel.addOperatorSuccess);
  try {
    await toast.waitFor({ state: 'visible', timeout: 15_000 });
  } catch {
    const err = form.locator('.form-error');
    const msg = (await err.textContent().catch(() => ''))?.trim();
    throw new Error(
      `idea#168 add_operator: add-operator-success not shown` +
        (msg ? ` (form error: ${msg})` : '') +
        `.`,
    );
  }

  // Row must appear — soft-pass if only toast
  const row = page.locator(
    `[data-testid^="operator-row-"][data-username="${uname}"], .operator-mgmt__item`,
  ).filter({ hasText: uname });
  try {
    await row.first().waitFor({ state: 'visible', timeout: 15_000 });
  } catch {
    throw new Error(
      `idea#168 add_operator: toast says created "${uname}" but operator row never appeared in list. ` +
        `userDB sync lag or createOperator write failed — not hardpass.`,
    );
  }

  // Removable button must exist for remove_operator
  const removable = page.locator('[data-testid^="remove-operator-"]:not([disabled])');
  if (!(await removable.count())) {
    throw new Error(
      `idea#168 add_operator: "${uname}" listed but no enabled Remove button ` +
        `(cannot proceed to remove_operator).`,
    );
  }
};

/**
 * Remove operator — click enabled Remove on a non-self row; wait until gone.
 * Toast from add_operator alone is NOT success. Loud-fail if only admin /
 * Remove disabled / no enabled remove-operator-*.
 */
export const remove_operator: IntentFn = async ({ page }) => {
  if (!(await page.locator(sel.operatorManagement).isVisible().catch(() => false))) {
    if (!(await page.locator(sel.opEntry).isVisible().catch(() => false))) {
      await page.locator(sel.accountBtn).click();
    }
    const manage = page.locator(sel.manageOperators);
    if (!(await manage.count())) {
      throw new Error(
        'idea#168 remove_operator: manage-operators not found — open Account as operator first.',
      );
    }
    await manage.click();
    await page.locator(sel.operatorManagement).waitFor({ state: 'visible', timeout: 10_000 });
  }

  const targetUname = process.env.DURATION_REMOVE_OPERATOR_USERNAME?.trim();
  let btn = targetUname
    ? page
        .locator(`[data-testid^="operator-row-"][data-username="${targetUname}"]`)
        .locator('[data-testid^="remove-operator-"]')
    : page.locator('[data-testid^="remove-operator-"]:not([disabled])').first();

  try {
    await btn.waitFor({ state: 'visible', timeout: 15_000 });
  } catch {
    const toast = await page.locator(sel.addOperatorSuccess).textContent().catch(() => null);
    throw new Error(
      'idea#168 remove_operator: no enabled Remove on a non-self operator row. ' +
        'Cannot remove admin (you). Run add_operator first and wait for the row. ' +
        (toast
          ? `Stale toast still visible (${toast.trim()}) is NOT proof the operator is listed.`
          : 'No add-operator-success toast either.') +
        (targetUname ? ` DURATION_REMOVE_OPERATOR_USERNAME=${targetUname}` : ''),
    );
  }

  if (await btn.isDisabled()) {
    throw new Error(
      'idea#168 remove_operator: target Remove is disabled (self / admin only). Need a removable operator.',
    );
  }

  const testId = await btn.getAttribute('data-testid');
  if (!testId) {
    throw new Error('idea#168 remove_operator: remove button missing data-testid');
  }

  page.once('dialog', (d) => d.accept());
  await btn.click();

  // Wait until that remove control is gone (row deleted from userDB)
  try {
    await page.locator(`[data-testid="${testId}"]`).waitFor({ state: 'detached', timeout: 15_000 });
  } catch {
    throw new Error(
      `idea#168 remove_operator: clicked ${testId} but row still present after 15s — ` +
        `removeOperator/changeDoc may have failed. Not soft-pass.`,
    );
  }

  // Still must not leave an enabled remove if we targeted specific user; OK if others remain
  if (targetUname) {
    const still = page.locator(
      `[data-testid^="operator-row-"][data-username="${targetUname}"]`,
    );
    if (await still.count()) {
      throw new Error(
        `idea#168 remove_operator: operator "${targetUname}" still listed after remove.`,
      );
    }
  }
};


// ── Part B: remaining operator edges from ACTIONS.md / unified.yaml ─────────

/**
 * Files role added — assert Files section / badge after add_files_role.
 * Stays on / returns to op_disk.
 */
export const files_role_added: IntentFn = async ({ page, diskId }) => {
  await ensureOpLayout(page);
  const id = diskId ?? DURATION_FIXTURES.kolibri.diskId;
  const files = page.locator(sel.diskSectionFiles);
  const view = page.locator(sel.diskView(id));
  if (!(await view.isVisible().catch(() => false))) {
    const row = page.locator(sel.disk(id));
    await row.waitFor({ state: 'visible', timeout: 15_000 });
    await row.click();
  }
  await view.or(page.locator(sel.emptyDiskPanel)).first()
    .waitFor({ state: 'visible', timeout: 10_000 });
  if (!(await files.isVisible().catch(() => false))) {
    // Badge text "Files" on disk view header is also acceptable
    const badge = page.locator('.disk-view__badges, .tree-item__badges').filter({ hasText: /files/i });
    if (!(await badge.count())) {
      throw new Error(
        `idea#168 files_role_added: disk-section-files / Files badge not visible on disk ${id}. ` +
          `Run add_files_role first, or disk lacks files role.`,
      );
    }
  }
  await page.waitForTimeout(300);
};

/**
 * Backup configured / restored — real backup role / RestorePanel / success only.
 * Never EmptyDiskPanel leftovers ("Backup Disk" menu/form text). Prefer A.
 */
export const backup_configured_restored: IntentFn = async ({ page, diskId }) => {
  await ensureOpLayout(page);
  await assertBackupConfigured(page, { diskId }, 'backup_configured_restored');
  await page.waitForTimeout(300);
};

/** Done redistribute — clear focus to NetworkTree overview after copy/move. */
export const done_redistribute: IntentFn = back_to_overview;

/** Stay on source disk — dwell on DiskView after copy/move (same as stay_on_disk). */
export const stay_on_source_disk: IntentFn = stay_on_disk;

/** Open copied instance — focus instance controls (ctx.instanceId of the new copy). */
export const open_copied_instance: IntentFn = async ({ page, instanceId }) => {
  await ensureOpLayout(page);
  const id = instanceId ?? DURATION_FIXTURES.kolibri.instanceId;
  const row = page.locator(sel.instance(id));
  await row.waitFor({ state: 'visible', timeout: 15_000 });
  await row.click();
  await page
    .locator(sel.startInstance(id))
    .or(page.locator(sel.stopInstance(id)))
    .or(page.locator(sel.openInstance(id)))
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 });
};

/**
 * Switch Engine — open Settings → Engine Connection.
 * Current Console Settings shows status/demo only (Connect picker is onboarding
 * ConnectionManagement). Fail loud if no connect control; succeed when tab visible
 * so the walk can settle in op_settings.
 */
export const switch_engine: IntentFn = async ({ page }) => {
  if (!(await page.locator(sel.settingsPanel).isVisible().catch(() => false))) {
    await page.locator(sel.settingsBtn).click();
  }
  await page.locator(sel.settingsPanel).waitFor({ state: 'visible', timeout: 10_000 });
  const tab = page.locator(sel.settingsTabEngine);
  if (await tab.count()) await tab.click();
  // Prefer a Connect control if present (future Settings reconnect UI)
  const connect = page.locator(
    '[data-testid="switch-engine-connect"], .engine-picker__connect-btn, button:has-text("Connect")',
  );
  if (await connect.count()) {
    // Click first Connect that is not the current-only status — walker may pass engine via env
    const target = process.env.DURATION_SWITCH_ENGINE_HOST?.trim();
    if (target) {
      const row = page.locator('.engine-picker__item').filter({ hasText: new RegExp(target, 'i') });
      if (await row.count()) {
        await row.locator('button').filter({ hasText: /connect/i }).click();
        return;
      }
      throw new Error(
        `idea#168 switch_engine: DURATION_SWITCH_ENGINE_HOST=${target} not in discovery list.`,
      );
    }
    await connect.first().click();
    return;
  }
  throw new Error(
    'idea#168 switch_engine: Settings → Engine Connection has no Connect picker in current Console UI ' +
      '(ConnectionManagement is onboarding-only). Open Settings tab for settle only is insufficient — ' +
      'need Settings reconnect UI or set DURATION_SWITCH_ENGINE_HOST once Connect buttons exist.',
  );
};

/**
 * Reboot Engine — NetworkTree reboot button on engine row (confirm dialog).
 * Defaults to first visible reboot-engine-* unless engineId in ctx.
 */
export const reboot_engine: IntentFn = async ({ page, engineId }) => {
  await ensureOpLayout(page);
  const btn = engineId
    ? page.locator(sel.rebootEngine(engineId))
    : page.locator('[data-testid^="reboot-engine-"]').first();
  if (!(await btn.count())) {
    throw new Error(
      'idea#168 reboot_engine: no reboot-engine-* button in NetworkTree (operator layout required).',
    );
  }
  page.once('dialog', (d) => d.accept());
  await btn.click();
  await page.waitForTimeout(500);
};

/**
 * Back to Console / Leave Kolibri / Leave Nextcloud —
 * Close App tab if present; assert Console overview (teacher/learner) or op_overview.
 */
const leaveAppToConsole = async (page: import('@playwright/test').Page): Promise<void> => {
  const pages = page.context().pages();
  for (const p of pages) {
    try {
      const url = p.url();
      if (
        p !== page &&
        /kolibri|nextcloud|18080|18081|18280|\/learn|\/coach|\/facility|\/auth|\/device|\/apps\/files/i.test(
          url,
        )
      ) {
        await p.close().catch(() => {});
      }
    } catch {
      /* closed */
    }
  }
  await page.bringToFront().catch(() => {});
  // Close account/settings overlays that hide overview
  if (await page.locator(sel.opEntry).isVisible().catch(() => false)) {
    await page.locator(sel.accountBtn).click().catch(() => {});
  }
  if (await page.locator(sel.settingsPanel).isVisible().catch(() => false)) {
    await page.locator(sel.settingsBtn).click().catch(() => {});
  }
  const overview = page.locator(sel.consoleOverview);
  const op = page.locator(sel.opOverview);
  if (await overview.isVisible().catch(() => false)) {
    await overview.waitFor({ state: 'visible', timeout: 5_000 });
    return;
  }
  if (await op.isVisible().catch(() => false)) {
    await op.waitFor({ state: 'visible', timeout: 5_000 });
    return;
  }
  await overview.or(op).first().waitFor({ state: 'visible', timeout: 15_000 });
};

export const back_to_console: IntentFn = async ({ page }) => {
  await leaveAppToConsole(page);
};

export const leave_kolibri: IntentFn = async ({ page }) => {
  await leaveAppToConsole(page);
};

export const leave_nextcloud_as_teacher: IntentFn = async ({ page }) => {
  await leaveAppToConsole(page);
};

export const leave_nextcloud_as_learner: IntentFn = async ({ page }) => {
  await leaveAppToConsole(page);
};
