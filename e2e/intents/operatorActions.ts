/**
 * Operator Intents (idea#166/#168): real Console click sequences for eject /
 * erase / start-stop / account / settings / Files Disk edges.
 *
 * ACTIONS.md: eject_disk, stay_on_overview (dwell in stayOnOverview.ts).
 * Proposal snake_case for remaining operator edges.
 */
import type { Page } from '@playwright/test';
import type { IntentFn } from './types';
import { sel } from './selectors';
import { DURATION_FIXTURES } from './fixtures';
import { performOperatorSignIn } from './signInReady';
import { ensureEmptyDiskPanel } from './emptyDisk';

/**
 * Preference only (env → ctx → kolibri fixture). Prefer A post-erase walks must
 * still verify the disk is on the tree — see pickEjectDiskIdOnTree.
 */
export function resolveEjectDiskId(
  diskId?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.DURATION_EJECT_DISK_ID?.trim() ||
    diskId ||
    DURATION_FIXTURES.kolibri.diskId
  );
}

const SYSTEMISH = /system/i;

/** Visible NetworkTree disk ids (strip disk- prefix). */
export async function listVisibleTreeDiskIds(page: Page): Promise<string[]> {
  const rows = page.locator(`${sel.networkTree} [data-testid^="disk-"]`);
  const n = await rows.count();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const testId = await rows.nth(i).getAttribute('data-testid');
    if (testId) ids.push(testId.replace(/^disk-/, ''));
  }
  return ids;
}

/**
 * Pick a docked ejectable disk after erase/redistribute.
 * Never soft-assume kolibri when it was erased and gone from the tree.
 */
export async function pickEjectDiskIdOnTree(
  page: Page,
  preferred?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const visible = await listVisibleTreeDiskIds(page);
  const candidates = [
    env.DURATION_EJECT_DISK_ID?.trim(),
    preferred,
    DURATION_FIXTURES.nextcloud.diskId,
    DURATION_FIXTURES.backup.diskId,
    DURATION_FIXTURES.empty.diskId,
    DURATION_FIXTURES.kolibri.diskId,
  ].filter((x): x is string => !!x);

  for (const id of candidates) {
    if (!visible.includes(id)) continue;
    const ejectBtn = page.locator(sel.eject(id));
    if (await ejectBtn.count()) return id;
  }

  // First non-system row that has an eject button
  for (const id of visible) {
    const row = page.locator(sel.disk(id));
    const label = ((await row.textContent()) ?? '').trim();
    if (SYSTEMISH.test(label) && !label.toLowerCase().includes('duration')) continue;
    if (id.toLowerCase().includes('system')) continue;
    if (await page.locator(sel.eject(id)).count()) return id;
  }

  throw new Error(
    `idea#168 eject_disk: no ejectable disk on NetworkTree ` +
      `(preferred=${preferred ?? 'none'}, visible=[${visible.join(', ')}]). ` +
      `After erase, kolibri may be gone — set DURATION_EJECT_DISK_ID to a surviving disk ` +
      `(e.g. duration-nextcloud-grade5a-001) or dock another ejectable disk. No soft-pass.`,
  );
}

/**
 * Click eject-<diskId> → wait for eject-confirm (ACTIONS.md `eject_disk`).
 *
 * Hardened for post-copy / post-erase: pick surviving docked disk when preferred
 * (kolibri) was erased. Loud-fail with visible ids — never silent skip.
 */
export const eject_disk: IntentFn = async ({ page, diskId }) => {
  await page
    .locator(sel.opOverview)
    .or(page.locator(sel.networkTree))
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });

  // Close overlays that hide the tree (account/settings)
  if (await page.locator(sel.opEntry).isVisible().catch(() => false)) {
    await page.locator(sel.accountBtn).click().catch(() => {});
  }
  if (await page.locator(sel.settingsPanel).isVisible().catch(() => false)) {
    await page.locator(sel.settingsBtn).click().catch(() => {});
  }

  // ALL APPS after redistribute is fine — eject lives on NetworkTree disk rows.
  const allApps = page.locator(sel.networkAllApps);
  if (await allApps.isVisible().catch(() => false)) {
    await allApps.click().catch(() => {});
  }
  await page.locator(sel.networkTree).waitFor({ state: 'visible', timeout: 10_000 });

  const preferred = resolveEjectDiskId(diskId);
  const id = await pickEjectDiskIdOnTree(page, preferred);

  const btn = page.locator(sel.eject(id));
  if (!(await btn.count())) {
    const visible = await listVisibleTreeDiskIds(page);
    throw new Error(
      `idea#168 eject_disk: [data-testid="eject-${id}"] missing — canEject false ` +
        `(system/backup-only disk, or undocked). visible=[${visible.join(', ')}].`,
    );
  }

  // After copy_app, isDiskLocked may disable eject until op settles
  try {
    await btn.waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForFunction(
      (selStr) => {
        const el = document.querySelector(selStr) as HTMLButtonElement | null;
        return !!el && !el.disabled;
      },
      sel.eject(id),
      { timeout: 30_000 },
    );
  } catch {
    const disabled = await btn.isDisabled().catch(() => true);
    throw new Error(
      `idea#168 eject_disk: eject-${id} visible but still disabled after 30s ` +
        `(isDiskLocked — copy/move still running?). disabled=${disabled}. ` +
        `Wait for redistribute ops to settle before eject_disk.`,
    );
  }

  await btn.click();

  try {
    await page.locator(sel.ejectConfirm).waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    throw new Error(
      `idea#168 eject_disk: clicked eject-${id} but [data-testid="eject-confirm"] did not open. ` +
        `Console must always show EjectConfirm (including pure Apps disks). ` +
        `If still on ALL APPS only, NetworkTree row may have missed the click.`,
    );
  }
};

export const confirm_eject: IntentFn = async ({ page }) => {
  await page.locator(sel.ejectConfirm).waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator(sel.ejectConfirmOk).click();
  await page.locator(sel.ejectConfirm).waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
};

export const cancel_eject: IntentFn = async ({ page }) => {
  await page.locator(sel.ejectConfirm).waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator(sel.ejectConfirmCancel).click();
  await page.locator(sel.ejectConfirm).waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
};

/**
 * Erase this disk — Prefer A: must be on **empty** disk (never Grade5A kolibri/nextcloud).
 * ensureEmptyDiskPanel → erase-this-disk → erase-dialog. Loud-fail if no empty docked.
 */
export const erase_disk: IntentFn = async ({ page, diskId }) => {
  await ensureEmptyDiskPanel(page, { diskId }, 'erase_disk');
  const btn = page.locator(sel.eraseThisDisk);
  if (!(await btn.count()) || !(await btn.isVisible().catch(() => false))) {
    throw new Error(
      'idea#168 erase_disk: EmptyDiskPanel open but [data-testid="erase-this-disk"] missing/hidden. ' +
        'Never erase Grade5A App Disks — dock duration-empty-001 (DURATION_EMPTY_DISK_ID). No soft-pass.',
    );
  }
  if (await btn.isDisabled().catch(() => false)) {
    const title = (await btn.getAttribute('title'))?.trim() || 'disabled';
    throw new Error(
      `idea#168 erase_disk: erase-this-disk greyed out (${title}). No soft-pass.`,
    );
  }
  await btn.click();
  await page.locator(sel.eraseDialog).waitFor({ state: 'visible', timeout: 15_000 });
};

export const cancel_erase: IntentFn = async ({ page }) => {
  await page.locator(sel.eraseDialog).waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator(sel.eraseCancel).click();
  await page.locator(sel.eraseDialog).waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
};

/**
 * Type live summary label, confirm erase, wait until **complete**
 * (erase-complete / Done) — never soft-pass while "checking…".
 */
export const confirm_erase: IntentFn = async ({ page }) => {
  const dialog = page.locator(sel.eraseDialog);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });

  // Wait past "Reading the disk…" for confirm field
  const nameInput = page.locator(sel.eraseConfirmName);
  try {
    await nameInput.waitFor({ state: 'visible', timeout: 60_000 });
  } catch {
    const hint = ((await dialog.textContent()) ?? '').slice(0, 200);
    throw new Error(
      `idea#168 confirm_erase: erase-confirm-name never appeared (still summarising / error?). ` +
        `dialog≈"${hint}". No soft-pass.`,
    );
  }

  const strong = dialog.locator('label[for="erase-confirm-name"] strong');
  await strong.waitFor({ state: 'visible', timeout: 10_000 });
  const label = (await strong.textContent())?.trim() ?? '';
  if (!label) {
    throw new Error('idea#168 confirm_erase: empty confirm label — cannot type to confirm.');
  }
  await nameInput.fill(label);
  const ok = page.locator(sel.eraseConfirmOk);
  await ok.waitFor({ state: 'visible', timeout: 5_000 });
  if (await ok.isDisabled().catch(() => false)) {
    throw new Error(
      `idea#168 confirm_erase: erase-confirm-ok still disabled after typing "${label}".`,
    );
  }
  await ok.click();

  // Wait for completion — not soft-ok on checking…
  const complete = page.locator(sel.eraseComplete);
  const doneBtn = page.locator(sel.eraseDone);
  const progress = page.locator(sel.eraseProgress);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const err = dialog.locator('.edp-form__error[role="alert"]');
    if (await err.isVisible().catch(() => false)) {
      const msg = ((await err.textContent()) ?? '').trim();
      // summary-error / removed / erase error
      if (!/Type .+ to confirm/i.test(msg)) {
        throw new Error(`idea#168 confirm_erase: erase failed — "${msg}". No soft-pass.`);
      }
    }
    if (await complete.isVisible().catch(() => false)) {
      if (await doneBtn.isVisible().catch(() => false)) {
        await doneBtn.click().catch(() => {});
      }
      return;
    }
    // Dialog closed after onErasedEmpty auto-select — also success
    if (!(await dialog.isVisible().catch(() => false))) {
      // Prefer seeing empty badge somewhere
      return;
    }
    await page.waitForTimeout(500);
  }

  const step = (await progress.getAttribute('data-erase-step').catch(() => null)) ?? '';
  const stuck = await progress.isVisible().catch(() => false);
  throw new Error(
    `idea#168 confirm_erase: erase did not complete within 180s ` +
      `(stuck progress=${stuck}, data-erase-step="${step}"). ` +
      `r16 soft-passed while "checking…" — must wait for erase-complete. No soft-pass.`,
  );
};

/**
 * Prefer A Path A instance id (not zombie kolibri-1.0-duration*).
 * Env: DURATION_START_INSTANCE_ID overrides ctx / kolibri-grade5a-001.
 */
export function resolveStartInstanceId(
  instanceId?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.DURATION_START_INSTANCE_ID?.trim() ||
    instanceId ||
    DURATION_FIXTURES.kolibri.instanceId
  );
}

const forceRestart = (env: NodeJS.ProcessEnv = process.env): boolean =>
  /^(1|true|yes)$/i.test(env.DURATION_START_FORCE_RESTART?.trim() ?? '');

/** Closest InstanceRow ancestor for a control on that row. */
const instanceRowFor = (page: Page, controlSel: string) =>
  page.locator(controlSel).locator('xpath=ancestor::*[contains(@class,"instance-row")][1]');

/**
 * True when instance is fully Running (Open ↗ or Running StatusDot) — not Starting.
 */
export async function isInstanceTrulyRunning(
  page: Page,
  id: string,
): Promise<boolean> {
  if (await page.locator(sel.openInstance(id)).isVisible().catch(() => false)) {
    return true;
  }
  const row = instanceRowFor(page, sel.startInstance(id));
  if (await row.locator('.status-dot--running, [aria-label="Status: Running"]').count()) {
    return true;
  }
  return false;
}

/**
 * True when UI shows Starting / in-progress (auto-start after install, locked op).
 */
export async function isInstanceStartingOrInProgress(
  page: Page,
  id: string,
): Promise<boolean> {
  const row = instanceRowFor(page, sel.startInstance(id));
  if (await row.locator('[aria-label="Status: Starting"], .status-dot--starting').count()) {
    return true;
  }
  if (
    await row
      .locator('.instance-row__progress-label')
      .filter({ hasText: /Starting|containers|operation in progress/i })
      .count()
  ) {
    return true;
  }
  if (await row.getByText(/Starting containers|Starting\.\.\./i).count()) {
    return true;
  }
  const start = page.locator(sel.startInstance(id));
  const title = ((await start.getAttribute('title')) ?? '').trim();
  if (/operation in progress|starting/i.test(title)) return true;
  return false;
}

/**
 * True when Path A instance looks Running or Starting (Open ↗, StatusDot, or
 * Start disabled + Stop enabled with title Start app).
 * For start settle prefer isInstanceTrulyRunning / isInstanceStartingOrInProgress.
 */
export async function isInstanceAlreadyRunning(
  page: Page,
  id: string,
): Promise<boolean> {
  if (await isInstanceTrulyRunning(page, id)) return true;
  if (await isInstanceStartingOrInProgress(page, id)) return true;
  const start = page.locator(sel.startInstance(id));
  const stop = page.locator(sel.stopInstance(id));
  if (!(await start.count())) return false;
  const startDis = await start.isDisabled().catch(() => false);
  const stopDis = await stop.isDisabled().catch(() => true);
  const title = ((await start.getAttribute('title')) ?? '').trim();
  // Running/Starting disable Start with title "Start app" (not "Operation in progress")
  if (startDis && !stopDis && (title === 'Start app' || title === '')) return true;
  return false;
}

/** Budget while Start disabled during Starting / in-progress (DURATION_START_SETTLE_MS). */
export function startSettleTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DURATION_START_SETTLE_MS?.trim();
  if (raw && /^\d+$/.test(raw)) return Math.max(5_000, Number(raw));
  return 120_000;
}

export async function isInstanceAlreadyStopped(
  page: Page,
  id: string,
): Promise<boolean> {
  const row = instanceRowFor(page, sel.stopInstance(id));
  if (await row.locator('.status-dot--stopped, [aria-label="Status: Stopped"]').count()) {
    return true;
  }
  if (await row.locator('.status-dot--undocked, [aria-label="Status: Undocked"]').count()) {
    return true;
  }
  const start = page.locator(sel.startInstance(id));
  const stop = page.locator(sel.stopInstance(id));
  if (!(await stop.count())) return false;
  const stopDis = await stop.isDisabled().catch(() => false);
  const startDis = await start.isDisabled().catch(() => true);
  // Stopped: Stop disabled, Start enabled
  if (stopDis && !startDis) return true;
  if (await page.locator(sel.openInstance(id)).isVisible().catch(() => false)) {
    return false;
  }
  return stopDis;
}

/**
 * Prefer Path A id on tree; if missing, discover start-instance-* with grade5a
 * (never pick arbitrary zombie kolibri-1.0-duration rows as the primary target).
 */
async function resolveVisibleStartInstanceId(
  page: Page,
  preferred: string,
): Promise<string> {
  if (await page.locator(sel.startInstance(preferred)).count()) {
    return preferred;
  }
  const grade5a = page.locator('[data-testid^="start-instance-"][data-testid*="grade5a"]');
  if (await grade5a.count()) {
    const tid = await grade5a.first().getAttribute('data-testid');
    const id = tid?.replace(/^start-instance-/, '') ?? '';
    if (id) return id;
  }
  // List visible start buttons for loud-fail
  const all = page.locator('[data-testid^="start-instance-"]');
  const n = await all.count();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const tid = await all.nth(i).getAttribute('data-testid');
    if (tid) ids.push(tid.replace(/^start-instance-/, ''));
  }
  throw new Error(
    `idea#168 start_instance: [data-testid="start-instance-${preferred}"] not found. ` +
      `Prefer Path A (kolibri-grade5a-001); visible start-instance ids=[${ids.join(', ')}]. ` +
      `Set DURATION_START_INSTANCE_ID. Do not target zombie kolibri-1.0-duration* rows. No soft-pass.`,
  );
}

/**
 * Start (or force-restart) an instance. Returns resolved Path A instance id.
 * forceRestart: stop→start even when UI already shows Running (ghost Running / no Open).
 * Env DURATION_START_FORCE_RESTART=1 also forces restart.
 */
export async function runStartInstance(
  page: Page,
  instanceId?: string,
  opts: { forceRestart?: boolean } = {},
): Promise<string> {
  await page.locator(sel.opOverview).or(page.locator(sel.networkTree)).first()
    .waitFor({ state: 'visible', timeout: 15_000 });

  const preferred = resolveStartInstanceId(instanceId);
  const id = await resolveVisibleStartInstanceId(page, preferred);
  const btn = page.locator(sel.startInstance(id));
  await btn.waitFor({ state: 'visible', timeout: 15_000 });

  const doForce = !!opts.forceRestart || forceRestart();
  // Prefer A r32: only no-op when truly Running (Open / Running status) — not Starting
  if ((await isInstanceTrulyRunning(page, id)) && !doForce) {
    return id;
  }

  if ((await isInstanceAlreadyRunning(page, id)) && doForce) {
    const stopBtn = page.locator(sel.stopInstance(id));
    if (await stopBtn.isDisabled().catch(() => true)) {
      throw new Error(
        `idea#168 start_instance: force-restart requested but stop-instance-${id} disabled.`,
      );
    }
    await stopBtn.click();
    const stopDeadline = Date.now() + 60_000;
    while (Date.now() < stopDeadline) {
      if (await isInstanceAlreadyStopped(page, id)) break;
      if (!(await btn.isDisabled().catch(() => true))) break;
      await page.waitForTimeout(400);
    }
  }

  // Start disabled while Starting / in-progress (installApp auto-start) — wait, don't 468ms fail
  if (await btn.isDisabled().catch(() => false)) {
    const title0 = ((await btn.getAttribute('title')) ?? '').trim();
    if (await isInstanceTrulyRunning(page, id) && !doForce) return id;

    const starting =
      (await isInstanceStartingOrInProgress(page, id)) ||
      /operation in progress|starting/i.test(title0) ||
      title0 === 'Start app' ||
      title0 === '';

    if (!starting) {
      throw new Error(
        `idea#168 start_instance: start-instance-${id} disabled (title="${title0}") ` +
          `while instance is not Running/Starting — cannot start. No soft-pass.`,
      );
    }

    const budget = startSettleTimeoutMs();
    const deadline = Date.now() + budget;
    while (Date.now() < deadline) {
      if (await isInstanceTrulyRunning(page, id)) return id;
      if (!(await btn.isDisabled().catch(() => true))) break; // enabled → click below
      await page.waitForTimeout(500);
    }

    if (await isInstanceTrulyRunning(page, id)) return id;
    if (await btn.isDisabled().catch(() => false)) {
      const title = ((await btn.getAttribute('title')) ?? '').trim();
      throw new Error(
        `idea#168 start_instance: start-instance-${id} still disabled after ${budget}ms ` +
          `(title="${title}") — waited Starting/in-progress but never Running. ` +
          `r32: installApp auto-start / Starting-containers must settle (DURATION_START_SETTLE_MS). ` +
          `No soft-pass.`,
      );
    }
  }

  await btn.click();

  const open = page.locator(sel.openInstance(id));
  const afterClickBudget = startSettleTimeoutMs();
  try {
    await open.waitFor({ state: 'visible', timeout: Math.min(60_000, afterClickBudget) });
  } catch {
    if (await isInstanceTrulyRunning(page, id)) return id;
    if (await isInstanceAlreadyRunning(page, id) && (await btn.isDisabled().catch(() => false))) {
      // Still Starting after click — wait remaining settle
      const deadline = Date.now() + afterClickBudget;
      while (Date.now() < deadline) {
        if (await isInstanceTrulyRunning(page, id)) return id;
        await page.waitForTimeout(500);
      }
    }
    if (await isInstanceTrulyRunning(page, id)) return id;
    throw new Error(
      `idea#168 start_instance: clicked Start on ${id} but instance did not become Running ` +
        `(no open-instance-${id}). No soft-pass.`,
    );
  }
  return id;
}

/**
 * Start instance — Prefer A: no-op PASS if already Running (Start correctly disabled).
 * Loud-fail only when not running and Start disabled. Optional force restart via
 * DURATION_START_FORCE_RESTART=1.
 */
export const start_instance: IntentFn = async ({ page, instanceId }) => {
  await runStartInstance(page, instanceId);
};

/**
 * Stop instance — Prefer A: no-op PASS if already Stopped (Stop correctly disabled).
 * Loud-fail if Running/Starting but Stop disabled (locked).
 */
export const stop_instance: IntentFn = async ({ page, instanceId }) => {
  await page.locator(sel.opOverview).or(page.locator(sel.networkTree)).first()
    .waitFor({ state: 'visible', timeout: 15_000 });

  const preferred = resolveStartInstanceId(instanceId);
  const id = await resolveVisibleStartInstanceId(page, preferred);
  const btn = page.locator(sel.stopInstance(id));
  await btn.waitFor({ state: 'visible', timeout: 15_000 });

  if (await isInstanceAlreadyStopped(page, id)) {
    return;
  }

  if (await btn.isDisabled().catch(() => false)) {
    const title = ((await btn.getAttribute('title')) ?? '').trim();
    throw new Error(
      `idea#168 stop_instance: stop-instance-${id} disabled (title="${title}") ` +
        `while instance is not Stopped — cannot stop (locked?). No soft-pass.`,
    );
  }

  await btn.click();

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await isInstanceAlreadyStopped(page, id)) return;
    await page.waitForTimeout(400);
  }
  throw new Error(
    `idea#168 stop_instance: clicked Stop on ${id} but instance still looks Running after 60s.`,
  );
};

export const open_account: IntentFn = async ({ page }) => {
  await page.locator(sel.accountBtn).click();
  await page.locator(sel.opEntry).waitFor({ state: 'visible', timeout: 10_000 });
};

export const close_account: IntentFn = async ({ page }) => {
  await page.locator(sel.opEntry).waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator(sel.accountBtn).click();
};

export const open_settings: IntentFn = async ({ page }) => {
  await page.locator(sel.settingsBtn).click();
  await page.locator(sel.settingsPanel).waitFor({ state: 'visible', timeout: 10_000 });
};

export const close_settings: IntentFn = async ({ page }) => {
  await page.locator(sel.settingsPanel).waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator(sel.settingsBtn).click();
};

/**
 * Sign in — wait for Engine store (leave Connecting…), then admin login → op_overview.
 */
export const sign_in: IntentFn = async ({ page }) => {
  const state = await performOperatorSignIn(page, { intent: 'sign_in' });
  if (state === 'first_time_setup') {
    throw new Error(
      'idea#168 sign_in: first-time-setup visible — use retry_login_first_time_setup instead.',
    );
  }
  // Close Account overlay if still open so operator layout is usable
  const entry = page.locator(sel.opEntry);
  if (await entry.isVisible().catch(() => false)) {
    // Already logged in: closing account reveals overview
    await page.locator(sel.accountBtn).click().catch(() => {});
  }
  await page.locator(sel.opOverview).waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator(sel.networkTree).waitFor({ state: 'visible', timeout: 15_000 });
};

/**
 * Make Files Disk — select docked empty disk → EmptyDiskPanel card → share → submit.
 * Prefer A: never remap onto Grade5A app disks.
 */
export const make_files_disk: IntentFn = async ({ page, diskId }) => {
  await ensureEmptyDiskPanel(page, { diskId }, 'make_files_disk');
  if (await page.locator(sel.makeFilesDisk).count()) {
    await page.locator(sel.makeFilesDisk).click();
  } else {
    throw new Error(
      'idea#168 make_files_disk: EmptyDiskPanel visible but [data-testid="make-files-disk"] missing.',
    );
  }
  const share = page.locator(sel.filesShareName);
  await share.waitFor({ state: 'visible', timeout: 10_000 });
  // Default "School Files" is fine; ensure non-empty then submit
  const v = await share.inputValue();
  if (!v.trim()) await share.fill('School Files');
  await page.locator(sel.filesShareSubmit).click();
};

/**
 * Add Files role (proposal snake_case) — DiskView Add Files → share name → submit.
 */
export const add_files_role: IntentFn = async ({ page }) => {
  const addBtn = page.locator(sel.addFiles);
  if (await addBtn.count()) {
    await addBtn.click();
  }
  const share = page.locator(sel.filesShareName);
  await share.waitFor({ state: 'visible', timeout: 15_000 });
  const v = await share.inputValue();
  if (!v.trim()) await share.fill('School Files');
  await page.locator(sel.filesShareSubmit).click();
};

/** @deprecated Alias — prefer add_files_role (proposal title). */
export const add_files = add_files_role;
