import { test, expect } from '@playwright/test';
import { DEMO_USERNAME, DEMO_PASSWORD } from './helpers';

test.describe('Demo login flow', () => {
  const consoleErrors: string[] = [];
  const pageErrors: Error[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    pageErrors.length = 0;

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err));

    // Fresh demo-mode boot — no engine hostname, demo flag set explicitly
    await page.addInitScript(() => {
      localStorage.setItem('demoMode', 'true');
      localStorage.removeItem('engineHostname');
    });
  });

  test('login form renders with username and password fields', async ({ page }) => {
    await page.goto('/');
    await page.locator('.status-bar__demo-badge').waitFor({ state: 'visible', timeout: 15_000 });

    await page.locator('.app-browser__login-link').click();

    const modal = page.locator('.modal');
    await expect(modal).toBeVisible();
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
    await expect(page.locator('input[autocomplete="current-password"]')).toBeVisible();
    await expect(page.locator('button.btn--primary[type="submit"]')).toBeVisible();

    expect(pageErrors).toHaveLength(0);
  });

  test('logs in with demo credentials and shows operator UI', async ({ page }) => {
    await page.goto('/');
    await page.locator('.status-bar__demo-badge').waitFor({ state: 'visible', timeout: 15_000 });

    await page.locator('.app-browser__login-link').click();
    await page.locator('.modal').waitFor({ state: 'visible' });

    await page.locator('input[autocomplete="username"]').fill(DEMO_USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(DEMO_PASSWORD);
    await page.locator('button.btn--primary[type="submit"]').click();

    // Operator UI: username in status bar
    const username = page.locator('.status-bar__username');
    await expect(username).toBeVisible({ timeout: 15_000 });
    await expect(username).toHaveText(DEMO_USERNAME);

    // Main layout should be rendered
    await expect(page.locator('.main-layout')).toBeVisible();

    // Login modal should be gone
    await expect(page.locator('.modal')).not.toBeVisible();

    expect(consoleErrors).toHaveLength(0);
    expect(pageErrors).toHaveLength(0);
  });

  test('shows error for wrong password', async ({ page }) => {
    await page.goto('/');
    await page.locator('.status-bar__demo-badge').waitFor({ state: 'visible', timeout: 15_000 });

    await page.locator('.app-browser__login-link').click();
    await page.locator('.modal').waitFor({ state: 'visible' });

    await page.locator('input[autocomplete="username"]').fill(DEMO_USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill('wrongpassword');
    await page.locator('button.btn--primary[type="submit"]').click();

    // Error message should appear
    await expect(page.locator('.form-error')).toBeVisible({ timeout: 15_000 });

    // Still on login form
    await expect(page.locator('.modal')).toBeVisible();
    await expect(page.locator('.status-bar__username')).not.toBeVisible();

    expect(pageErrors).toHaveLength(0);
  });
});
