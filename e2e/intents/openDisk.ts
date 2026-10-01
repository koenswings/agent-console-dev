/**
 * Operator deeper path (idea#166/#168): open disk inventory / instance controls.
 * Prefer A: resolve visible disk/instance with loud-fail — never soft-ok missing Grade5A.
 */
import type { Page } from '@playwright/test';
import type { IntentFn } from './types';
import { sel } from './selectors';
import { DURATION_FIXTURES } from './fixtures';
import { listVisibleTreeDiskIds } from './operatorActions';

async function listVisibleInstanceIds(page: Page): Promise<string[]> {
  const rows = page.locator('[data-testid^="instance-"]');
  const n = await rows.count();
  const ids: string[] = [];
  for (let i = 0; i < Math.min(n, 40); i++) {
    const tid = await rows.nth(i).getAttribute('data-testid');
    if (tid?.startsWith('instance-')) ids.push(tid.replace(/^instance-/, ''));
  }
  return [...new Set(ids)];
}

async function resolveDiskId(page: Page, diskId?: string): Promise<string> {
  const preferred =
    process.env.DURATION_DISK_ID?.trim() ||
    diskId ||
    DURATION_FIXTURES.kolibri.diskId;
  if (await page.locator(sel.disk(preferred)).count()) return preferred;
  const visible = await listVisibleTreeDiskIds(page);
  if (visible.length === 1) return visible[0]!;
  // Prefer grade5a / duration fixtures when preferred missing
  const grade = visible.find((id) => /grade5a|duration-/i.test(id));
  if (grade) return grade;
  throw new Error(
    `idea#168 open_disk_inventory: [data-testid="disk-${preferred}"] missing. ` +
      `visible=[${visible.join(', ')}]. Set DURATION_DISK_ID / ctx.diskId. Prefer A — no soft-pass.`,
  );
}

async function resolveInstanceId(page: Page, instanceId?: string): Promise<string> {
  const preferred =
    process.env.DURATION_INSTANCE_ID?.trim() ||
    process.env.DURATION_START_INSTANCE_ID?.trim() ||
    instanceId ||
    DURATION_FIXTURES.kolibri.instanceId;
  if (await page.locator(sel.instance(preferred)).count()) return preferred;
  const visible = await listVisibleInstanceIds(page);
  const grade = visible.find((id) => /grade5a/i.test(id));
  if (grade) return grade;
  if (visible.length === 1) return visible[0]!;
  throw new Error(
    `idea#168 open_instance_controls: [data-testid="instance-${preferred}"] missing. ` +
      `visible=[${visible.join(', ')}]. Set DURATION_INSTANCE_ID / ctx.instanceId. Prefer A — no soft-pass.`,
  );
}

/** Click a docked disk row by id → DiskView / EmptyDiskPanel (op_disk). */
export const open_disk_inventory: IntentFn = async ({ page, diskId }) => {
  await page
    .locator(sel.opOverview)
    .or(page.locator(sel.networkTree))
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  if (await page.locator(sel.settingsPanel).isVisible().catch(() => false)) {
    await page.locator(sel.settingsBtn).click().catch(() => {});
  }
  if (await page.locator(sel.opEntry).isVisible().catch(() => false)) {
    await page.locator(sel.accountBtn).click().catch(() => {});
  }
  await page.locator(sel.networkTree).waitFor({ state: 'visible', timeout: 10_000 });
  const id = await resolveDiskId(page, diskId);
  const row = page.locator(sel.disk(id));
  await row.waitFor({ state: 'visible', timeout: 15_000 });
  await row.click();
  const view = page.locator(sel.diskView(id));
  const empty = page.locator(sel.emptyDiskPanel);
  try {
    await view.or(empty).first().waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    throw new Error(
      `idea#168 open_disk_inventory: clicked disk-${id} but DiskView / EmptyDiskPanel did not open. Prefer A.`,
    );
  }
};

/** Focus an instance row by Kid (or ctx) instance id (op_instance). */
export const open_instance_controls: IntentFn = async ({ page, instanceId }) => {
  await page
    .locator(sel.opOverview)
    .or(page.locator(sel.networkTree))
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  if (await page.locator(sel.settingsPanel).isVisible().catch(() => false)) {
    await page.locator(sel.settingsBtn).click().catch(() => {});
  }
  const allApps = page.locator(sel.networkAllApps);
  if (await allApps.isVisible().catch(() => false)) {
    await allApps.click().catch(() => {});
  }
  const id = await resolveInstanceId(page, instanceId);
  const row = page.locator(sel.instance(id));
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
      `idea#168 open_instance_controls: instance-${id} focused but no start/stop/open controls. Prefer A.`,
    );
  }
};
