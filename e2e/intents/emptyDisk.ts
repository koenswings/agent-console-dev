/**
 * EmptyDiskPanel Intents need a docked **empty** disk (Steve Prefer A).
 * Path A duration docks app disks (kolibri/nextcloud) — never remap install_app
 * onto Grade5A. Loud-fail if no empty disk; Engine/Kid should dock
 * `duration-empty-001` (suggested until Kid publishes a pin).
 */
import type { Page } from '@playwright/test';
import type { IntentContext } from './types';
import { sel } from './selectors';
import { DURATION_FIXTURES } from './fixtures';

/** Suggested Kid/Atlas empty USB fixture id (not yet in App IMAGE — document for Engine). */
export const SUGGESTED_EMPTY_DISK_ID = 'duration-empty-001';

const APP_DURATION_DISK_IDS = new Set([
  DURATION_FIXTURES.kolibri.diskId,
  DURATION_FIXTURES.nextcloud.diskId,
]);

export function resolveEmptyDiskIdPreference(
  ctx: Pick<IntentContext, 'diskId'> = {},
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.DURATION_EMPTY_DISK_ID?.trim() ||
    ctx.diskId ||
    DURATION_FIXTURES.empty.diskId
  );
}

const preloadFail = (intent: string, detail: string): Error =>
  new Error(
    `idea#168 ${intent}: ${detail} ` +
      `Engine preload (Prefer A): dock an **empty** disk fixture alongside duration app disks — ` +
      `suggested id \`${SUGGESTED_EMPTY_DISK_ID}\` (diskTypes=['empty'], no instances). ` +
      `Set DURATION_EMPTY_DISK_ID when the id differs. ` +
      `Do NOT use duration-kolibri-grade5a-001 / duration-nextcloud-grade5a-001 (App Disks). ` +
      `Axle may interim-skip install_app / make_files_disk / make_backup_disk / erase_disk until empty docks.`,
  );

/** Ensure op overview / NetworkTree visible. */
const ensureTree = async (page: Page): Promise<void> => {
  await page
    .locator(sel.opOverview)
    .or(page.locator(sel.networkTree))
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
};

/**
 * Click disk row and return true if EmptyDiskPanel appeared.
 * Refuses known duration app disk ids (no Grade5A remap).
 */
export async function trySelectEmptyDisk(
  page: Page,
  diskId: string,
): Promise<boolean> {
  if (APP_DURATION_DISK_IDS.has(diskId)) return false;
  const row = page.locator(sel.disk(diskId));
  if (!(await row.isVisible().catch(() => false))) return false;
  await row.click();
  const panel = page.locator(sel.emptyDiskPanel);
  try {
    await panel.waitFor({ state: 'visible', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Prefer env/ctx/fixture id; else discover NetworkTree rows with empty badge.
 * Leaves EmptyDiskPanel visible or throws loud-fail.
 */
export async function ensureEmptyDiskPanel(
  page: Page,
  ctx: Pick<IntentContext, 'diskId'> = {},
  intent = 'empty_disk',
): Promise<string> {
  await ensureTree(page);

  // Already on EmptyDiskPanel from a prior step
  if (await page.locator(sel.emptyDiskPanel).isVisible().catch(() => false)) {
    const preferred = resolveEmptyDiskIdPreference(ctx);
    return preferred;
  }

  const preferred = resolveEmptyDiskIdPreference(ctx);
  if (await trySelectEmptyDisk(page, preferred)) {
    return preferred;
  }

  // Discover: disk rows with data-role="empty" badge
  const emptyRows = page.locator(
    `${sel.networkTree} [data-testid^="disk-"]:has([data-role="empty"])`,
  );
  const n = await emptyRows.count();
  for (let i = 0; i < n; i++) {
    const row = emptyRows.nth(i);
    const testId = await row.getAttribute('data-testid');
    const diskId = testId?.replace(/^disk-/, '') ?? '';
    if (!diskId || APP_DURATION_DISK_IDS.has(diskId)) continue;
    await row.click();
    if (await page.locator(sel.emptyDiskPanel).isVisible().catch(() => false)) {
      return diskId;
    }
    // Brief wait for panel
    try {
      await page.locator(sel.emptyDiskPanel).waitFor({ state: 'visible', timeout: 3_000 });
      return diskId;
    } catch {
      /* try next */
    }
  }

  // Fallback: probe other docked disks (skip app fixtures) — expensive but loud-clear
  const allDisks = page.locator(`${sel.networkTree} [data-testid^="disk-"]`);
  const m = await allDisks.count();
  const probed: string[] = [];
  for (let i = 0; i < m; i++) {
    const row = allDisks.nth(i);
    const testId = await row.getAttribute('data-testid');
    const diskId = testId?.replace(/^disk-/, '') ?? '';
    if (!diskId || APP_DURATION_DISK_IDS.has(diskId)) continue;
    if (diskId === preferred) continue; // already tried
    probed.push(diskId);
    if (await trySelectEmptyDisk(page, diskId)) return diskId;
  }

  const visibleIds: string[] = [];
  for (let i = 0; i < m; i++) {
    const testId = await allDisks.nth(i).getAttribute('data-testid');
    if (testId) visibleIds.push(testId.replace(/^disk-/, ''));
  }

  throw preloadFail(
    intent,
    `no docked empty disk showing EmptyDiskPanel ` +
      `(tried preferred=${preferred}, empty-badge rows=${n}, probed=[${probed.join(', ')}], ` +
      `visible disks=[${visibleIds.join(', ')}]).`,
  );
}
