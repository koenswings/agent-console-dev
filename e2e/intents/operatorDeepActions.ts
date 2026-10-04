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
  waitForSidecarStable,
} from './openApp';
import {
  resolveStartInstanceId,
  runStartInstance,
  isInstanceAlreadyRunning,
  listVisibleTreeDiskIds,
} from './operatorActions';
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
 *
 * Prefer A: early walk install_app is followed by make_files on empty-001 — do
 * **not** block for full installApp (minutes); that would turn empty-001 into an
 * app disk and starve EmptyDiskPanel. Late path: start_after_install waits settle.
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
  // Soft: acknowledge pending if it appears quickly; full settle is start_after_install
  const pending = page.locator(sel.installPending);
  await pending.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
};

/**
 * Wait until EmptyDiskPanel install finishes or DiskView appears with instance controls.
 * Prior Intent raced: pending not yet visible → returned in ~3–8s while Install picker stayed open.
 */
export async function waitForInstallAppSettled(
  page: Page,
  timeoutMs = 5 * 60_000,
): Promise<void> {
  const pending = page.locator(sel.installPending);
  const success = page.locator('[data-testid="install-configured-success"]');
  const err = page.locator('[data-testid="install-error"]');
  const timedOut = page.locator('[data-testid="install-timeout"]');
  const instanceControl = page
    .locator(
      '[data-testid^="start-instance-"], [data-testid^="stop-instance-"], [data-testid^="open-instance-"]',
    )
    .first();

  // pending may appear a tick after click — wait briefly for it
  await pending.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await err.isVisible().catch(() => false)) {
      const msg = ((await err.textContent()) ?? '').trim() || 'installApp error';
      throw new Error(`idea#168 install_app: Engine install failed — ${msg}. No soft-pass.`);
    }
    if (await timedOut.isVisible().catch(() => false)) {
      throw new Error(
        'idea#168 install_app: EmptyDiskPanel install timed out (install-timeout). No soft-pass.',
      );
    }
    if (await success.isVisible().catch(() => false)) return;
    // Store caught up → EmptyDiskPanel unmounts (hasInstancesOn) → DiskView controls
    if (!(await page.locator(sel.emptyDiskPanel).isVisible().catch(() => false))) {
      if (await instanceControl.isVisible().catch(() => false)) return;
      // brief blank between panels — keep polling
    }
    // pending gone without success yet — keep polling success / panel swap
    await page.waitForTimeout(400);
  }
  throw new Error(
    'idea#168 install_app: Engine did not finish installApp within budget ' +
      `(${timeoutMs}ms). Still on Install picker or no instance controls. No soft-pass.`,
  );
}

/** Path A Grade5A fixture ids — never treat as "just installed" on empty disk. */
const GRADE5A_INSTANCE_RE = /grade5a/i;

/**
 * Resolve instance id for start_after_install (Prefer A r27).
 * Does NOT default to kolibri-grade5a-001 (that is start_instance Path A).
 * Override: DURATION_START_AFTER_INSTALL_ID. Discovers non-grade5a start-* /
 * stop-* / open-* on overview after leaving Install picker.
 */
export function resolvePostInstallInstanceIdPreference(
  instanceId?: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const override = env.DURATION_START_AFTER_INSTALL_ID?.trim();
  if (override) return override;
  if (instanceId?.trim() && !GRADE5A_INSTANCE_RE.test(instanceId)) {
    return instanceId.trim();
  }
  return undefined;
}

/** Collect visible instance ids from start/stop/open testids. */
async function listVisibleInstanceControlIds(page: Page): Promise<string[]> {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const prefix of ['start-instance-', 'stop-instance-', 'open-instance-'] as const) {
    const all = page.locator(`[data-testid^="${prefix}"]`);
    const n = await all.count();
    for (let i = 0; i < n; i++) {
      const tid = await all.nth(i).getAttribute('data-testid');
      if (!tid) continue;
      const id = tid.slice(prefix.length);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Leave Install picker / EmptyDiskPanel success, open ALL APPS, discover the
 * newly installed (non-grade5a) instance id. Loud-fail if none appear.
 */
export async function resolvePostInstallStartInstanceId(
  page: Page,
  opts: { instanceId?: string; timeoutMs?: number } = {},
): Promise<string> {
  const preferred = resolvePostInstallInstanceIdPreference(opts.instanceId);
  const timeoutMs = opts.timeoutMs ?? 90_000;

  // Late path: Install picker still open after soft install_app — submit if needed, then settle
  const submit = page.locator(sel.installAppSubmit);
  const pending = page.locator(sel.installPending);
  if (await submit.isVisible().catch(() => false)) {
    const disabled = await submit.isDisabled().catch(() => true);
    if (!disabled) {
      // Catalog may already have Kolibri selected (r27 screenshot)
      await submit.click();
    }
  }
  if (
    (await pending.isVisible().catch(() => false)) ||
    (await submit.isVisible().catch(() => false))
  ) {
    await waitForInstallAppSettled(page, Math.max(timeoutMs, 5 * 60_000));
  }

  if (await page.locator('[data-testid="install-configured-success"]').isVisible().catch(() => false)) {
    const back = page.locator('.edp__success button, .edp button:has-text("Back")').first();
    if (await back.count()) await back.click().catch(() => {});
  }

  // Prefer overview ALL APPS so start-* rows are visible even if disk still selected empty
  const allApps = page.locator(sel.networkAllApps);
  if (await allApps.isVisible().catch(() => false)) {
    await allApps.click().catch(() => {});
  }

  const deadline = Date.now() + timeoutMs;
  let lastIds: string[] = [];
  while (Date.now() < deadline) {
    lastIds = await listVisibleInstanceControlIds(page);
    if (preferred && lastIds.includes(preferred)) return preferred;
    const fresh = lastIds.filter((id) => !GRADE5A_INSTANCE_RE.test(id));
    if (fresh.length) {
      // Prefer last non-grade5a (most recently installed tends to appear later in tree)
      return fresh[fresh.length - 1]!;
    }
    await page.waitForTimeout(400);
  }

  throw new Error(
    `idea#168 start_after_install: no newly-installed (non-grade5a) instance controls after install. ` +
      `preferred=${preferred ?? '(discover)'}, visible ids=[${lastIds.join(', ')}]. ` +
      `Leave Install picker; target empty-002 install uuid — not kolibri-grade5a-001. ` +
      `Set DURATION_START_AFTER_INSTALL_ID if known. No soft-pass.`,
  );
}

/**
 * Start after install — Prefer A r27: target newly installed instance on empty disk,
 * NOT Path A kolibri-grade5a-001. Scoped: start_instance keeps grade5a behavior.
 */
export const start_after_install: IntentFn = async ({ page, instanceId }) => {
  await ensureOpLayout(page);
  const id = await resolvePostInstallStartInstanceId(page, { instanceId });
  // Pass explicit id; do not let DURATION_START_INSTANCE_ID remap to grade5a.
  // resolveStartInstanceId still honors DURATION_START_INSTANCE_ID — clear path:
  // only DURATION_START_AFTER_INSTALL_ID should pin post-install (already applied).
  const envPin = process.env.DURATION_START_INSTANCE_ID;
  const afterPin = process.env.DURATION_START_AFTER_INSTALL_ID?.trim();
  if (envPin && !afterPin && GRADE5A_INSTANCE_RE.test(envPin)) {
    // Temporarily ignore grade5a Path A pin for this Intent only
    const prev = process.env.DURATION_START_INSTANCE_ID;
    delete process.env.DURATION_START_INSTANCE_ID;
    try {
      await runStartInstance(page, id);
    } finally {
      if (prev !== undefined) process.env.DURATION_START_INSTANCE_ID = prev;
    }
    return;
  }
  await runStartInstance(page, id);
};

/**
 * Stay on disk — Prefer A: DiskView / EmptyDiskPanel for diskId (env DURATION_DISK_ID).
 * Loud-fail if preferred disk missing from tree (list visibles).
 */
export const stay_on_disk: IntentFn = async ({ page, diskId }) => {
  await ensureOpLayout(page);
  const preferred =
    process.env.DURATION_DISK_ID?.trim() ||
    diskId ||
    DURATION_FIXTURES.kolibri.diskId;
  let id = preferred;
  if (!(await page.locator(sel.disk(id)).count())) {
    const visible = await listVisibleTreeDiskIds(page);
    if (visible.length === 1) id = visible[0]!;
    else {
      const grade = visible.find((d) => /grade5a|duration-/i.test(d));
      if (grade) id = grade;
      else {
        throw new Error(
          `idea#168 stay_on_disk: disk-${preferred} not on NetworkTree. ` +
            `visible=[${visible.join(', ')}]. Set DURATION_DISK_ID. Prefer A.`,
        );
      }
    }
  }
  const view = page.locator(sel.diskView(id));
  const empty = page.locator(sel.emptyDiskPanel);
  const visiblePanel = view.or(empty).first();
  if (!(await visiblePanel.isVisible().catch(() => false))) {
    const row = page.locator(sel.disk(id));
    await row.waitFor({ state: 'visible', timeout: 15_000 });
    await row.click();
  }
  try {
    await visiblePanel.waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    throw new Error(
      `idea#168 stay_on_disk: disk-${id} clicked but DiskView / EmptyDiskPanel not visible. Prefer A.`,
    );
  }
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

/** Budget to get Backup enabled after ensuring Running (DURATION_BACKUP_SETTLE_MS). */
export function backupSettleTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DURATION_BACKUP_SETTLE_MS?.trim();
  if (raw && /^\d+$/.test(raw)) return Math.max(5_000, Number(raw));
  return Math.max(sidecarReadyTimeoutMs(env), 90_000);
}

/**
 * Backup instance — requires linked Backup Disk; product enables Backup only when Running.
 * Prefer A r23: stop→backup left Backup disabled — start if Stopped, wait enable, loud-fail.
 * Do NOT change product isBackupDisabled (Stopped stays disabled).
 */
export const backup_instance: IntentFn = async ({ page, instanceId }) => {
  await ensureOpLayout(page);
  const allApps = page.locator(sel.networkAllApps);
  if (await allApps.isVisible().catch(() => false)) {
    await allApps.click().catch(() => {});
  }

  const preferred = resolveStartInstanceId(instanceId);
  let id = preferred;
  try {
    id = await runStartInstance(page, preferred);
  } catch (err) {
    // Start controls may be missing briefly — fall through to Backup checks with preferred id
    const msg = err instanceof Error ? err.message : String(err);
    if (!/start-instance-.* not found/i.test(msg)) {
      throw new Error(
        `idea#168 backup_instance: failed to ensure Running for ${preferred} — ${msg} ` +
          `r23: Backup requires Running (isBackupDisabled). No soft-pass.`,
      );
    }
  }

  const row = page.locator(sel.instance(id));
  if (!(await row.isVisible().catch(() => false))) {
    await row.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  }
  if (!(await row.isVisible().catch(() => false))) {
    throw new Error(
      `idea#168 backup_instance: instance row ${id} not visible on overview/ALL APPS. No soft-pass.`,
    );
  }
  await row.click().catch(() => {});

  const btn = page.locator(sel.backupInstance(id));
  if (!(await btn.count())) {
    throw new Error(
      `idea#168 backup_instance: backup-instance-${id} not in Console UI — ` +
        `InstanceRow only shows Back up when a Backup Disk is linked to this instance ` +
        `(hasBackupDisks). Dock/configure a Backup Disk first, or graph should not sample this edge.`,
    );
  }
  await btn.waitFor({ state: 'visible', timeout: 10_000 });

  const budget = backupSettleTimeoutMs();
  const deadline = Date.now() + budget;

  // Product: Backup enabled only when Running — start if Stopped / disabled
  if (
    (await btn.isDisabled().catch(() => true)) ||
    !(await isInstanceAlreadyRunning(page, id))
  ) {
    try {
      id = await runStartInstance(page, id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `idea#168 backup_instance: could not start ${id} before Backup — ${msg} ` +
          `r23: stop-before-backup leaves Backup disabled (needs Running). No soft-pass.`,
      );
    }
  }

  while (Date.now() < deadline) {
    const disabled = await btn.isDisabled().catch(() => true);
    if (!disabled) break;
    const title = ((await btn.getAttribute('title')) ?? '').trim();
    const running = await isInstanceAlreadyRunning(page, id);
    // Locked / Starting — wait; if Stopped again, re-start once
    if (!running && Date.now() < deadline - 5_000) {
      await runStartInstance(page, id).catch(() => {});
    }
    await page.waitForTimeout(500);
    void title;
  }

  if (await btn.isDisabled().catch(() => true)) {
    const title = ((await btn.getAttribute('title')) ?? '').trim();
    const running = await isInstanceAlreadyRunning(page, id);
    const reason = !running
      ? 'instance not Running (product disables Backup unless Running — do not Backup after stop)'
      : title.includes('Operation in progress') || /progress|lock/i.test(title)
        ? `locked/op in progress (title="${title}")`
        : `still disabled (title="${title || 'none'}" — locked or Backup Disk link issue)`;
    throw new Error(
      `idea#168 backup_instance: backup-instance-${id} ${reason} after ${budget}ms. ` +
        `r23: walk must backup-before-stop, or Intent starts then waits for Backup enable. No soft-pass.`,
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
 * Notice USB dock — Prefer A: NetworkTree must show ≥1 disk row after dock.
 * Hardware dock is Engine/fleet-owned; Console settles when disk-* appears.
 * Loud-fail if tree empty (no soft 500ms dwell).
 */
export const notice_usb_dock: IntentFn = async ({ page }) => {
  await ensureOpLayout(page);
  if (await page.locator(sel.settingsPanel).isVisible().catch(() => false)) {
    await page.locator(sel.settingsBtn).click().catch(() => {});
  }
  if (await page.locator(sel.opEntry).isVisible().catch(() => false)) {
    await page.locator(sel.accountBtn).click().catch(() => {});
  }
  await page.locator(sel.networkTree).waitFor({ state: 'visible', timeout: 15_000 });
  const deadline = Date.now() + 20_000;
  let disks: string[] = [];
  while (Date.now() < deadline) {
    disks = await listVisibleTreeDiskIds(page);
    if (disks.length > 0) break;
    await page.waitForTimeout(400);
  }
  if (disks.length === 0) {
    throw new Error(
      'idea#168 notice_usb_dock: NetworkTree visible but no [data-testid^="disk-"] rows after 20s. ' +
        'Dock a USB / fixture disk on Engine first (Prefer A — no soft dwell).',
    );
  }
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

/** Min wall-clock after Confirm before settle may return (r22: unlock ~3.4s raced SIGTERM). */
export function restoreMinDwellMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DURATION_RESTORE_MIN_DWELL_MS?.trim();
  if (raw && /^\d+$/.test(raw)) return Math.max(0, Number(raw));
  return 10_000;
}

/**
 * After Confirm Restore: wait unlock + min dwell, overview, Running+stable sidecar.
 * Prefer A r21/r22: async SIGTERM after unlock — do not return in ~3s.
 */
export async function settleAfterRestoreConfirm(
  page: Page,
  linkedId: string,
): Promise<void> {
  const confirmedAt = Date.now();
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
      break;
    }
    await page.waitForTimeout(400);
  }
  if (sawProgress && Date.now() >= deadline) {
    throw new Error(
      `idea#168 restore_from_backup: restore still "Operation in progress" after ${budget}ms ` +
        `(instance=${linkedId}). Docker/store did not settle. No soft-pass.`,
    );
  }

  // Min dwell — unlock alone is not enough (r22 ~3.4s before delayed SIGTERM)
  const minDwell = restoreMinDwellMs();
  const elapsed = Date.now() - confirmedAt;
  if (elapsed < minDwell) {
    await page.waitForTimeout(minDwell - elapsed);
  }

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

  const kind = appKindForInstance(linkedId);
  const remaining = () => Math.max(5_000, deadline - Date.now());
  try {
    await ensureInstanceRunningForOpen(page, linkedId, kind);
    await waitForSidecarStable(page, kind, {
      consecutive: 3,
      intervalMs: 1_500,
      budgetMs: remaining(),
    });
    // If docker dies mid-stability window, one more force cycle within budget
  } catch (err) {
    if (Date.now() >= deadline) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `idea#168 restore_from_backup: post-Confirm settle failed for ${linkedId} — ${msg} ` +
          `r22: async SIGTERM after unlock; need min dwell + stable sidecar before move_app. ` +
          `No soft-pass / no demo remap.`,
      );
    }
    try {
      await ensureInstanceRunningForOpen(page, linkedId, kind);
      await waitForSidecarStable(page, kind, {
        consecutive: 3,
        intervalMs: 1_500,
        budgetMs: remaining(),
      });
    } catch (err2) {
      const msg = err2 instanceof Error ? err2.message : String(err2);
      throw new Error(
        `idea#168 restore_from_backup: post-Confirm settle failed for ${linkedId} — ${msg} ` +
          `r22: async SIGTERM after unlock; need min dwell + stable sidecar before move_app. ` +
          `No soft-pass / no demo remap.`,
      );
    }
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

/**
 * Open copied instance — Prefer A: ALL APPS → instance row + start/stop/open controls.
 * Id: DURATION_COPY_INSTANCE_ID → ctx.instanceId → loud-fail (no silent Grade5A remap
 * when walk just copied a different id).
 */
export const open_copied_instance: IntentFn = async ({ page, instanceId }) => {
  await ensureOpLayout(page);
  if (await page.locator(sel.settingsPanel).isVisible().catch(() => false)) {
    await page.locator(sel.settingsBtn).click().catch(() => {});
  }
  const allApps = page.locator(sel.networkAllApps);
  if (await allApps.isVisible().catch(() => false)) {
    await allApps.click();
  }
  const id =
    process.env.DURATION_COPY_INSTANCE_ID?.trim() ||
    instanceId ||
    '';
  if (!id) {
    throw new Error(
      'idea#168 open_copied_instance: no instanceId — set DURATION_COPY_INSTANCE_ID after copy_app ' +
        '(Prefer A; do not assume Grade5A source).',
    );
  }
  const row = page.locator(sel.instance(id));
  if (!(await row.count())) {
    const rows = page.locator(`${sel.networkTree} [data-testid^="instance-"], [data-testid^="instance-"]`);
    const n = await rows.count();
    const visible: string[] = [];
    for (let i = 0; i < Math.min(n, 20); i++) {
      const tid = await rows.nth(i).getAttribute('data-testid');
      if (tid) visible.push(tid.replace(/^instance-/, ''));
    }
    throw new Error(
      `idea#168 open_copied_instance: [data-testid="instance-${id}"] not found. ` +
        `visible=[${visible.join(', ')}]. Set DURATION_COPY_INSTANCE_ID to the copy id.`,
    );
  }
  await row.waitFor({ state: 'visible', timeout: 15_000 });
  await row.click();
  try {
    await page
      .locator(sel.startInstance(id))
      .or(page.locator(sel.stopInstance(id)))
      .or(page.locator(sel.openInstance(id)))
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    throw new Error(
      `idea#168 open_copied_instance: instance-${id} focused but no start/stop/open controls. ` +
        'Prefer A — copy may still be settling.',
    );
  }
};

/**
 * Prefer A r39/r43: wait while ConnectionManagement "Scanning for engines…"
 * (discovery probes ~5s+; r39 FAIL@98 aborted in 424ms).
 */
export function switchEngineScanTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DURATION_SWITCH_ENGINE_SCAN_MS?.trim();
  if (raw && /^\d+$/.test(raw)) return Math.max(5_000, Number(raw));
  return 45_000;
}

/**
 * Prefer A r43: budget for Connect attempt(s) + hostname retry after IP fail.
 */
export function switchEngineConnectTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DURATION_SWITCH_ENGINE_CONNECT_MS?.trim();
  if (raw && /^\d+$/.test(raw)) return Math.max(10_000, Number(raw));
  return 60_000;
}

const normalizeSwitchHost = (h: string): string =>
  h.trim().replace(/^https?:\/\//i, '').replace(/:\d+$/, '').replace(/\.local$/i, '');

export const isIpv4SwitchHost = (h: string): boolean =>
  /^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalizeSwitchHost(h));

const discoveredConnectBtns = (page: import('@playwright/test').Page) =>
  page.locator(
    '[data-testid^="connect-engine-"]:not([data-testid="connect-engine-manual"])',
  );

async function describeSwitchEngineUi(
  page: import('@playwright/test').Page,
): Promise<string> {
  const label = (
    (await page.locator(sel.connectionScanLabel).textContent().catch(() => null)) ??
    (await page.locator('.onboarding__scan-label').textContent().catch(() => null)) ??
    ''
  ).trim();
  const n = await discoveredConnectBtns(page).count();
  const manualOpen = await page.locator(sel.connectionManualHost).isVisible().catch(() => false);
  const err = (
    (await page.locator('.onboarding__manual-error').textContent().catch(() => null)) ?? ''
  ).trim();
  return `scanLabel="${label}" connectButtons=${n} manualOpen=${manualOpen} err="${err.slice(0, 80)}"`;
}

/** True when status-bar label is the same Engine host (strips .local / scheme). */
export function switchHostsMatch(statusLabel: string, host: string): boolean {
  const raw = statusLabel.trim();
  if (!raw || /connecting|searching|demo|offline|disconnected/i.test(raw)) return false;
  const s = normalizeSwitchHost(raw).toLowerCase();
  const h = normalizeSwitchHost(host).toLowerCase();
  if (!s || !h) return false;
  if (s === h) return true;
  // status label may be "idea01" while host is "idea01.local" (normalize already strips)
  return s.split(/\s+/)[0] === h;
}

async function readConnectedStatusHostname(
  page: import('@playwright/test').Page,
): Promise<string> {
  const statusText = (
    (await page.locator(sel.statusBarHostname).textContent().catch(() => null)) ??
    (await page.locator(`${sel.statusBarIndicator} span`).last().textContent().catch(() => null)) ??
    ''
  )
    .replace(/\s+/g, ' ')
    .trim();
  if (!statusText || /connecting|searching|demo|offline|disconnected/i.test(statusText)) {
    return '';
  }
  const m = statusText.match(
    /\b(idea\d+|appdocker\d+|engine\d+|\d{1,3}(?:\.\d{1,3}){3})\b/i,
  );
  if (m) return normalizeSwitchHost(m[1]!);
  return normalizeSwitchHost(statusText.split(/\s+/)[0] ?? '');
}

async function dismissConnectionManagement(
  page: import('@playwright/test').Page,
): Promise<void> {
  if (!(await page.locator(sel.connectionManagement).isVisible().catch(() => false))) return;
  const btn = page.locator(sel.connectionMgmtBtn);
  if (await btn.count()) await btn.click().catch(() => {});
  else await page.locator('.status-bar__connection-btn').click().catch(() => {});
  try {
    await page.locator(sel.connectionManagement).waitFor({ state: 'hidden', timeout: 10_000 });
  } catch {
    throw new Error(
      'idea#168 switch_engine: already on target host but connection-management stayed open after dismiss.',
    );
  }
}

/** Prefer hostname labels over bare IPv4 (r43: Tailscale IP Connect failed). */
export function orderSwitchEngineHosts(hosts: string[]): string[] {
  const norm = hosts.map(normalizeSwitchHost).filter(Boolean);
  const uniq: string[] = [];
  for (const h of norm) {
    if (!uniq.includes(h)) uniq.push(h);
  }
  const names = uniq.filter((h) => !isIpv4SwitchHost(h));
  const ips = uniq.filter((h) => isIpv4SwitchHost(h));
  return [...names, ...ips];
}

/**
 * Host candidates — Prefer A r43: env → idea01-ish → status-bar hostname → IP last.
 * Never prefer bare Tailscale/IPv4 when idea01 (or env hostname) is available.
 */
export async function resolveSwitchEngineHostCandidates(
  page: import('@playwright/test').Page,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  const out: string[] = [];
  const push = (h: string) => {
    const n = normalizeSwitchHost(h);
    if (n && !out.includes(n)) out.push(n);
  };

  const fromEnv =
    env.DURATION_SWITCH_ENGINE_HOST?.trim() ||
    env.DURATION_ENGINE_HOST?.trim() ||
    '';
  if (fromEnv) {
    push(fromEnv);
    // Env IP still gets idea01 as Prefer A retry peer
    if (isIpv4SwitchHost(fromEnv)) push('idea01');
  }

  // Prefer A default hostname when env unset (status bar often shows Tailscale IP only)
  push('idea01');

  const statusText = (
    (await page.locator(sel.statusBarHostname).textContent().catch(() => null)) ??
    (await page.locator(`${sel.statusBarIndicator} span`).last().textContent().catch(() => null)) ??
    ''
  ).trim();
  if (statusText && !/connecting|searching|demo|offline|disconnected/i.test(statusText)) {
    const hostM = statusText.match(/\b(idea\d+|appdocker\d+|engine\d+)\b/i);
    if (hostM) push(hostM[1]!);
    const ipM = statusText.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
    if (ipM) push(ipM[1]!);
  }

  push('idea03');
  push('idea04');
  push('appdocker01');

  return orderSwitchEngineHosts(out);
}

/** Primary host = first ordered candidate (hostname before IP). */
export async function resolveSwitchEngineHost(
  page: import('@playwright/test').Page,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const cands = await resolveSwitchEngineHostCandidates(page, env);
  return cands[0] ?? '';
}

async function waitForEngineDiscoverySettle(
  page: import('@playwright/test').Page,
  budgetMs: number,
): Promise<'found' | 'empty' | 'timeout'> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (await discoveredConnectBtns(page).count()) return 'found';
    const label = (
      (await page.locator(sel.connectionScanLabel).textContent().catch(() => null)) ??
      (await page.locator('.onboarding__scan-label').textContent().catch(() => null)) ??
      ''
    ).trim();
    if (/no engine found/i.test(label)) return 'empty';
    await page.waitForTimeout(400);
  }
  if (await discoveredConnectBtns(page).count()) return 'found';
  const label = (
    (await page.locator(sel.connectionScanLabel).textContent().catch(() => null)) ?? ''
  ).trim();
  if (/no engine found/i.test(label)) return 'empty';
  return 'timeout';
}

async function clickDiscoveredEngine(
  page: import('@playwright/test').Page,
  target: string,
): Promise<boolean> {
  if (target) {
    // Prefer exact hostname Connect — never click IP row when hostname target exists
    if (!isIpv4SwitchHost(target)) {
      const btn = page.locator(sel.connectEngine(target));
      if (await btn.count()) {
        await btn.click();
        return true;
      }
      const row = page
        .locator('.engine-picker__item')
        .filter({ hasText: new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
      if (await row.count()) {
        await row.locator('button').filter({ hasText: /connect/i }).first().click();
        return true;
      }
      return false;
    }
    // Target is IP: Prefer A — click idea01-ish hostname Connect if listed, else IP row
    for (const name of ['idea01', 'idea03', 'idea04', 'appdocker01']) {
      const btn = page.locator(sel.connectEngine(name));
      if (await btn.count()) {
        await btn.click();
        return true;
      }
    }
    const btn = page.locator(sel.connectEngine(target));
    if (await btn.count()) {
      await btn.click();
      return true;
    }
    const row = page
      .locator('.engine-picker__item')
      .filter({ hasText: new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
    if (await row.count()) {
      await row.locator('button').filter({ hasText: /connect/i }).first().click();
      return true;
    }
    return false;
  }
  for (const name of ['idea01', 'idea03', 'idea04', 'appdocker01']) {
    const btn = page.locator(sel.connectEngine(name));
    if (await btn.count()) {
      await btn.click();
      return true;
    }
  }
  // Avoid bare-IP Connect buttons when any hostname Connect exists
  const all = discoveredConnectBtns(page);
  const n = await all.count();
  for (let i = 0; i < n; i++) {
    const tid = (await all.nth(i).getAttribute('data-testid')) ?? '';
    const host = tid.replace(/^connect-engine-/, '');
    if (host && !isIpv4SwitchHost(host)) {
      await all.nth(i).click();
      return true;
    }
  }
  if (n > 0) {
    await all.first().click();
    return true;
  }
  return false;
}

async function waitForConnectSuccess(
  page: import('@playwright/test').Page,
  budgetMs: number,
): Promise<'ok' | 'error' | 'timeout'> {
  const err = page.locator('.onboarding__manual-error');
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (await err.isVisible().catch(() => false)) {
      const msg = ((await err.textContent()) ?? '').trim();
      if (/could not reach|unreachable|check the hostname/i.test(msg)) return 'error';
    }
    if (!(await page.locator(sel.connectionManagement).isVisible().catch(() => false))) {
      return 'ok';
    }
    // Connected status on bar while CM still closing
    const status = (
      (await page.locator(sel.statusBarHostname).textContent().catch(() => null)) ?? ''
    ).trim();
    if (status && !/connecting|searching/i.test(status)) {
      // CM may linger briefly
      if (!(await page.locator(sel.connectionManagement).isVisible().catch(() => false))) {
        return 'ok';
      }
    }
    await page.waitForTimeout(400);
  }
  if (await err.isVisible().catch(() => false)) return 'error';
  if (!(await page.locator(sel.connectionManagement).isVisible().catch(() => false))) {
    return 'ok';
  }
  return 'timeout';
}

async function dismissManualError(
  page: import('@playwright/test').Page,
): Promise<void> {
  const cancel = page.locator('.onboarding__manual-cancel');
  if (await cancel.isVisible().catch(() => false)) {
    await cancel.click().catch(() => {});
  }
  // Clear sticky error by toggling manual closed
  await page.waitForTimeout(200);
}

/**
 * Manual Connect for one host. Returns ok/error/timeout — does not throw on reachability.
 */
async function tryManualConnectHost(
  page: import('@playwright/test').Page,
  host: string,
  attemptBudgetMs: number,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await page.locator(sel.connectionManualHost).isVisible().catch(() => false))) {
    const link = page.locator(sel.connectionManualLink);
    if (!(await link.count())) {
      return { ok: false, error: 'connection-manual-link missing' };
    }
    await link.click();
  }
  const input = page.locator(sel.connectionManualHost);
  try {
    await input.waitFor({ state: 'visible', timeout: 5_000 });
  } catch {
    return { ok: false, error: 'manual host input not visible' };
  }
  await input.fill(host);
  const manualBtn = page.locator(sel.connectEngineManual);
  await manualBtn.waitFor({ state: 'visible', timeout: 5_000 });
  if (await manualBtn.isDisabled().catch(() => false)) {
    return { ok: false, error: `connect-engine-manual disabled for "${host}"` };
  }
  await manualBtn.click();
  const result = await waitForConnectSuccess(page, attemptBudgetMs);
  if (result === 'ok') return { ok: true };
  const errText = (
    (await page.locator('.onboarding__manual-error').textContent().catch(() => null)) ??
    'Could not reach engine'
  ).trim();
  await dismissManualError(page);
  return { ok: false, error: errText };
}

/**
 * Prefer A r43: try hosts in hostname-first order; on "Could not reach" retry next.
 */
async function connectEngineWithRetries(
  page: import('@playwright/test').Page,
  candidates: string[],
): Promise<void> {
  const ordered = orderSwitchEngineHosts(candidates);
  if (ordered.length === 0) {
    throw new Error(
      'idea#168 switch_engine: no host candidates. Set DURATION_SWITCH_ENGINE_HOST=idea01. Prefer A.',
    );
  }
  const budget = switchEngineConnectTimeoutMs();
  const started = Date.now();
  const tried: string[] = [];
  let lastError = '';

  for (const host of ordered) {
    const remaining = budget - (Date.now() - started);
    if (remaining < 5_000) break;
    tried.push(host);

    // Discovered Connect button first
    if (await clickDiscoveredEngine(page, host)) {
      const settle = await waitForConnectSuccess(page, Math.min(remaining, 30_000));
      if (settle === 'ok') return;
      if (settle === 'error') {
        lastError = (
          (await page.locator('.onboarding__manual-error').textContent().catch(() => null)) ??
          'connect error after discovered click'
        ).trim();
        await dismissManualError(page);
        continue;
      }
      // timeout with CM still open — try manual same host
    }

    const attempt = await tryManualConnectHost(
      page,
      host,
      Math.min(remaining, 25_000),
    );
    if (attempt.ok) return;
    lastError = attempt.error ?? 'unknown';
    // Brief re-scan window before next host (discovery may populate idea01)
    await waitForEngineDiscoverySettle(page, Math.min(8_000, budget - (Date.now() - started)));
  }

  throw new Error(
    `idea#168 switch_engine: Connect failed after retries. tried=[${tried.join(', ')}] ` +
      `lastError="${lastError}" ${await describeSwitchEngineUi(page)}. ` +
      `r43: prefer idea01 hostname over Tailscale IP; set DURATION_SWITCH_ENGINE_HOST=idea01. ` +
      `DURATION_SWITCH_ENGINE_CONNECT_MS=${budget}. Prefer A — no soft-pass.`,
  );
}

/**
 * Switch Engine — Prefer A r44: if status-bar hostname already matches
 * DURATION_SWITCH_ENGINE_HOST, PASS after ConnectionManagement opens
 * (discovery "No engine found" is N/A — do not manual-Connect retry).
 * Connect path only when status hostname ≠ HOST.
 */
export const switch_engine: IntentFn = async ({ page }) => {
  if (!(await page.locator(sel.settingsPanel).isVisible().catch(() => false))) {
    await page.locator(sel.settingsBtn).click();
  }
  await page.locator(sel.settingsPanel).waitFor({ state: 'visible', timeout: 10_000 });
  const tab = page.locator(sel.settingsTabEngine);
  if (await tab.count()) await tab.click();
  await page.locator(sel.settingsEngineStatus).waitFor({ state: 'visible', timeout: 5_000 });

  const candidates = await resolveSwitchEngineHostCandidates(page);

  const changeBtn = page.locator(sel.switchEngineConnect);
  if (!(await changeBtn.count())) {
    throw new Error(
      'idea#168 switch_engine: [data-testid="switch-engine-connect"] missing on Engine Connection tab. ' +
        'Settings must expose Change Engine… → ConnectionManagement (Prefer A).',
    );
  }
  const hostEnv = (
    process.env.DURATION_SWITCH_ENGINE_HOST?.trim() ||
    process.env.DURATION_ENGINE_HOST?.trim() ||
    ''
  );
  const statusBefore = await readConnectedStatusHostname(page);

  await changeBtn.click();
  try {
    await page.locator(sel.connectionManagement).waitFor({ state: 'visible', timeout: 15_000 });
  } catch {
    throw new Error(
      'idea#168 switch_engine: clicked Change Engine… but [data-testid="connection-management"] did not open.',
    );
  }

  // Prefer A r44: already connected to HOST — discovery empty must not burn Connect retries
  const statusNow = (await readConnectedStatusHostname(page)) || statusBefore;
  if (hostEnv && switchHostsMatch(statusNow, hostEnv)) {
    await dismissConnectionManagement(page);
    const after = await readConnectedStatusHostname(page);
    if (!switchHostsMatch(after || statusNow, hostEnv)) {
      throw new Error(
        `idea#168 switch_engine: status was ${JSON.stringify(statusNow)} matching HOST=${hostEnv} ` +
          `but after dismiss status=${JSON.stringify(after)}. Prefer A loud-fail.`,
      );
    }
    return;
  }

  const scanBudget = switchEngineScanTimeoutMs();
  const settle = await waitForEngineDiscoverySettle(page, scanBudget);

  // Scan finished "No engine found" but status still matches HOST (race / late read)
  const statusAfterScan = await readConnectedStatusHostname(page);
  if (hostEnv && switchHostsMatch(statusAfterScan, hostEnv)) {
    await dismissConnectionManagement(page);
    return;
  }
  if (settle === 'empty' && hostEnv && !switchHostsMatch(statusAfterScan, hostEnv)) {
    // fall through to Connect — status ≠ HOST
  }

  // Merge any discovered hostname Connect labels into candidates (hostname before IP)
  const btns = discoveredConnectBtns(page);
  const bn = await btns.count();
  for (let i = 0; i < bn; i++) {
    const tid = (await btns.nth(i).getAttribute('data-testid')) ?? '';
    const host = tid.replace(/^connect-engine-/, '');
    if (host) candidates.push(host);
  }

  await connectEngineWithRetries(page, candidates);
};

/**
 * Reboot Engine — Prefer A: NetworkTree reboot-engine-* + native confirm dialog accept.
 * Loud-fail if dialog never fires; assert engine row survives click (command dispatched).
 */
export const reboot_engine: IntentFn = async ({ page, engineId }) => {
  await ensureOpLayout(page);
  if (await page.locator(sel.settingsPanel).isVisible().catch(() => false)) {
    await page.locator(sel.settingsBtn).click().catch(() => {});
  }
  const btn = engineId
    ? page.locator(sel.rebootEngine(engineId))
    : page.locator('[data-testid^="reboot-engine-"]').first();
  if (!(await btn.count())) {
    throw new Error(
      'idea#168 reboot_engine: no reboot-engine-* button in NetworkTree (operator layout required).',
    );
  }
  let dialogSeen = false;
  try {
    const [dialog] = await Promise.all([
      page.waitForEvent('dialog', { timeout: 8_000 }),
      btn.click(),
    ]);
    dialogSeen = true;
    await dialog.accept();
  } catch (e) {
    if (!dialogSeen) {
      throw new Error(
        'idea#168 reboot_engine: clicked reboot but confirm dialog did not appear within 8s. ' +
          `Prefer A — ${(e as Error).message}`,
      );
    }
    throw e;
  }
  // Engine row / reboot control should remain (reboot is async on Engine)
  try {
    await btn.waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    throw new Error(
      'idea#168 reboot_engine: reboot control disappeared after confirm — NetworkTree lost engine row.',
    );
  }
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
  if (await page.locator(sel.connectionManagement).isVisible().catch(() => false)) {
    const cmBtn = page.locator(sel.connectionMgmtBtn);
    if (await cmBtn.count()) await cmBtn.click().catch(() => {});
    else await page.locator('.status-bar__connection-btn').click().catch(() => {});
  }
  if (await page.locator(sel.opEntry).isVisible().catch(() => false)) {
    await page.locator(sel.accountBtn).click().catch(() => {});
  }
  if (await page.locator(sel.settingsPanel).isVisible().catch(() => false)) {
    await page.locator(sel.settingsBtn).click().catch(() => {});
  }
  const overview = page.locator(sel.consoleOverview);
  const op = page.locator(sel.opOverview);
  try {
    await overview.or(op).first().waitFor({ state: 'visible', timeout: 15_000 });
  } catch {
    throw new Error(
      'idea#168 leave_*: Console overview not visible after closing app tabs / overlays. ' +
        'Expected [data-testid="console-overview"] or [data-testid="op-overview"]. Prefer A loud-fail.',
    );
  }
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
