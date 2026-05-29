import { test, expect } from '@playwright/test';
import { loginAsDemo } from './helpers';

test.describe('Settings panel', () => {
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

    await loginAsDemo(page);

    // Main layout must be visible before any settings interactions
    await expect(page.locator('.main-layout')).toBeVisible();
  });

  test('settings panel opens via the gear button', async ({ page }) => {
    await page.locator('.status-bar__settings-btn').click();

    await expect(page.locator('.settings-panel')).toBeVisible();
    await expect(page.locator('.settings-panel__heading')).toContainText('Engine Connection');

    expect(pageErrors).toHaveLength(0);
  });

  test('settings panel closes via the gear button toggle', async ({ page }) => {
    await page.locator('.status-bar__settings-btn').click();
    await expect(page.locator('.settings-panel')).toBeVisible();

    // Gear button is the only control — no internal close button
    await page.locator('.status-bar__settings-btn').click();
    await expect(page.locator('.settings-panel')).not.toBeVisible();

    expect(pageErrors).toHaveLength(0);
  });

  test('engine connection tab shows demo mode status', async ({ page }) => {
    await page.locator('.status-bar__settings-btn').click();
    await expect(page.locator('.settings-panel')).toBeVisible();

    // In demo mode the status label says "Demo mode"
    await expect(page.locator('.settings-panel__current-label')).toContainText('Demo mode');

    // Demo toggle checkbox is present
    await expect(page.locator('.settings-panel input[type="checkbox"]')).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
    expect(pageErrors).toHaveLength(0);
  });

  test('switching tabs keeps the panel open', async ({ page }) => {
    await page.locator('.status-bar__settings-btn').click();
    await expect(page.locator('.settings-panel')).toBeVisible();

    // Switch to Account tab (visible to operators)
    await page.locator('.settings-panel__tab', { hasText: 'Account' }).click();
    await expect(page.locator('.settings-panel__heading')).toContainText('Change Password');
    await expect(page.locator('.settings-panel')).toBeVisible();

    // Switch to About tab
    await page.locator('.settings-panel__tab', { hasText: 'About' }).click();
    await expect(page.locator('.settings-panel__heading')).toContainText('About');
    await expect(page.locator('.settings-panel')).toBeVisible();

    expect(pageErrors).toHaveLength(0);
  });

  test('closes settings and returns to main layout, then opens again', async ({ page }) => {
    // Step 1: main layout is visible (confirmed by beforeEach)
    await expect(page.locator('.main-layout')).toBeVisible();

    // Step 2: open settings
    await page.locator('.status-bar__settings-btn').click();
    await expect(page.locator('.settings-panel')).toBeVisible();

    // Step 3: toggle settings closed via gear button
    await page.locator('.status-bar__settings-btn').click();
    await expect(page.locator('.settings-panel')).not.toBeVisible();
    await expect(page.locator('.main-layout')).toBeVisible();

    // Step 4: open settings again — proves button still works
    await page.locator('.status-bar__settings-btn').click();
    await expect(page.locator('.settings-panel')).toBeVisible();

    expect(pageErrors).toHaveLength(0);
  });
});
