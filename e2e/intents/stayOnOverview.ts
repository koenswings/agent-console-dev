/**
 * Dwell Intents: teacher / learner / operator overview (idea#166/#168).
 * Prefer A: assert real catalog / NetworkTree content — no soft-catch empty dwell.
 */
import type { IntentFn } from './types';
import { sel } from './selectors';

async function assertUserOverviewWithCatalog(
  page: import('@playwright/test').Page,
  intent: string,
): Promise<void> {
  await page.locator(sel.consoleOverview).waitFor({ state: 'visible', timeout: 10_000 });
  const cards = page.locator(`${sel.consoleOverview} [data-testid^="instance-"]`);
  try {
    await cards.first().waitFor({ state: 'attached', timeout: 10_000 });
  } catch {
    const n = await cards.count();
    throw new Error(
      `idea#168 ${intent}: console-overview visible but no [data-testid^="instance-"] cards. ` +
        `Prefer A docks Grade5A fixtures — count=${n}. Engine preload / Path A startInstances may be missing.`,
    );
  }
  // Brief dwell after catalog assert (screenshot settle)
  await page.waitForTimeout(200);
}

export const stay_on_teacher_overview: IntentFn = async ({ page }) => {
  await assertUserOverviewWithCatalog(page, 'stay_on_teacher_overview');
};

export const stay_on_learner_overview: IntentFn = async ({ page }) => {
  await assertUserOverviewWithCatalog(page, 'stay_on_learner_overview');
};

/**
 * Operator NetworkTree dwell (ACTIONS.md / school-day.yaml `stay_on_overview`).
 * Prefer A: expand engines and require ≥1 disk-* (same contract as notice_usb_dock).
 */
export const stay_on_overview: IntentFn = async ({ page }) => {
  await page
    .locator(sel.opOverview)
    .or(page.locator(sel.networkTree))
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 });
  if (await page.locator(sel.settingsPanel).isVisible().catch(() => false)) {
    await page.locator(sel.settingsBtn).click().catch(() => {});
  }
  if (await page.locator(sel.opEntry).isVisible().catch(() => false)) {
    await page.locator(sel.accountBtn).click().catch(() => {});
  }
  const tree = page.locator(sel.networkTree);
  await tree.waitFor({ state: 'visible', timeout: 10_000 });
  const engines = tree.locator('[data-testid^="engine-"]');
  const n = await engines.count();
  for (let i = 0; i < n; i++) {
    await engines.nth(i).click({ timeout: 3_000 }).catch(() => {});
  }
  const disks = tree.locator('[data-testid^="disk-"]');
  const deadline = Date.now() + 15_000;
  let count = 0;
  while (Date.now() < deadline) {
    count = await disks.count();
    if (count > 0) break;
    await page.waitForTimeout(400);
  }
  if (count === 0) {
    throw new Error(
      'idea#168 stay_on_overview: NetworkTree visible but no [data-testid^="disk-"] rows after 15s. ' +
        'Prefer A — dock fixture disks before operator dwell (no soft empty dwell).',
    );
  }
  await page.waitForTimeout(200);
};
