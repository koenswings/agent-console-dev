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

export const open_console_as_teacher: IntentFn = async ({ page }) => {
  await ensureConsoleSurface(page);
  await page.locator(sel.consoleOverview).waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator(sel.accountBtn).waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
};

export const open_console_as_learner: IntentFn = async ({ page }) => {
  await ensureConsoleSurface(page);
  await page.locator(sel.consoleOverview).waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator(sel.accountBtn).waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
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
