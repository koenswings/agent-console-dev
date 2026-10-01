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
 * Backup configured / restored — assert Backup Disk view or RestorePanel settled.
 */
export const backup_configured_restored: IntentFn = async ({ page, diskId }) => {
  await ensureOpLayout(page);
  const restore = page.locator(sel.restorePanel);
  const emptyDone = page.locator(sel.emptyDiskPanel).getByText(/Backup Disk|backup/i);
  if (await restore.isVisible().catch(() => false)) {
    await page.waitForTimeout(300);
    return;
  }
  if (await emptyDone.count()) {
    await page.waitForTimeout(300);
    return;
  }
  const id = diskId ?? DURATION_FIXTURES.kolibri.diskId;
  const view = page.locator(sel.diskView(id));
  if (await view.isVisible().catch(() => false)) {
    const badge = view.locator('.disk-view__badges').filter({ hasText: /backup/i });
    if (await badge.count()) {
      await page.waitForTimeout(300);
      return;
    }
  }
  throw new Error(
    'idea#168 backup_configured_restored: neither restore-panel, Backup success on EmptyDiskPanel, ' +
      'nor Backup badge on DiskView — run make_backup_disk / restore_from_backup first.',
  );
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
