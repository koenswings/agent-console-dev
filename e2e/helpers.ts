import type { Page } from '@playwright/test';

// Demo credentials from src/mock/mockStore.ts
// (bcrypt hash of 'admin911!' stored as the pre-provisioned demo operator)
export const DEMO_USERNAME = 'admin';
export const DEMO_PASSWORD = 'admin911!';

/**
 * Log in as the pre-provisioned demo operator.
 *
 * Sets demoMode in localStorage before navigation so the app boots with the
 * mock store. Works because IS_EXTENSION=false on localhost and readStoredDemoMode
 * falls through to localStorage.
 */
export async function loginAsDemo(page: Page): Promise<void> {
  // Ensure demo mode regardless of any previous localStorage state
  await page.addInitScript(() => {
    localStorage.setItem('demoMode', 'true');
    localStorage.removeItem('engineHostname');
  });

  await page.goto('/');

  // Wait for the app to boot in demo mode (DEMO badge in status bar)
  await page.locator('.status-bar__demo-badge').waitFor({ state: 'visible', timeout: 15_000 });

  // Click the login button in AppBrowser
  await page.locator('.app-browser__login-link').click();

  // Wait for the login modal
  await page.locator('.modal').waitFor({ state: 'visible' });

  // Fill credentials
  await page.locator('input[autocomplete="username"]').fill(DEMO_USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(DEMO_PASSWORD);

  // Submit
  await page.locator('button.btn--primary[type="submit"]').click();

  // Wait for operator UI — username appears in the status bar
  await page.locator('.status-bar__username').waitFor({ state: 'visible', timeout: 15_000 });
}
