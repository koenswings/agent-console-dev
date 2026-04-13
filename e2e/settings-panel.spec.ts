import { test, expect } from '@playwright/test';
import { loginAsDemo } from './helpers';

test.describe('Settings panel', () => {
  const consoleErrors: string[] = [];
  const pageErrors: Error[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    pageErrors.length = 0;

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err));

    await loginAsDemo(page);
  });

  test('settings panel opens via the gear button', async ({ page }) => {
    await page.locator('.status-bar__settings-btn').click();

    await expect(page.locator('.settings-panel')).toBeVisible();
    await expect(page.locator('.settings-panel__heading')).toContainText('Engine Connection');

    expect(pageErrors).toHaveLength(0);
  });

  test('settings panel closes via the close button', async ({ page }) => {
    await page.locator('.status-bar__settings-btn').click();
    await expect(page.locator('.settings-panel')).toBeVisible();

    await page.locator('.settings-panel__close-btn').click();
    await expect(page.locator('.settings-panel')).not.toBeVisible();

    expect(pageErrors).toHaveLength(0);
  });

  test('opening the change-engine dialog does NOT close the settings panel', async ({ page }) => {
    await page.locator('.status-bar__settings-btn').click();
    await expect(page.locator('.settings-panel')).toBeVisible();

    // Change engine button is operator-only — should be visible after login
    await page.locator('.settings-panel__change-engine-btn').click();
    await expect(page.locator('.change-engine-dialog')).toBeVisible();

    // Settings panel is still in the DOM behind the dialog
    await expect(page.locator('.settings-panel')).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
    expect(pageErrors).toHaveLength(0);
  });

  test('cancelling the change-engine dialog leaves settings panel open', async ({ page }) => {
    await page.locator('.status-bar__settings-btn').click();
    await expect(page.locator('.settings-panel')).toBeVisible();

    await page.locator('.settings-panel__change-engine-btn').click();
    await expect(page.locator('.change-engine-dialog')).toBeVisible();

    // Close dialog via Cancel
    await page.locator('.change-engine-dialog__cancel').click();
    await expect(page.locator('.change-engine-dialog')).not.toBeVisible();

    // Settings panel must remain open
    await expect(page.locator('.settings-panel')).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
    expect(pageErrors).toHaveLength(0);
  });

  test('demo mode section is shown inside change-engine dialog', async ({ page }) => {
    await page.locator('.status-bar__settings-btn').click();
    await page.locator('.settings-panel__change-engine-btn').click();
    await expect(page.locator('.change-engine-dialog')).toBeVisible();

    // Demo mode section is always present in the dialog
    const demoSection = page.locator('.change-engine-dialog__demo-section');
    await expect(demoSection).toBeVisible();

    // Since we booted in demo mode, it shows the "currently in demo mode" text
    await expect(demoSection).toContainText('demo mode');

    // Panel is still open throughout
    await expect(page.locator('.settings-panel')).toBeVisible();

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
});
