/**
 * Phase 3 usage Intents: open Kolibri / Nextcloud from console overview (idea#166).
 * Keys from Axle ACTIONS.md + school-day.yaml. Selectors use Kid stable instance IDs.
 *
 * // idea#166: later — skip when Engine capability stamp is stale
 */
import type { Page } from '@playwright/test';
import type { IntentFn } from './types';
import { sel } from './selectors';
import { DURATION_FIXTURES } from './fixtures';

/**
 * From teacher/learner overview, open a Running instance by id-keyed testid.
 * Prefers the Open button; falls back to the card (visible even when Stopped).
 * Returns a popup Page when window.open fires; otherwise null.
 */
export const openInstanceFromOverview = async (
  page: Page,
  instanceId: string,
): Promise<Page | null> => {
  await page.locator(sel.consoleOverview).waitFor({ state: 'visible', timeout: 15_000 });
  const card = page.locator(sel.instance(instanceId));
  await card.waitFor({ state: 'visible', timeout: 15_000 });
  const openBtn = page.locator(sel.openInstance(instanceId));
  const popupPromise = page.context().waitForEvent('page', { timeout: 8_000 }).catch(() => null);
  if (await openBtn.count()) {
    await openBtn.click();
  } else {
    await card.click();
  }
  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
  }
  return popup;
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
