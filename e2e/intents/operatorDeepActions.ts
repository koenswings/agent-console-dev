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
import { openAppInstance } from './openApp';
import { start_instance } from './operatorActions';

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
        `(open_disk_inventory) so EmptyDiskPanel menu is visible.`,
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
export const install_app: IntentFn = async ({ page }) => {
  await page.locator(sel.emptyDiskPanel).waitFor({ state: 'visible', timeout: 15_000 });
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
 * Make Backup Disk — EmptyDiskPanel Backup card → Configure (on-demand default).
 * Fails loud when card is gated (no diskIdArgs / capability).
 */
export const make_backup_disk: IntentFn = async ({ page }) => {
  await page.locator(sel.emptyDiskPanel).waitFor({ state: 'visible', timeout: 15_000 });
  await clickCardOrFail(page, 'make-backup-disk', 'make_backup_disk');
  const configure = page.locator(sel.configureBackupDisk);
  await configure.waitFor({ state: 'visible', timeout: 10_000 });
  await configure.click();
  const pending = page.locator(sel.backupPending);
  if (await pending.isVisible().catch(() => false)) {
    await pending.waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});
  }
};

/**
 * Open app — Path A Console Open ↗, else Path B sidecar URL (defaults Kolibri).
 * Distinct from open_kolibri_as_* (no App login).
 */
export const open_app: IntentFn = async ({ page, instanceId }) => {
  const id = instanceId ?? DURATION_FIXTURES.kolibri.instanceId;
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
 * Retry login / first-time setup — only when login form or first-time setup is visible.
 */
export const retry_login_first_time_setup: IntentFn = async ({ page }) => {
  const setup = page.locator(sel.firstTimeSetup);
  const form = page.locator(sel.loginForm);

  if (await setup.isVisible().catch(() => false)) {
    const setupForm = page.locator(sel.firstTimeSetupForm);
    await setupForm.waitFor({ state: 'visible', timeout: 10_000 });
    await setupForm.locator('input[autocomplete="username"]').fill('admin');
    await setupForm.locator('input[autocomplete="new-password"]').first().fill('admin911!');
    // Confirm field is typically the second password input
    const pwInputs = setupForm.locator('input[type="password"]');
    const n = await pwInputs.count();
    if (n >= 2) await pwInputs.nth(1).fill('admin911!');
    await setupForm.locator('button[type="submit"]').click();
    await page.locator(sel.opOverview).waitFor({ state: 'visible', timeout: 20_000 });
    return;
  }

  if (!(await form.isVisible().catch(() => false))) {
    // Try opening Account so login form appears
    if (await page.locator(sel.accountBtn).count()) {
      await page.locator(sel.accountBtn).click();
    }
  }

  if (!(await form.isVisible().catch(() => false))) {
    throw new Error(
      'idea#168 retry_login_first_time_setup: neither login-form nor first-time-setup visible. ' +
        'Only valid from op_entry / first-time setup surfaces.',
    );
  }

  await form.locator('input[autocomplete="username"]').fill('admin');
  await form.locator('input[autocomplete="current-password"]').fill('admin911!');
  const submit = page.locator(sel.signIn);
  if (await submit.count()) await submit.click();
  else await form.locator('button[type="submit"]').click();
  // Close Account overlay if still open
  if (await page.locator(sel.opEntry).isVisible().catch(() => false)) {
    await page.locator(sel.accountBtn).click().catch(() => {});
  }
  await page.locator(sel.opOverview).waitFor({ state: 'visible', timeout: 15_000 });
};

/**
 * Restore from Backup — RestorePanel: pick target disk → Restore → Confirm.
 * Requires a Backup Disk already selected (open_disk_inventory on backup disk).
 */
export const restore_from_backup: IntentFn = async ({ page, instanceId }) => {
  const panel = page.locator(sel.restorePanel);
  if (!(await panel.count()) || !(await panel.isVisible().catch(() => false))) {
    throw new Error(
      'idea#168 restore_from_backup: [data-testid="restore-panel"] not visible — ' +
        'select a Backup Disk via open_disk_inventory first.',
    );
  }
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
};

/**
 * Change password — Account change-password form (min 8).
 * Uses demo admin current password; new password stays admin911! (idempotent for walks).
 */
export const change_password: IntentFn = async ({ page }) => {
  if (!(await page.locator(sel.opEntry).isVisible().catch(() => false))) {
    await page.locator(sel.accountBtn).click();
  }
  const form = page.locator(sel.changePasswordForm);
  if (!(await form.count())) {
    throw new Error(
      'idea#168 change_password: change-password-form not found — must be logged in as operator.',
    );
  }
  const inputs = form.locator('input[type="password"]');
  await inputs.nth(0).fill('admin911!');
  await inputs.nth(1).fill('admin911!');
  await inputs.nth(2).fill('admin911!');
  await page.locator(sel.changePassword).click();
};

/**
 * Add operator — Manage Operators → Add operator form.
 * Username derived from timestamp so repeats don't collide.
 */
export const add_operator: IntentFn = async ({ page }) => {
  if (!(await page.locator(sel.opEntry).isVisible().catch(() => false))) {
    await page.locator(sel.accountBtn).click();
  }
  const manage = page.locator(sel.manageOperators);
  if (!(await manage.count())) {
    throw new Error(
      'idea#168 add_operator: manage-operators not found — must be logged in as operator.',
    );
  }
  await manage.click();
  await page.locator(sel.operatorManagement).waitFor({ state: 'visible', timeout: 10_000 });
  const form = page.locator(sel.addOperatorForm);
  const uname = `opwalk${Date.now().toString(36).slice(-6)}`;
  await form.locator('input[type="text"]').fill(uname);
  await form.locator('input[type="password"]').fill('operator911!');
  await page.locator(sel.addOperator).click();
};

/**
 * Remove operator — clicks first removable remove-operator-* (not self).
 * Loud throw if only self remains.
 */
export const remove_operator: IntentFn = async ({ page }) => {
  if (!(await page.locator(sel.operatorManagement).isVisible().catch(() => false))) {
    if (!(await page.locator(sel.opEntry).isVisible().catch(() => false))) {
      await page.locator(sel.accountBtn).click();
    }
    const manage = page.locator(sel.manageOperators);
    if (!(await manage.count())) {
      throw new Error('idea#168 remove_operator: manage-operators not found — logged-in operator required.');
    }
    await manage.click();
    await page.locator(sel.operatorManagement).waitFor({ state: 'visible', timeout: 10_000 });
  }
  const buttons = page.locator('[data-testid^="remove-operator-"]');
  const n = await buttons.count();
  let clicked = false;
  for (let i = 0; i < n; i++) {
    const btn = buttons.nth(i);
    if (!(await btn.isDisabled())) {
      // Accept native confirm() dialog
      page.once('dialog', (d) => d.accept());
      await btn.click();
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    throw new Error(
      'idea#168 remove_operator: no removable operator (cannot remove self; need ≥2 operators).',
    );
  }
};

/**
 * Copy app / Move app — complete Copy/Move modal if already open after a drop.
 * Drag-drop initiation needs multi-disk fixtures; fail loud when modal absent.
 */
export const copy_app: IntentFn = async ({ page }) => {
  const modal = page.locator(sel.copyMoveModal);
  if (!(await modal.isVisible().catch(() => false))) {
    throw new Error(
      'idea#168 copy_app: copy-move-modal not open. Console copy requires drag InstanceRow onto a ' +
        'target App Disk (or mobile sheet). Walker/preload must drop first; then this Intent clicks Copy. ' +
        'Not silently skipped — multi-disk drag setup still needed for full hardpass.',
    );
  }
  await page.locator(sel.copyMoveCopy).click();
  await modal.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
};

export const move_app: IntentFn = async ({ page }) => {
  const modal = page.locator(sel.copyMoveModal);
  if (!(await modal.isVisible().catch(() => false))) {
    throw new Error(
      'idea#168 move_app: copy-move-modal not open. Console move requires drag InstanceRow onto a ' +
        'target App Disk (or mobile sheet). Walker/preload must drop first; then this Intent clicks Move. ' +
        'Not silently skipped — multi-disk drag setup still needed for full hardpass.',
    );
  }
  await page.locator(sel.copyMoveMove).click();
  await modal.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
};
