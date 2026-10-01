/**
 * Phase 3 usage Intents: open Kolibri / Nextcloud from console overview (idea#166).
 * Keys from Axle ACTIONS.md + school-day.yaml. Selectors use Kid stable instance IDs.
 *
 * // idea#166: later — skip when Engine capability stamp is stale
 * // idea#166: later — deeper keep_watching / exit_lesson run inside the App tab
 */
import type { IntentFn } from './types';
import { sel } from './selectors';
import { DURATION_FIXTURES } from './fixtures';

/**
 * From teacher/learner overview, open a Running instance by id-keyed testid.
 * Prefers the Open button; falls back to the card (visible even when Stopped).
 */
const openInstanceFromOverview = async (
  page: import('@playwright/test').Page,
  instanceId: string,
): Promise<void> => {
  await page.locator(sel.consoleOverview).waitFor({ state: 'visible', timeout: 15_000 });
  const card = page.locator(sel.instance(instanceId));
  await card.waitFor({ state: 'visible', timeout: 15_000 });
  const openBtn = page.locator(sel.openInstance(instanceId));
  if (await openBtn.count()) {
    // Popup may be blocked in headless; still click so the Intent is exercised
    await openBtn.click();
  } else {
    await card.click();
  }
};

export const open_kolibri_as_teacher: IntentFn = async ({ page, instanceId }) => {
  await openInstanceFromOverview(page, instanceId ?? DURATION_FIXTURES.kolibri.instanceId);
};

export const open_kolibri_as_learner: IntentFn = async ({ page, instanceId }) => {
  await openInstanceFromOverview(page, instanceId ?? DURATION_FIXTURES.kolibri.instanceId);
};

export const open_nextcloud_as_teacher: IntentFn = async ({ page, instanceId }) => {
  await openInstanceFromOverview(page, instanceId ?? DURATION_FIXTURES.nextcloud.instanceId);
};

export const open_nextcloud_as_learner: IntentFn = async ({ page, instanceId }) => {
  await openInstanceFromOverview(page, instanceId ?? DURATION_FIXTURES.nextcloud.instanceId);
};
