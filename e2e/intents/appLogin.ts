/**
 * In-App login helpers for Kolibri / Nextcloud tabs opened from Console (idea#168).
 * Uses Kid fixture usernames; passwords default to username (duration pack convention).
 *
 * Kolibri 0.15 auth is two-step: Username → NEXT → Password → SIGN IN.
 */
import type { Page } from '@playwright/test';

export interface AppCredentials {
  username: string;
  password: string;
}

/**
 * Attempt facility/app login on an App tab. No-ops if already signed in
 * (no username field). Throws only when a login form is visible but submit fails.
 */
export const attemptAppLogin = async (
  app: Page,
  creds: AppCredentials,
  opts?: { timeoutMs?: number },
): Promise<'logged_in' | 'already_in' | 'no_form'> => {
  const timeout = opts?.timeoutMs ?? 12_000;

  // Already in coach/learn/facility?
  try {
    const url = app.url();
    if (/\/(coach|learn|facility|device|profile)\//i.test(url) && !/signin|auth/i.test(url)) {
      return 'already_in';
    }
  } catch {
    /* ignore */
  }

  const user = app.locator(
    'input[autocomplete="username"], input[name="username"], input#id_username, input[type="text"]',
  ).first();

  try {
    await user.waitFor({ state: 'visible', timeout });
  } catch {
    return 'no_form';
  }

  if (!(await user.count())) return 'no_form';

  await user.fill(creds.username);

  // Kolibri two-step: NEXT then password
  const next = app.getByRole('button', { name: /^next$/i });
  if (await next.count()) {
    await next.first().click();
  }

  const pass = app.locator(
    'input[type="password"], input[name="password"], input[autocomplete="current-password"], input#id_password',
  ).first();
  try {
    await pass.waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    // Single-step forms (Nextcloud): password may already have been visible
    if (!(await pass.count())) return 'no_form';
  }

  await pass.fill(creds.password);

  const submit = app.locator(
    'button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("SIGN IN"), button:has-text("Log in"), button:has-text("Login")',
  ).first();
  if (await submit.count()) {
    await submit.click();
  } else {
    await pass.press('Enter');
  }

  await app.waitForTimeout(1200);
  return 'logged_in';
};
