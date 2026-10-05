/**
 * Dwell Intents: teacher / learner / operator overview (idea#166/#168).
 * Prefer A r40: wait leave Connecting… + catalog sync before assert
 * (cold WS ~15s; open_console Path B can mask empty catalog).
 */
import type { Page } from '@playwright/test';
import type { IntentFn } from './types';
import { sel } from './selectors';
import { collectConnectionDiagnostics } from './signInReady';

/**
 * Prefer A catalog settle budget (DURATION_OVERVIEW_CATALOG_MS).
 * Default 180s: r40 cold connect showed cards by ~15s, but cover-all-1dee371-r10
 * (store_mode unique + fresh Console redeploy) needed ~127s of cold WS/store sync.
 */
export const OVERVIEW_CATALOG_DEFAULT_MS = 180_000;

export function overviewCatalogTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DURATION_OVERVIEW_CATALOG_MS?.trim();
  if (raw && /^\d+$/.test(raw)) return Math.max(5_000, Number(raw));
  return OVERVIEW_CATALOG_DEFAULT_MS;
}

/** Per-read cap so a missing status element can't eat Playwright's 30s default (r10). */
const STATUS_READ_MS = 1_000;

export async function readStatusBarLabel(page: Page): Promise<string> {
  const host = await page
    .locator(sel.statusBarHostname)
    .innerText({ timeout: STATUS_READ_MS })
    .catch(() => '');
  if (host.trim()) return host.replace(/\s+/g, ' ').trim();
  const ind = await page
    .locator(sel.statusBarIndicator)
    .innerText({ timeout: STATUS_READ_MS })
    .catch(() => '');
  return ind.replace(/\s+/g, ' ').trim();
}

export type OverviewCatalogState = { status: string; instanceCards: number; openButtons: number };

/**
 * Prefer A ready predicate: status left Connecting…/Searching… AND the catalog is
 * populated: ≥1 instance-* card or ≥1 open-instance-* Open button on console-overview
 * (r10 screenshot: kolibri + nextcloud cards with Open). Empty catalog is never ready.
 */
export function isOverviewCatalogReady(s: OverviewCatalogState): boolean {
  return !isConnectingStatusLabel(s.status) && (s.instanceCards >= 1 || s.openButtons >= 1);
}

export async function readOverviewCatalogState(page: Page): Promise<OverviewCatalogState> {
  const status = await readStatusBarLabel(page);
  const instanceCards = await page
    .locator(`${sel.consoleOverview} [data-testid^="instance-"]`)
    .count()
    .catch(() => 0);
  const openButtons = await page
    .locator(`${sel.consoleOverview} [data-testid^="open-instance-"]`)
    .count()
    .catch(() => 0);
  return { status, instanceCards, openButtons };
}

export function isConnectingStatusLabel(label: string): boolean {
  return /connecting|searching/i.test(label);
}

/**
 * Wait until status bar leaves Connecting…/Searching… AND ≥1 instance-* card
 * on console-overview. Shared by open_console_as_teacher/learner + stay_on_*.
 */
export async function waitForUserOverviewCatalog(
  page: Page,
  intent: string,
): Promise<void> {
  await page.locator(sel.consoleOverview).waitFor({ state: 'visible', timeout: 15_000 });
  const budget = overviewCatalogTimeoutMs();
  const started = Date.now();
  let s: OverviewCatalogState = { status: '', instanceCards: 0, openButtons: 0 };

  while (Date.now() - started < budget) {
    s = await readOverviewCatalogState(page);
    // Prefer A: need catalog cards/Open; hostname alone (IP shown) is not enough if empty
    if (isOverviewCatalogReady(s)) {
      await page.waitForTimeout(200);
      return;
    }
    await page.waitForTimeout(400);
  }

  // Final read: r10 threw with instanceCards=2 connecting=false. If the predicate
  // holds now, the catalog IS ready (same check, not a soft-pass).
  s = await readOverviewCatalogState(page);
  if (isOverviewCatalogReady(s)) return;
  const elapsed = Date.now() - started;
  const diag = await collectConnectionDiagnostics(page).catch(() => '');
  throw new Error(
    `idea#168 ${intent}: overview catalog not ready after ${budget}ms. ` +
      `status=${JSON.stringify(s.status)} instanceCards=${s.instanceCards} openButtons=${s.openButtons} ` +
      `connecting=${isConnectingStatusLabel(s.status)} elapsed=${elapsed}ms. ` +
      `Cold WS/store sync (r40 ~15s; r10 ~127s). Prefer A — no soft-pass. ${diag}`,
  );
}

export const stay_on_teacher_overview: IntentFn = async ({ page }) => {
  await waitForUserOverviewCatalog(page, 'stay_on_teacher_overview');
};

export const stay_on_learner_overview: IntentFn = async ({ page }) => {
  await waitForUserOverviewCatalog(page, 'stay_on_learner_overview');
};

/**
 * Operator NetworkTree dwell — Prefer A r40: leave Connecting… then ≥1 disk-*.
 * Budget DURATION_OVERVIEW_CATALOG_MS (same cold-sync headroom).
 */
export const stay_on_overview: IntentFn = async ({ page }) => {
  await page
    .locator(sel.opOverview)
    .or(page.locator(sel.networkTree))
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  if (await page.locator(sel.settingsPanel).isVisible().catch(() => false)) {
    await page.locator(sel.settingsBtn).click().catch(() => {});
  }
  if (await page.locator(sel.opEntry).isVisible().catch(() => false)) {
    await page.locator(sel.accountBtn).click().catch(() => {});
  }
  const tree = page.locator(sel.networkTree);
  await tree.waitFor({ state: 'visible', timeout: 15_000 });
  const engines = tree.locator('[data-testid^="engine-"]');
  const engN = await engines.count();
  for (let i = 0; i < engN; i++) {
    await engines.nth(i).click({ timeout: 3_000 }).catch(() => {});
  }

  const budget = overviewCatalogTimeoutMs();
  const started = Date.now();
  const disks = tree.locator('[data-testid^="disk-"]');
  let count = 0;
  let lastStatus = '';
  while (Date.now() - started < budget) {
    lastStatus = await readStatusBarLabel(page);
    count = await disks.count();
    const connecting = isConnectingStatusLabel(lastStatus);
    if (!connecting && count > 0) {
      await page.waitForTimeout(200);
      return;
    }
    await page.waitForTimeout(400);
  }
  lastStatus = await readStatusBarLabel(page);
  count = await disks.count();
  if (!isConnectingStatusLabel(lastStatus) && count > 0) return; // final read: predicate met
  throw new Error(
    `idea#168 stay_on_overview: NetworkTree catalog not ready after ${budget}ms. ` +
      `status=${JSON.stringify(lastStatus)} diskRows=${count} ` +
      `connecting=${isConnectingStatusLabel(lastStatus)} elapsed=${Date.now() - started}ms. ` +
      `Prefer A — set DURATION_OVERVIEW_CATALOG_MS. No soft empty dwell.`,
  );
};
