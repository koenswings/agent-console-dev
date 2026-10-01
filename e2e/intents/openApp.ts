/**
 * Phase 3+ classroom Intents: open Kolibri / Nextcloud from console overview (idea#166/#168).
 * Real click sequences: Open instance → App tab → facility/app login (Kid auth).
 */
import type { Page } from '@playwright/test';
import type { IntentFn } from './types';
import { sel } from './selectors';
import { DURATION_FIXTURES } from './fixtures';
import { attemptAppLogin } from './appLogin';

/**
 * From teacher/learner overview, open a Running instance by id-keyed testid.
 * Prefers the Open button; falls back to the card.
 * Returns the App popup Page when window.open fires; otherwise null.
 */
export const openInstanceFromOverview = async (
  page: Page,
  instanceId: string,
): Promise<Page | null> => {
  await page.locator(sel.consoleOverview).waitFor({ state: 'visible', timeout: 15_000 });
  const card = page.locator(sel.instance(instanceId));
  await card.waitFor({ state: 'visible', timeout: 15_000 });
  const openBtn = page.locator(sel.openInstance(instanceId));
  if (!(await openBtn.count())) {
    throw new Error(
      `idea#168: open-instance-${instanceId} not found (instance not Running?). ` +
        `Card present=${(await card.count()) > 0}`,
    );
  }
  const popupPromise = page.context().waitForEvent('page', { timeout: 8_000 }).catch(() => null);
  await openBtn.click();
  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
  }
  return popup;
};

const openAndLogin = async (
  page: Page,
  instanceId: string,
  creds: { username: string; password: string },
): Promise<void> => {
  const popup = await openInstanceFromOverview(page, instanceId);
  const app = popup ?? page;
  // Best-effort App login — live Kolibri/Nextcloud may already be sessioned
  await attemptAppLogin(app, creds).catch(() => 'no_form');
};

export const open_kolibri_as_teacher: IntentFn = async ({ page, instanceId }) => {
  await openAndLogin(
    page,
    instanceId ?? DURATION_FIXTURES.kolibri.instanceId,
    DURATION_FIXTURES.kolibri.auth.teacher,
  );
};

export const open_kolibri_as_learner: IntentFn = async ({ page, instanceId }) => {
  await openAndLogin(
    page,
    instanceId ?? DURATION_FIXTURES.kolibri.instanceId,
    DURATION_FIXTURES.kolibri.auth.learner,
  );
};

export const open_nextcloud_as_teacher: IntentFn = async ({ page, instanceId }) => {
  await openAndLogin(
    page,
    instanceId ?? DURATION_FIXTURES.nextcloud.instanceId,
    DURATION_FIXTURES.nextcloud.auth.teacher,
  );
};

export const open_nextcloud_as_learner: IntentFn = async ({ page, instanceId }) => {
  await openAndLogin(
    page,
    instanceId ?? DURATION_FIXTURES.nextcloud.instanceId,
    DURATION_FIXTURES.nextcloud.auth.learner,
  );
};
