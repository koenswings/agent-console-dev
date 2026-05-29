import { test, expect } from '@playwright/test';
import { DEMO_USERNAME, DEMO_PASSWORD } from './helpers';

test.describe('Demo login flow', () => {
  const consoleErrors: string[] = [];
  const pageErrors: Error[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    pageErrors.length = 0;

    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('ERR_CONNECTION_REFUSED')) {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => pageErrors.push(err));

    // Fresh demo-mode boot — no engine hostname, demo flag set explicitly
    await page.addInitScript(() => {
      localStorage.setItem('demoMode', 'true');
      localStorage.removeItem('engineHostname');
    });
  });

  test('account screen renders with username and password fields', async ({ page }) => {
    await page.goto('/');
    await page.locator('.status-bar__demo-badge').waitFor({ state: 'visible', timeout: 15_000 });

    // Account button opens AccountScreen (replaces login modal)
    await page.locator('.status-bar__account-btn').click();

    const accountScreen = page.locator('.account-screen');
    await expect(accountScreen).toBeVisible();
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
    await expect(page.locator('input[autocomplete="current-password"]')).toBeVisible();
    await expect(page.locator('button.btn--primary[type="submit"]')).toBeVisible();

    expect(pageErrors).toHaveLength(0);
  });

  test('logs in with demo credentials and shows operator UI', async ({ page }) => {
    await page.goto('/');
    await page.locator('.status-bar__demo-badge').waitFor({ state: 'visible', timeout: 15_000 });

    await page.locator('.status-bar__account-btn').click();
    await page.locator('.account-screen').waitFor({ state: 'visible' });

    await page.locator('input[autocomplete="username"]').fill(DEMO_USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(DEMO_PASSWORD);
    await page.locator('button.btn--primary[type="submit"]').click();

    // Operator UI: username in AccountScreen
    const username = page.locator('.account-screen__username');
    await expect(username).toBeVisible({ timeout: 15_000 });
    await expect(username).toHaveText(DEMO_USERNAME);

    // No modal overlay — AccountScreen is a full content area
    await expect(page.locator('.modal-overlay')).toHaveCount(0);

    // Close AccountScreen — main layout should be visible
    await page.locator('.status-bar__account-btn').click();
    await expect(page.locator('.main-layout')).toBeVisible();
    await expect(page.locator('.app-browser')).not.toBeVisible();

    expect(consoleErrors).toHaveLength(0);
    expect(pageErrors).toHaveLength(0);
  });

  test('shows error for wrong password', async ({ page }) => {
    await page.goto('/');
    await page.locator('.status-bar__demo-badge').waitFor({ state: 'visible', timeout: 15_000 });

    await page.locator('.status-bar__account-btn').click();
    await page.locator('.account-screen').waitFor({ state: 'visible' });

    await page.locator('input[autocomplete="username"]').fill(DEMO_USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill('wrongpassword');
    await page.locator('button.btn--primary[type="submit"]').click();

    // Error message should appear
    await expect(page.locator('.form-error')).toBeVisible({ timeout: 15_000 });

    // Still on login form — no username shown
    await expect(page.locator('.account-screen__username')).not.toBeVisible();

    expect(pageErrors).toHaveLength(0);
  });
});
