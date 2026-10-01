/**
 * Hub Intents: open Console as teacher / learner / operator (idea#166/#168).
 *
 * Teacher and learner share user-mode AppBrowser (`console-overview`).
 * Operator lands on Account / login (`op-entry`) ready for Sign in.
 */
import type { IntentFn } from './types';
import { sel } from './selectors';

const bootDemo = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.addInitScript(() => {
    localStorage.setItem('demoMode', 'true');
    localStorage.removeItem('engineHostname');
  });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
};

export const open_console_as_teacher: IntentFn = async ({ page }) => {
  await bootDemo(page);
  await page.locator(sel.consoleOverview).waitFor({ state: 'visible', timeout: 15_000 });
  // Overview ready for classroom Intents
  await page.locator(sel.accountBtn).waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
};

export const open_console_as_learner: IntentFn = async ({ page }) => {
  await bootDemo(page);
  await page.locator(sel.consoleOverview).waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator(sel.accountBtn).waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
};

export const open_console_as_operator: IntentFn = async ({ page }) => {
  await bootDemo(page);
  const account = page.locator(sel.accountBtn);
  await account.waitFor({ state: 'visible', timeout: 15_000 });
  await account.click();
  await page.locator(sel.opEntry).waitFor({ state: 'visible', timeout: 15_000 });
  // Login form ready for sign_in
  await page.locator(sel.loginForm).waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
};
