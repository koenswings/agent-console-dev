/**
 * Dwell Intents: teacher / learner / operator overview (idea#166/#168).
 */
import type { IntentFn } from './types';
import { sel } from './selectors';

export const stay_on_teacher_overview: IntentFn = async ({ page }) => {
  await page.locator(sel.consoleOverview).waitFor({ state: 'visible', timeout: 10_000 });
  // Assert catalog cards exist (or empty overview still counts as dwell)
  await page.locator(sel.consoleOverview).locator('[data-testid^="instance-"]').first()
    .waitFor({ state: 'attached', timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(200);
};

export const stay_on_learner_overview: IntentFn = async ({ page }) => {
  await page.locator(sel.consoleOverview).waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator(sel.consoleOverview).locator('[data-testid^="instance-"]').first()
    .waitFor({ state: 'attached', timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(200);
};

/**
 * Operator NetworkTree dwell (ACTIONS.md / school-day.yaml `stay_on_overview`).
 * Expands any visible Engine rows so disk badges are in view.
 */
export const stay_on_overview: IntentFn = async ({ page }) => {
  await page.locator(sel.opOverview).or(page.locator(sel.networkTree)).first()
    .waitFor({ state: 'visible', timeout: 10_000 });
  const tree = page.locator(sel.networkTree);
  if (await tree.count()) {
    const engines = tree.locator('[data-testid^="engine-"]');
    const n = await engines.count();
    for (let i = 0; i < n; i++) {
      await engines.nth(i).click({ timeout: 3_000 }).catch(() => {});
    }
  }
  await page.waitForTimeout(200);
};
