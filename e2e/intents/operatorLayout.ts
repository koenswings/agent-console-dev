/**
 * Operator layout guard (console#kc10, walk step 133 reboot_engine).
 *
 * kc10 FAIL@133: reboot_engine waited 15 s for op-overview / network-tree BEFORE it
 * closed Settings or Connection Management, so the close branches never ran. And
 * switch_engine (@132) counted "connected, Network tree not on screen" as loaded, so
 * a Console that came back signed out or on another panel passed @132 and only
 * failed @133 with no hint of what was on screen.
 *
 * These helpers close the overlays first, then require the operator layout with
 * Engine rows, and on failure say which screen the Console shows. Prefer A — no
 * soft-pass.
 */
import type { Page } from '@playwright/test';
import { sel } from './selectors';

export type ConsoleScreen = {
  url: string;
  status: string;
  connectedDot: boolean;
  opOverview: boolean;
  networkTree: boolean;
  engineRows: number;
  settings: boolean;
  connectionManagement: boolean;
  account: boolean;
  loginForm: boolean;
};

/** Operator layout is loaded: connected, overview or tree on screen, tree lists Engines. */
export function operatorLayoutLoaded(s: ConsoleScreen): boolean {
  return s.connectedDot && (s.opOverview || s.networkTree) && s.engineRows > 0;
}

/** One plain line naming the screen, for loud-fail messages. */
export function describeConsoleScreen(s: ConsoleScreen): string {
  let screen = 'unknown screen (no operator layout)';
  if (s.connectionManagement) screen = 'Connection Management';
  else if (s.settings) screen = 'Settings';
  else if (s.account) screen = 'Account';
  else if (s.opOverview || s.networkTree) screen = 'operator layout';
  else if (s.loginForm) screen = 'login form (operator signed out)';
  else if (s.connectedDot) screen = 'signed-out App view (operator session lost)';
  return (
    `screen=${screen} url=${s.url} status=${JSON.stringify(s.status)} connected=${s.connectedDot} ` +
    `opOverview=${s.opOverview} networkTree=${s.networkTree} engineRows=${s.engineRows}`
  );
}

const vis = (page: Page, selector: string): Promise<boolean> =>
  page.locator(selector).first().isVisible().catch(() => false);

export async function readConsoleScreen(page: Page): Promise<ConsoleScreen> {
  const networkTree = await vis(page, sel.networkTree);
  return {
    url: page.url(),
    status: ((await page.locator(sel.statusBarHostname).textContent().catch(() => null)) ?? '').trim(),
    connectedDot: (await page.locator('.status-bar__dot--connected').count().catch(() => 0)) > 0,
    opOverview: await vis(page, sel.opOverview),
    networkTree,
    engineRows: networkTree
      ? await page.locator(`${sel.networkTree} .tree-item--engine`).count().catch(() => 0)
      : 0,
    settings: await vis(page, sel.settingsPanel),
    connectionManagement: await vis(page, sel.connectionManagement),
    account: await vis(page, sel.opEntry),
    loginForm: await vis(page, sel.loginForm),
  };
}

/** Close Settings / Connection Management / Account if one covers the operator layout. */
export async function closeOperatorOverlays(page: Page): Promise<void> {
  const s = await readConsoleScreen(page);
  if (s.connectionManagement) await page.locator(sel.connectionMgmtBtn).click().catch(() => {});
  else if (s.settings) await page.locator(sel.settingsBtn).click().catch(() => {});
  else if (s.account && !s.loginForm) await page.locator(sel.accountBtn).click().catch(() => {});
}

/** Default budget for the operator layout to come back (DURATION_OP_LAYOUT_MS). */
export function opLayoutTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.DURATION_OP_LAYOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 60_000;
  return Math.max(5_000, raw);
}

/**
 * Close overlays, then wait until the operator layout lists Engines. Throws with the
 * screen description when it does not. Overlays are re-closed while polling, because
 * a reconnect can re-open Connection Management.
 */
export async function waitForOperatorLayout(
  page: Page,
  context: string,
  budgetMs = opLayoutTimeoutMs(),
  intervalMs = 250,
): Promise<void> {
  const deadline = Date.now() + budgetMs;
  let last = await readConsoleScreen(page);
  for (;;) {
    if (operatorLayoutLoaded(last)) return;
    if (Date.now() >= deadline) break;
    if (last.settings || last.connectionManagement || (last.account && !last.loginForm)) {
      await closeOperatorOverlays(page);
    }
    await page.waitForTimeout(intervalMs);
    last = await readConsoleScreen(page);
  }
  throw new Error(
    `idea#168 ${context}: operator layout with Engine rows not shown within ${budgetMs}ms ` +
      `(${describeConsoleScreen(last)}). Prefer A — no soft-pass.`,
  );
}
