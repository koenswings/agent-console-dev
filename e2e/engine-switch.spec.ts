import { test, expect } from '@playwright/test';
import { loginAsDemo } from './helpers';

test.describe('Engine switch (operator only)', () => {
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

  test('shows mock engines from demo data', async ({ page }) => {
    await expect(page.locator('.main-layout')).toBeVisible();

    // The mock store has two engines: appdocker01 and appdocker02
    await expect(page.getByText('appdocker01')).toBeVisible();
    await expect(page.getByText('appdocker02')).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
    expect(pageErrors).toHaveLength(0);
  });

  test('DEMO badge is visible when in demo mode', async ({ page }) => {
    await expect(page.locator('.status-bar__demo-badge')).toBeVisible();
    await expect(page.locator('.status-bar__demo-badge')).toHaveText('DEMO');

    expect(pageErrors).toHaveLength(0);
  });

  test('engine connection tab is accessible from settings', async ({ page }) => {
    await page.locator('.status-bar__settings-btn').click();
    await expect(page.locator('.settings-panel')).toBeVisible();

    // Engine Connection tab is selected by default
    await expect(
      page.locator('.settings-panel__tab--active'),
    ).toContainText('Engine Connection');

    await expect(page.locator('.settings-panel__heading')).toContainText('Engine Connection');

    expect(pageErrors).toHaveLength(0);
  });

  test('change engine dialog is operator-only and opens from engine tab', async ({ page }) => {
    await page.locator('.status-bar__settings-btn').click();
    await expect(page.locator('.settings-panel')).toBeVisible();

    // Change engine button is only visible to operators
    const changeEngineBtn = page.locator('.settings-panel__change-engine-btn');
    await expect(changeEngineBtn).toBeVisible();

    await changeEngineBtn.click();

    const dialog = page.locator('.change-engine-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.locator('.change-engine-dialog__title')).toContainText('Change Engine');

    // Hostname input and scan button are present
    await expect(page.locator('.change-engine-dialog__input')).toBeVisible();
    await expect(page.locator('.change-engine-dialog__scan-btn')).toBeVisible();

    // Demo mode section is present
    await expect(page.locator('.change-engine-dialog__demo-section')).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
    expect(pageErrors).toHaveLength(0);
  });

  test('demo status shown in engine connection tab', async ({ page }) => {
    await page.locator('.status-bar__settings-btn').click();

    // In demo mode, the current engine label says "Demo mode"
    await expect(page.locator('.settings-panel__current-label')).toContainText('Demo mode');

    expect(pageErrors).toHaveLength(0);
  });
});
