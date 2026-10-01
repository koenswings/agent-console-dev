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
