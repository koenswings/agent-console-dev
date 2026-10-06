/**
 * Hub Intents: open Console as teacher / learner / operator (idea#166/#168).
 *
 * Teacher and learner share user-mode AppBrowser (`console-overview`).
 * Operator lands on Account / login (`op-entry`) ready for Sign in.
 *
 * Prefer A live (:8080): never force demoMode / bootDemo reload — that tears
 * down the Engine WS right after dock/undock and leaves sign-in on Connecting…
 */
import type { Page } from '@playwright/test';
import type { IntentFn } from './types';
import { sel } from './selectors';
import { waitForSignInReady } from './signInReady';
import { waitForUserOverviewCatalog } from './stayOnOverview';

const bootDemo = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    localStorage.setItem('demoMode', 'true');
    localStorage.removeItem('engineHostname');
  });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
};

/** True when walking live Engine Console (Prefer A) — no demo boot. */
export function isLiveDurationConsole(
  page: Page,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.DURATION_LIVE === '1' || env.DURATION_LIVE === 'true') return true;
  if (env.DURATION_CONSOLE_URL?.trim()) return true;
  try {
    const u = page.url();
    // Engine-hosted Console (Prefer A fleet)
    if (/:8080\b/.test(u)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Ensure Console page without forcing demo reconnect on live.
 */
export async function ensureConsoleSurface(page: Page): Promise<'live' | 'demo'> {
  if (isLiveDurationConsole(page)) {
    const envUrl = process.env.DURATION_CONSOLE_URL?.trim();
    await page.addInitScript(() => {
      // Prefer A: never boot demo on Engine :8080
      localStorage.setItem('demoMode', 'false');
    });
    let u = '';
    try {
      u = page.url();
    } catch {
      u = '';
    }
    const needsGoto =
      !u ||
      u === 'about:blank' ||
      u.startsWith('about:') ||
      (envUrl ? !u.includes(new URL(envUrl).host) : false);
    if (needsGoto) {
      await page.goto(envUrl || '/', { waitUntil: 'domcontentloaded' });
    }
    // Already on live Console — do NOT reload (avoids WS reconnect storm after dock)
    return 'live';
  }
  await bootDemo(page);
  return 'demo';
}

/**
 * Leave an operator session so AppBrowser (`console-overview`) can render.
 * cover-all-b5de16a-r13: after infra_move_disk + return_to_start the walk is still
 * on op-overview; open_console_as_teacher waited 15s for console-overview and never
 * logged out. return_to_start correctly accepts op-overview for operator walks — the
 * role switch belongs here.
 *
 * Prefer A: same Account → Log out path as `log_out`, then close Account so the
 * Switch falls through to AppBrowser (Account Match sits above main layout).
 */
export async function ensureUserModeOverview(page: Page, intentTag: string): Promise<void> {
  if (await page.locator(sel.consoleOverview).isVisible().catch(() => false)) {
    return;
  }

  const opVisible = await page.locator(sel.opOverview).isVisible().catch(() => false);
  const statusUserVisible = await page
    .locator('.status-bar__username')
    .isVisible()
    .catch(() => false);
  const accountOpen = await page.locator(sel.opEntry).isVisible().catch(() => false);
  const logoutVisible =
    accountOpen && (await page.locator(sel.logOut).count().catch(() => 0)) > 0;
  const loginVisible =
    accountOpen && (await page.locator(sel.loginForm).isVisible().catch(() => false));

  // Already logged out but Account overlay still covering AppBrowser.
  if (!opVisible && !statusUserVisible && !logoutVisible && loginVisible) {
    await page.locator(sel.accountBtn).click();
    return;
  }

  if (!opVisible && !statusUserVisible && !logoutVisible) {
    // Not an operator session — caller waits for console-overview as usual.
    return;
  }

  if (!accountOpen) {
    await page.locator(sel.accountBtn).click();
  }
  try {
    await page.locator(sel.opEntry).waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    throw new Error(
      `idea#168 ${intentTag}: operator session active but Account (op-entry) did not open ` +
        `after account-btn (op-overview=${opVisible} statusUser=${statusUserVisible}). Prefer A.`,
    );
  }

  const logout = page.locator(sel.logOut);
  if ((await logout.count().catch(() => 0)) > 0) {
    await logout.click();
    try {
      await page.locator(sel.loginForm).waitFor({ state: 'visible', timeout: 10_000 });
    } catch {
      const stillOp = await page.locator(sel.opOverview).isVisible().catch(() => false);
      throw new Error(
        `idea#168 ${intentTag}: clicked log-out but login-form not visible within 10s ` +
          `(op-overview still=${stillOp}). Prefer A.`,
      );
    }
  } else if (!(await page.locator(sel.loginForm).isVisible().catch(() => false))) {
    throw new Error(
      `idea#168 ${intentTag}: Account open but neither log-out nor login-form visible — ` +
        `cannot leave operator. Prefer A.`,
    );
  }

  // Account Match is above AppBrowser; close it so console-overview can show.
  await page.locator(sel.accountBtn).click();

  try {
    await page.locator(sel.consoleOverview).waitFor({ state: 'visible', timeout: 15_000 });
  } catch {
    const stillOp = await page.locator(sel.opOverview).isVisible().catch(() => false);
    const stillEntry = await page.locator(sel.opEntry).isVisible().catch(() => false);
    const stillLogin = await page.locator(sel.loginForm).isVisible().catch(() => false);
    throw new Error(
      `idea#168 ${intentTag}: left operator but console-overview not visible within 15s ` +
        `(op-overview=${stillOp} op-entry=${stillEntry} login-form=${stillLogin}). Prefer A.`,
    );
  }
}

const openConsoleAsUser = async (page: Page, intent: 'open_console_as_teacher' | 'open_console_as_learner') => {
  await ensureConsoleSurface(page);
  await ensureUserModeOverview(page, intent);
  await page.locator(sel.consoleOverview).waitFor({ state: 'visible', timeout: 15_000 });
  try {
    await page.locator(sel.accountBtn).waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    throw new Error(
      `idea#168 ${intent}: console-overview visible but account-btn missing. Prefer A.`,
    );
  }
  await waitForUserOverviewCatalog(page, intent);
};

/**
 * Prefer A r40/r13: leave operator if needed, then overview shell + catalog ready
 * (Path B open_* must not mask empty catalog for later stay_on_*).
 */
export const open_console_as_teacher: IntentFn = async ({ page }) => {
  await openConsoleAsUser(page, 'open_console_as_teacher');
};

export const open_console_as_learner: IntentFn = async ({ page }) => {
  await openConsoleAsUser(page, 'open_console_as_learner');
};

export const open_console_as_operator: IntentFn = async ({ page }) => {
  await ensureConsoleSurface(page);
  const account = page.locator(sel.accountBtn);
  await account.waitFor({ state: 'visible', timeout: 15_000 });
  await account.click();
  await page.locator(sel.opEntry).waitFor({ state: 'visible', timeout: 15_000 });

  // Wait for store sync — do not OK while sign-in says Connecting…
  const state = await waitForSignInReady(page, {
    intent: 'open_console_as_operator',
  });
  if (state === 'already_logged_in') {
    // Session restored — Account already operator; OK for walk
    return;
  }
  if (state === 'first_time_setup') {
    await page.locator(sel.firstTimeSetup).waitFor({ state: 'visible', timeout: 5_000 });
    return;
  }
  await page.locator(sel.loginForm).waitFor({ state: 'visible', timeout: 5_000 });
  // sign-in enabled (Log in) — ready for sign_in / retry_login
};
