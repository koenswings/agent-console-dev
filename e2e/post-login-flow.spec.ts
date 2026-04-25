import { test, expect } from '@playwright/test';
import { loginAsDemo, DEMO_USERNAME, DEMO_PASSWORD } from './helpers';

test.describe('Post-login flow', () => {
  const pageErrors: Error[] = [];

  test.beforeEach(async ({ page }) => {
    pageErrors.length = 0;
    page.on('pageerror', (err) => pageErrors.push(err));
  });

  test('main-layout is visible immediately after login', async ({ page }) => {
    await loginAsDemo(page);

    await expect(page.locator('.main-layout')).toBeVisible();
    await expect(page.locator('.app-browser')).not.toBeVisible();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);

    expect(pageErrors).toHaveLength(0);
  });

  test('settings opens and closes correctly after login — full cycle', async ({ page }) => {
    await loginAsDemo(page);

    // Confirm main layout is up
    await expect(page.locator('.main-layout')).toBeVisible();

    // Open settings
    await page.locator('.status-bar__settings-btn').click();
    await expect(page.locator('.settings-panel')).toBeVisible();
    await expect(page.locator('.main-layout')).not.toBeVisible();

    // Toggle settings closed via gear button
    await page.locator('.status-bar__settings-btn').click();
    await expect(page.locator('.settings-panel')).not.toBeVisible();
    await expect(page.locator('.main-layout')).toBeVisible();

    // Open settings again — button still works
    await page.locator('.status-bar__settings-btn').click();
    await expect(page.locator('.settings-panel')).toBeVisible();

    // Close via the settings toggle button in the status bar
    await page.locator('.status-bar__settings-btn').click();
    await expect(page.locator('.settings-panel')).not.toBeVisible();
    await expect(page.locator('.main-layout')).toBeVisible();

    expect(pageErrors).toHaveLength(0);
  });

  test('logout returns to app-browser, re-login shows main-layout again', async ({ page }) => {
    await loginAsDemo(page);

    await expect(page.locator('.main-layout')).toBeVisible();

    // Log out
    await page.locator('.status-bar__logout-btn').click();

    await expect(page.locator('.app-browser')).toBeVisible();
    await expect(page.locator('.main-layout')).not.toBeVisible();
    await expect(page.locator('.status-bar__username')).not.toBeVisible();

    // Re-login
    await page.locator('.app-browser__login-link').click();
    await page.locator('.modal').waitFor({ state: 'visible' });

    await page.locator('input[autocomplete="username"]').fill(DEMO_USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(DEMO_PASSWORD);
    await page.locator('button.btn--primary[type="submit"]').click();

    await page.locator('.status-bar__username').waitFor({ state: 'visible', timeout: 15_000 });
    await expect(page.locator('.main-layout')).toBeVisible();

    expect(pageErrors).toHaveLength(0);
  });
});
