/**
 * Tests for manual hostname entry in the Onboarding panel.
 *
 * Uses Playwright route interception to simulate engine responses without
 * needing a real engine running.
 */
import { test, expect } from '@playwright/test';

/**
 * Boot the app into onboarding mode (no demo, no hostname).
 * Intercept /api/store-url so we control which hostnames "respond".
 */
async function bootOnboarding(page: import('@playwright/test').Page, respondingHosts: string[]) {
  // Intercept all /api/store-url requests
  await page.route('**/api/store-url', async (route) => {
    const url = new URL(route.request().url());
    const host = url.hostname;
    if (respondingHosts.includes(host)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: 'automerge:4GQmEZehPDfryGDxkFo9XixbvmAC' }),
      });
    } else {
      // Simulate unreachable host — abort so the fetch throws
      await route.abort('connectionrefused');
    }
  });

  await page.addInitScript(() => {
    localStorage.removeItem('demoMode');
    localStorage.removeItem('engineHostname');
    localStorage.removeItem('storeUrl');
  });

  await page.goto('/');
}

test.describe('Manual hostname connect', () => {
  test('bare name without digits (wizardly-hugle) connects when bare responds', async ({ page }) => {
    // Only the bare name responds (Tailscale scenario, no .local)
    await bootOnboarding(page, ['wizardly-hugle']);

    // Wait for onboarding to appear
    await page.locator('.onboarding').waitFor({ state: 'visible', timeout: 10_000 });

    // Open manual input
    await page.locator('.onboarding__manual-link').click();

    // Type the hostname
    await page.locator('.form-field__input').fill('wizardly-hugle');

    // Time the connect — should complete in well under 6s (parallel probing)
    const start = Date.now();
    await page.locator('.engine-picker__connect-btn').last().click();

    // Onboarding should disappear (connection accepted) within 6s
    await page.locator('.onboarding').waitFor({ state: 'hidden', timeout: 6_000 });
    const elapsed = Date.now() - start;

    // Should be fast — not 10s
    expect(elapsed).toBeLessThan(6_000);
  });

  test('bare name without digits connects when .local responds', async ({ page }) => {
    // Only .local responds
    await bootOnboarding(page, ['wizardly-hugle.local']);

    await page.locator('.onboarding').waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('.onboarding__manual-link').click();
    await page.locator('.form-field__input').fill('wizardly-hugle');

    const start = Date.now();
    await page.locator('.engine-picker__connect-btn').last().click();
    await page.locator('.onboarding').waitFor({ state: 'hidden', timeout: 6_000 });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(6_000);
  });

  test('shows error quickly when no host responds', async ({ page }) => {
    // Nothing responds
    await bootOnboarding(page, []);

    await page.locator('.onboarding').waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('.onboarding__manual-link').click();
    await page.locator('.form-field__input').fill('doesnotexist');

    const start = Date.now();
    await page.locator('.engine-picker__connect-btn').last().click();

    // Error should appear within 6s (not 10s)
    await page.locator('.onboarding__manual-error').waitFor({ state: 'visible', timeout: 6_000 });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(6_000);
    await expect(page.locator('.onboarding__manual-error')).toContainText('Could not reach');
  });

  test('host:port syntax works', async ({ page }) => {
    await bootOnboarding(page, ['myengine']);

    // Override route to also check port 8080
    await page.route('**/api/store-url', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === 'myengine' && url.port === '8080') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ url: 'automerge:4GQmEZehPDfryGDxkFo9XixbvmAC' }),
        });
      } else {
        await route.abort('connectionrefused');
      }
    });

    await page.locator('.onboarding').waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('.onboarding__manual-link').click();
    await page.locator('.form-field__input').fill('myengine:8080');

    await page.locator('.engine-picker__connect-btn').last().click();
    await page.locator('.onboarding').waitFor({ state: 'hidden', timeout: 6_000 });
  });
});
