/**
 * Hub Intents: open Console as teacher / learner / operator (idea#166).
 *
 * Teacher and learner share the same user-mode AppBrowser (`console-overview`);
 * the walker role is outside the DOM. Operator lands on Account / login
 * (`op-entry`) ready for Sign in (not stubbed in this minimal slice).
 *
 * // idea#166: later — skip when Engine capability stamp is stale
 */
import type { IntentFn } from './types';
import { sel } from './selectors';

const bootDemo = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.addInitScript(() => {
    localStorage.setItem('demoMode', 'true');
    localStorage.removeItem('engineHostname');
  });
  await page.goto('/');
};

export const open_console_as_teacher: IntentFn = async ({ page }) => {
  await bootDemo(page);
  await page.locator(sel.consoleOverview).waitFor({ state: 'visible', timeout: 15_000 });
};

export const open_console_as_learner: IntentFn = async ({ page }) => {
  // Same surface as teacher today; walker distinguishes the role.
  await bootDemo(page);
  await page.locator(sel.consoleOverview).waitFor({ state: 'visible', timeout: 15_000 });
};

export const open_console_as_operator: IntentFn = async ({ page }) => {
  await bootDemo(page);
  const account = page.locator(sel.accountBtn);
  if (await account.count()) {
    await account.click();
  } else {
    await page.locator('.status-bar__account-btn').click();
  }
  await page.locator(sel.opEntry).waitFor({ state: 'visible', timeout: 15_000 });
};
