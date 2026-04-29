/**
 * screenshot-screens.ts
 *
 * Captures all UI screens for the IDEA Console UI Design doc.
 * Run with: npx tsx scripts/screenshot-screens.ts
 *
 * Prerequisites: dev server running on http://localhost:5173
 * Output: design/screenshots/*.png
 */

import { chromium, type Page, type BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:5173';
const OUT_DIR = path.join(__dirname, '..', 'design', 'screenshots');
const DEMO_USER = 'admin';
const DEMO_PASS = 'admin911!';

async function snap(page: Page, name: string) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`✓ ${name}.png`);
}

/** Open a new page with demo mode pre-set in localStorage */
async function demoPage(ctx: BrowserContext): Promise<Page> {
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('demoMode', 'true');
  });
  return p;
}

/** Open a new page with clean localStorage (no config) */
async function cleanPage(ctx: BrowserContext): Promise<Page> {
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    localStorage.clear();
  });
  return p;
}

/** Log in via the modal and wait for the main layout */
async function loginDemo(p: Page) {
  await p.locator('.app-browser__login-link').click();
  await p.locator('.modal').waitFor({ timeout: 5_000 });
  await p.locator('input[autocomplete="username"]').fill(DEMO_USER);
  await p.locator('input[autocomplete="current-password"]').fill(DEMO_PASS);
  await p.locator('button.btn--primary[type="submit"]').click();
  await p.locator('.status-bar__username').waitFor({ timeout: 15_000 });
  await p.locator('.main-layout').waitFor({ timeout: 5_000 });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  // ── S1: Onboarding ────────────────────────────────────────────────────────
  {
    const p = await cleanPage(ctx);
    await p.goto(BASE_URL);
    await p.locator('.onboarding__card').waitFor({ timeout: 15_000 });
    await snap(p, 'S1-onboarding');
    await p.close();
  }

  // ── S4: App Browser (logged out, demo mode) ──────────────────────────────
  {
    const p = await demoPage(ctx);
    await p.goto(BASE_URL);
    await p.locator('.app-browser').waitFor({ timeout: 15_000 });
    await snap(p, 'S4-app-browser-logged-out');

    // ── M1: Login Modal ──────────────────────────────────────────────────
    await p.locator('.app-browser__login-link').click();
    await p.locator('.modal').waitFor({ timeout: 5_000 });
    await snap(p, 'M1-login-modal');
    await p.close();
  }

  // ── S5 + S5b + S5c + S6 + S2 (all need logged-in state) ─────────────────
  {
    const p = await demoPage(ctx);
    await p.goto(BASE_URL);
    await p.locator('.app-browser').waitFor({ timeout: 15_000 });
    await loginDemo(p);

    // S5: Main layout — All instances
    await snap(p, 'S5-main-layout');

    // S5b: Engine selected
    const engineRow = p.locator('.tree-item--engine').first();
    if (await engineRow.count() > 0) {
      await engineRow.click();
      await p.waitForTimeout(400);
      await snap(p, 'S5b-engine-selected');
    } else {
      console.log('⚠ No engine row found — skipping S5b');
    }

    // S5c: Disk selected
    const diskRow = p.locator('.tree-item--disk').first();
    if (await diskRow.count() > 0) {
      await diskRow.click();
      await p.waitForTimeout(400);
      await snap(p, 'S5c-disk-selected');
    } else {
      console.log('⚠ No disk row found — skipping S5c');
    }

    // S7: Empty disk panel
    const emptyBadge = p.locator('.tree-item__type-badge--empty').first();
    if (await emptyBadge.count() > 0) {
      // Click the parent tree-item (the disk row containing the badge)
      await emptyBadge.locator('xpath=..').click();
      await p.waitForTimeout(400);
      await snap(p, 'S7-empty-disk-panel');
    } else {
      console.log('⚠ No empty disk in demo data — skipping S7');
    }

    // S8: Restore / Backup disk panel
    const backupBadge = p.locator('.tree-item__type-badge--backup').first();
    if (await backupBadge.count() > 0) {
      await backupBadge.locator('xpath=..').click();
      await p.waitForTimeout(400);
      await snap(p, 'S8-restore-panel');
    } else {
      console.log('⚠ No backup disk in demo data — skipping S8');
    }

    // S5-ops: Operation progress + live log panel
    // First go back to All instances view to make sure OperationProgress is visible
    await p.locator('.tree-item--network').click();
    await p.waitForTimeout(400);
    const opProgress = p.locator('.operation-progress');
    if (await opProgress.count() > 0) {
      // Expand the log on the running operation card
      const logToggle = p.locator('.operation-card__log-toggle').first();
      if (await logToggle.count() > 0) {
        await logToggle.click();
        await p.waitForTimeout(300);
      }
      await snap(p, 'S5-operation-progress');
    } else {
      console.log('⚠ No operation-progress element — skipping S5-operation-progress');
    }

    // S5-command-history: Command history panel (collapsed and expanded)
    const cmdHistory = p.locator('.command-history');
    if (await cmdHistory.count() > 0) {
      await snap(p, 'S5-command-history');
      // Expand the first trace row
      const firstRow = p.locator('.command-history__row').first();
      if (await firstRow.count() > 0) {
        await firstRow.click();
        await p.waitForTimeout(300);
        await snap(p, 'S5-command-history-expanded');
      }
    } else {
      console.log('⚠ No command-history element — skipping S5-command-history');
    }

    // S6: Operator management
    await p.locator('.status-bar__operator-mgmt-btn').click();
    await p.locator('.operator-mgmt').waitFor({ timeout: 5_000 });
    await snap(p, 'S6-operator-management');
    await p.locator('.status-bar__operator-mgmt-btn').click(); // close

    // S2: Settings — engine tab
    await p.locator('.status-bar__settings-btn').click();
    await p.locator('.settings-panel').waitFor({ timeout: 5_000 });
    await snap(p, 'S2-settings-engine');

    // S2b: Settings — account tab
    await p.locator('.settings-panel__tab').filter({ hasText: 'Account' }).click();
    await p.waitForTimeout(300);
    await snap(p, 'S2b-settings-account');

    // S2c: Settings — about tab
    await p.locator('.settings-panel__tab').filter({ hasText: 'About' }).click();
    await p.waitForTimeout(300);
    await snap(p, 'S2c-settings-about');

    await p.close();
  }

  await browser.close();

  const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.png'));
  console.log(`\n✅ Done — ${files.length} screenshots in ${OUT_DIR}`);
  files.forEach(f => console.log(`   ${f}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
