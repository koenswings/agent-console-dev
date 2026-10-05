/**
 * RestorePanel Intents need a selected **Backup Disk** (Steve Prefer A).
 * After make_backup_disk, that is usually the former empty fixture
 * `duration-empty-001`. Never remap restore onto Grade5A app DiskView alone.
 */
import type { Page } from '@playwright/test';
import type { IntentContext } from './types';
import { sel } from './selectors';
import { DURATION_FIXTURES } from './fixtures';

/** Same physical pack as empty until Kid publishes a dedicated backup pin. */
export const SUGGESTED_BACKUP_DISK_ID = DURATION_FIXTURES.backup.diskId;

const APP_DURATION_DISK_IDS = new Set([
  DURATION_FIXTURES.kolibri.diskId,
  DURATION_FIXTURES.nextcloud.diskId,
]);

export function resolveBackupDiskIdPreference(
  ctx: Pick<IntentContext, 'diskId'> = {},
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.DURATION_BACKUP_DISK_ID?.trim() ||
    ctx.diskId ||
    DURATION_FIXTURES.backup.diskId
  );
}

const preloadFail = (intent: string, detail: string): Error =>
  new Error(
    `idea#168 ${intent}: ${detail} ` +
      `Engine preload (Prefer A): select/dock a **Backup Disk** showing RestorePanel — ` +
      `typically \`${SUGGESTED_BACKUP_DISK_ID}\` after make_backup_disk on the empty fixture, ` +
      `or set DURATION_BACKUP_DISK_ID. ` +
      `Walker should open_disk_inventory on the backup disk (or this Intent selects it). ` +
      `Do NOT treat duration-kolibri / duration-nextcloud App Disks as the backup source. ` +
      `No soft-skip.`,
  );

const ensureTree = async (page: Page): Promise<void> => {
  await page
    .locator(sel.opOverview)
    .or(page.locator(sel.networkTree))
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
};

/** Click disk; true if restore-panel visible. */
export async function trySelectBackupDisk(
  page: Page,
  diskId: string,
): Promise<boolean> {
  // Grade5A app disks are restore *targets*, not RestorePanel hosts
  if (APP_DURATION_DISK_IDS.has(diskId)) return false;
  const row = page.locator(sel.disk(diskId));
  if (!(await row.isVisible().catch(() => false))) return false;
  await row.click();
  try {
    await page.locator(sel.restorePanel).waitFor({ state: 'visible', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Prefer env/ctx/fixture id; else discover NetworkTree backup badge.
 * Leaves restore-panel visible or throws loud-fail.
 */
export async function ensureBackupDiskPanel(
  page: Page,
  ctx: Pick<IntentContext, 'diskId'> = {},
  intent = 'restore_from_backup',
): Promise<string> {
  await ensureTree(page);

  if (await page.locator(sel.restorePanel).isVisible().catch(() => false)) {
    return resolveBackupDiskIdPreference(ctx);
  }

  const preferred = resolveBackupDiskIdPreference(ctx);
  if (await trySelectBackupDisk(page, preferred)) {
    return preferred;
  }

  // Discover: data-role="backup" badge on tree rows
  const backupRows = page.locator(
    `${sel.networkTree} [data-testid^="disk-"]:has([data-role="backup"])`,
  );
  const n = await backupRows.count();
  for (let i = 0; i < n; i++) {
    const row = backupRows.nth(i);
    const testId = await row.getAttribute('data-testid');
    const diskId = testId?.replace(/^disk-/, '') ?? '';
    if (!diskId || APP_DURATION_DISK_IDS.has(diskId)) continue;
    await row.click();
    try {
      await page.locator(sel.restorePanel).waitFor({ state: 'visible', timeout: 4_000 });
      return diskId;
    } catch {
      /* try next — combined disks may show DiskView with Backups section */
    }
    // Combined App+Backup: RestorePanel may be nested in DiskView
    const nested = page.locator(`${sel.diskView(diskId)} ${sel.restorePanel}`);
    if (await nested.isVisible().catch(() => false)) return diskId;
  }

  // Probe other non-app disks
  const allDisks = page.locator(`${sel.networkTree} [data-testid^="disk-"]`);
  const m = await allDisks.count();
  const probed: string[] = [];
  for (let i = 0; i < m; i++) {
    const testId = await allDisks.nth(i).getAttribute('data-testid');
    const diskId = testId?.replace(/^disk-/, '') ?? '';
    if (!diskId || APP_DURATION_DISK_IDS.has(diskId)) continue;
    if (diskId === preferred) continue;
    probed.push(diskId);
    if (await trySelectBackupDisk(page, diskId)) return diskId;
  }

  const visibleIds: string[] = [];
  for (let i = 0; i < m; i++) {
    const testId = await allDisks.nth(i).getAttribute('data-testid');
    if (testId) visibleIds.push(testId.replace(/^disk-/, ''));
  }

  throw preloadFail(
    intent,
    `no Backup Disk showing [data-testid="restore-panel"] ` +
      `(tried preferred=${preferred}, backup-badge rows=${n}, probed=[${probed.join(', ')}], ` +
      `visible=[${visibleIds.join(', ')}]). ` +
      `Run make_backup_disk on duration-empty-001 first, then select that disk.`,
  );
}

/** Prefer env → ctx instanceId → Kolibri Grade5A fixture. */
export function resolveBackupSourceInstanceId(
  ctx: Pick<IntentContext, 'instanceId'> = {},
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.DURATION_BACKUP_SOURCE_INSTANCE?.trim() ||
    ctx.instanceId ||
    DURATION_FIXTURES.kolibri.instanceId
  );
}

/**
 * EmptyDiskPanel backup form: on-demand mode + ≥1 linked instance + Configure,
 * then wait until backup role / success / restore-panel. Loud-fail on
 * "Select at least one app" or disk still empty. Prefer A — no soft-pass.
 */
export async function completeMakeBackupDiskForm(
  page: Page,
  opts: {
    diskId: string;
    instanceId?: string;
    intent?: string;
  },
): Promise<void> {
  const intent = opts.intent ?? 'make_backup_disk';
  const form = page.locator(sel.emptyDiskPanel);
  await form.locator(sel.configureBackupDisk).waitFor({ state: 'visible', timeout: 10_000 });

  // Manual / on-demand (default) — click if present
  const mode = page.locator(sel.backupMode('on-demand'));
  if (await mode.isVisible().catch(() => false)) {
    await mode.click();
  }

  const preferred = resolveBackupSourceInstanceId({ instanceId: opts.instanceId });
  let linked = page.locator(sel.backupLinkInstance(preferred));
  if (!(await linked.count()) || !(await linked.isVisible().catch(() => false))) {
    // Prefer a Running checkbox when preferred id missing from form
    const running = page
      .locator(`${sel.emptyDiskPanel} [data-testid^="backup-link-instance-"]`)
      .filter({ hasText: /Running/i })
      .first();
    if (await running.count()) {
      linked = running;
    } else {
      linked = page
        .locator(`${sel.emptyDiskPanel} [data-testid^="backup-link-instance-"]`)
        .first();
    }
  }
  if (!(await linked.count())) {
    throw new Error(
      `idea#168 ${intent}: no backup-link-instance-* checkboxes — ` +
        `EmptyDiskPanel shows "No instances found" or Engine instanceDB empty. ` +
        `Dock duration apps first; set DURATION_BACKUP_SOURCE_INSTANCE when needed. No soft-pass.`,
    );
  }
  const box = linked.locator('input[type="checkbox"]');
  if (!(await box.isChecked().catch(() => false))) {
    await linked.click();
  }
  if (!(await box.isChecked().catch(() => false))) {
    // label click may miss — force check
    await box.check({ force: true }).catch(() => {});
  }
  if (!(await box.isChecked().catch(() => false))) {
    throw new Error(
      `idea#168 ${intent}: failed to check a linked instance checkbox ` +
        `(preferred=${preferred}). No soft-pass.`,
    );
  }

  await form.locator(sel.configureBackupDisk).click();

  // Validation banner must not stick
  const formErr = page.locator(sel.backupFormError);
  try {
    await formErr.waitFor({ state: 'visible', timeout: 800 });
  } catch {
    /* ok — no client validation error */
  }
  if (await formErr.isVisible().catch(() => false)) {
    const msg = ((await formErr.textContent()) ?? '').trim();
    throw new Error(
      `idea#168 ${intent}: Configure Backup Disk rejected — "${msg}". ` +
        `Must check ≥1 linked instance before Configure. No soft-pass.`,
    );
  }

  const pending = page.locator(sel.backupPending);
  if (await pending.isVisible().catch(() => false)) {
    await pending.waitFor({ state: 'hidden', timeout: 90_000 }).catch(() => {});
  }

  const engineErr = page.locator('[data-testid="backup-error"]');
  if (await engineErr.isVisible().catch(() => false)) {
    const msg = ((await engineErr.textContent()) ?? '').trim();
    throw new Error(`idea#168 ${intent}: Engine createBackupDisk error — ${msg}`);
  }

  // Success local OR NetworkTree backup badge OR restore-panel
  const success = page.locator(sel.backupConfiguredSuccess);
  const backupBadge = page.locator(
    `${sel.networkTree} ${sel.disk(opts.diskId)} [data-role="backup"]`,
  );
  const anyBackupBadge = page.locator(
    `${sel.networkTree} [data-testid^="disk-"]:has([data-role="backup"])`,
  );
  const restore = page.locator(sel.restorePanel);

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await success.isVisible().catch(() => false)) return;
    if (await restore.isVisible().catch(() => false)) return;
    if (await backupBadge.isVisible().catch(() => false)) return;
    if ((await anyBackupBadge.count()) > 0) {
      // Disk republished with backup role (id may stay duration-empty-001)
      return;
    }
    // Still showing empty badge on preferred disk → keep waiting briefly
    await page.waitForTimeout(400);
  }

  const stillEmpty = page.locator(
    `${sel.networkTree} ${sel.disk(opts.diskId)} [data-role="empty"]`,
  );
  const emptyLeft =
    (await stillEmpty.isVisible().catch(() => false)) ||
    (await form.locator(sel.configureBackupDisk).isVisible().catch(() => false));
  throw new Error(
    `idea#168 ${intent}: createBackupDisk did not finish — disk still empty / ` +
      `no data-role="backup" / no restore-panel / no backup-configured-success ` +
      `(diskId=${opts.diskId}, emptyFormLeft=${emptyLeft}). ` +
      `r15 soft-pass fixed: must link ≥1 instance and wait for Engine. No soft-pass.`,
  );
}

/**
 * Assert backup is really configured — never EmptyDiskPanel leftovers
 * ("Make this a Backup Disk" / Configure / "Select at least one app").
 */
export async function assertBackupConfigured(
  page: Page,
  ctx: Pick<IntentContext, 'diskId'> = {},
  intent = 'backup_configured_restored',
): Promise<void> {
  await ensureTree(page);

  const success = page.locator(sel.backupConfiguredSuccess);
  if (await success.isVisible().catch(() => false)) return;

  if (await page.locator(sel.restorePanel).isVisible().catch(() => false)) return;

  const preferred = resolveBackupDiskIdPreference(ctx);
  const badgeOnPreferred = page.locator(
    `${sel.networkTree} ${sel.disk(preferred)} [data-role="backup"]`,
  );
  if (await badgeOnPreferred.isVisible().catch(() => false)) return;

  // Try select preferred / discover backup rows
  try {
    await ensureBackupDiskPanel(page, ctx, intent);
    return;
  } catch (e) {
    /* fall through with richer message */
  }

  const leftoverErr = page.locator(sel.backupFormError);
  const leftoverCfg = page.locator(
    `${sel.emptyDiskPanel} ${sel.configureBackupDisk}`,
  );
  const leftoverHint =
    (await leftoverErr.isVisible().catch(() => false)) ||
    (await leftoverCfg.isVisible().catch(() => false));

  throw new Error(
    `idea#168 ${intent}: Backup Disk not configured ` +
      `(no restore-panel, no data-role="backup", no backup-configured-success` +
      `${leftoverHint ? '; EmptyDiskPanel Configure / validation leftovers visible' : ''}). ` +
      `make_backup_disk must check ≥1 instance and complete Configure. ` +
      `Do NOT treat EmptyDiskPanel "Backup Disk" menu/form text as success. No soft-pass.`,
  );
}
