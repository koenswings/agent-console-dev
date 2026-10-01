/**
 * Thin operator deeper path (idea#166): open disk inventory / instance controls
 * using Kid stable disk + instance IDs (ACTIONS.md).
 */
import type { IntentFn } from './types';
import { sel } from './selectors';
import { DURATION_FIXTURES } from './fixtures';

/** Click a docked disk row by id → DiskView / EmptyDiskPanel (op_disk). */
export const open_disk_inventory: IntentFn = async ({ page, diskId }) => {
  await page.locator(sel.opOverview).or(page.locator(sel.networkTree)).first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  const id = diskId ?? DURATION_FIXTURES.kolibri.diskId;
  await page.locator(sel.disk(id)).click();
  // Disk view or empty panel for that id
  const view = page.locator(sel.diskView(id));
  const empty = page.locator(sel.emptyDiskPanel);
  await view.or(empty).first().waitFor({ state: 'visible', timeout: 10_000 });
};

/** Focus an instance row by Kid (or ctx) instance id (op_instance). */
export const open_instance_controls: IntentFn = async ({ page, instanceId }) => {
  await page.locator(sel.opOverview).or(page.locator(sel.networkTree)).first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  const id = instanceId ?? DURATION_FIXTURES.kolibri.instanceId;
  const row = page.locator(sel.instance(id));
  await row.waitFor({ state: 'visible', timeout: 15_000 });
  await row.click();
};
