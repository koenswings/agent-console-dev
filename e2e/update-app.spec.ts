/**
 * update-app.spec.ts — updateApp end to end on a real Engine (idea#76).
 *
 * Not run in CI: every case skips unless its env vars are set. It is meant to
 * run on idea04 (claimed), driven from idea02 per the LAN rule, once the
 * Engine #76 gap PRs are merged. It changes the Engine: claim the Pi first.
 *
 * Fixture (Kid, agent-app-dev): a test App with three versions on App Disks
 * docked on the same Engine, e.g. `idea-test-app` 1.0.0 (installed instance),
 * 1.1.0 (minor) and 2.0.0 (major, `x-app.updatesFrom: [1]`), each with
 * SHA256SUMS. Use one instance per case (the minor case moves it to 1.1).
 *
 * Env:
 *   UPDATE_E2E_ENGINE_HOST       Engine hostname the Console connects to (idea04.local)
 *   CONSOLE_USER / CONSOLE_PASSWORD   operator login (InstanceRow is operator-only)
 *   UPDATE_E2E_MINOR_INSTANCE_ID + UPDATE_E2E_MINOR_TO   instance on 1.0 + expected new version (1.1.0)
 *   UPDATE_E2E_MAJOR_INSTANCE_ID + UPDATE_E2E_MAJOR_TO   instance on 1.x + expected new version (2.0.0)
 *   UPDATE_E2E_BACKUP_DISK_ID    Backup Disk docked on the Engine (fresh backup for the major case)
 *   UPDATE_E2E_STALE_INSTANCE_ID instance offered the major, last backup older than 1 h (or none)
 *   UPDATE_E2E_TIMEOUT_MS        per-update wait (default 15 min)
 *
 *   UPDATE_E2E_ENGINE_HOST=idea04.local CONSOLE_USER=… CONSOLE_PASSWORD=… \
 *     UPDATE_E2E_MINOR_INSTANCE_ID=… UPDATE_E2E_MINOR_TO=1.1.0 … pnpm test:e2e e2e/update-app.spec.ts
 */
import { test, expect, type Page } from '@playwright/test';

const env = (k: string): string => process.env[k] ?? '';
const HOST = env('UPDATE_E2E_ENGINE_HOST');
const USER = env('CONSOLE_USER');
const PASSWORD = env('CONSOLE_PASSWORD');
const UPDATE_TIMEOUT = Number(env('UPDATE_E2E_TIMEOUT_MS')) || 15 * 60_000;
const BASE_READY = !!(HOST && USER && PASSWORD);
const MINOR_ID = env('UPDATE_E2E_MINOR_INSTANCE_ID');
const MINOR_TO = env('UPDATE_E2E_MINOR_TO');
const MAJOR_ID = env('UPDATE_E2E_MAJOR_INSTANCE_ID');
const MAJOR_TO = env('UPDATE_E2E_MAJOR_TO');
const BACKUP_DISK = env('UPDATE_E2E_BACKUP_DISK_ID');
const STALE_ID = env('UPDATE_E2E_STALE_INSTANCE_ID');

test.describe.configure({ mode: 'serial' });
// Skip at file scope (no browser launched) when the Engine/login env is missing.
test.skip(!BASE_READY, 'UPDATE_E2E_ENGINE_HOST / CONSOLE_USER / CONSOLE_PASSWORD not set');

async function openAllApps(page: Page): Promise<void> {
  await page.addInitScript((h: string) => {
    localStorage.clear();
    localStorage.setItem('engineHostname', h);
    localStorage.setItem('demoMode', 'false');
  }, HOST);
  await page.goto('/');
  await page.locator('.status-bar__dot--connected').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('[data-testid="account-btn"]').click();
  await page.locator('input[autocomplete="username"]').fill(USER);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.locator('button.btn--primary[type="submit"]').click();
  await page.locator('.account-screen__username').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('[data-testid="account-btn"]').click();
  await page.getByTestId('network-all-apps').click();
}

async function openConfirm(page: Page, id: string, toVersion: string): Promise<void> {
  const badge = page.getByTestId(`update-badge-${id}`);
  await expect(badge).toBeVisible({ timeout: 60_000 });
  await expect(badge).toContainText(toVersion);
  await badge.click();
  await expect(page.getByTestId(`update-confirm-${id}`)).toBeVisible();
}

async function expectUpdated(page: Page, id: string): Promise<void> {
  const outcome = page.getByTestId(`update-outcome-${id}`);
  await expect(outcome).toBeVisible({ timeout: UPDATE_TIMEOUT });
  await expect(outcome).toHaveAttribute('data-kind', 'updated');
  await expect(outcome).toContainText('Updated from');
  await expect(page.getByTestId(`update-error-${id}`)).toHaveCount(0);
}

const noCliText = async (page: Page, id: string): Promise<void> => {
  const text = (await page.getByTestId(`update-app-${id}`).textContent()) ?? '';
  expect(text).not.toMatch(/(^|\s)--[a-z]/i);
  expect(text).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/);
};

test.describe('minor', () => {
test.skip(!MINOR_ID || !MINOR_TO, 'UPDATE_E2E_MINOR_* not set');
test('minor update succeeds', async ({ page }) => {
  const id = MINOR_ID;
  const to = MINOR_TO;
  test.setTimeout(UPDATE_TIMEOUT + 120_000);
  await openAllApps(page);
  await openConfirm(page, id, to);
  await expect(page.getByTestId(`update-confirm-needs-backup-${id}`)).toHaveCount(0);
  await page.getByTestId(`update-confirm-btn-${id}`).click();
  await expectUpdated(page, id);
  await noCliText(page, id);
});

});

test.describe('major, fresh backup', () => {
test.skip(!MAJOR_ID || !MAJOR_TO || !BACKUP_DISK, 'UPDATE_E2E_MAJOR_* / BACKUP_DISK_ID not set');
test('major update with a fresh backup succeeds', async ({ page }) => {
  const id = MAJOR_ID;
  const to = MAJOR_TO;
  const backupDisk = BACKUP_DISK;
  test.setTimeout(2 * UPDATE_TIMEOUT + 120_000);
  await openAllApps(page);
  // Fresh backup first (the Engine needs one under 1 h old for a major).
  await page.getByTestId(`backup-instance-${id}`).click();
  await page.getByTestId(`backup-to-disk-${backupDisk}`).click();
  await openConfirm(page, id, to);
  const update = page.getByTestId(`update-confirm-btn-${id}`);
  // The Console's gate reads instance.lastBackup: Update unlocks once the backup lands.
  await expect(update).toBeEnabled({ timeout: UPDATE_TIMEOUT });
  await expect(page.getByTestId(`update-confirm-${id}`)).toContainText('is a major update');
  await update.click();
  await expectUpdated(page, id);
  await noCliText(page, id);
});

});

test.describe('major, stale backup', () => {
test.skip(!STALE_ID || !MAJOR_TO, 'UPDATE_E2E_STALE_INSTANCE_ID / MAJOR_TO not set');
test('major update with a stale backup is held back', async ({ page }) => {
  const id = STALE_ID;
  const to = MAJOR_TO;
  await openAllApps(page);
  await openConfirm(page, id, to);
  await expect(page.getByTestId(`update-confirm-btn-${id}`)).toBeDisabled();
  await expect(page.getByTestId(`update-confirm-needs-backup-${id}`)).toHaveText('Make a backup first');
  await noCliText(page, id);
});
});
