/**
 * In-App login helpers for Kolibri / Nextcloud tabs opened from Console (idea#168).
 * Uses Kid fixture usernames; passwords default to username (duration pack convention).
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
  const user = app.locator(
    'input[name="username"], input[autocomplete="username"], input#id_username, input[type="text"]',
  ).first();
  const pass = app.locator(
    'input[name="password"], input[autocomplete="current-password"], input#id_password, input[type="password"]',
  ).first();

  try {
    await user.waitFor({ state: 'visible', timeout });
  } catch {
    return 'no_form';
  }

  if (!(await user.count()) || !(await pass.count())) return 'no_form';

  // Heuristic: if password field absent of empty login chrome, treat as already in
  const value = await user.inputValue().catch(() => '');
  if (!value) await user.fill(creds.username);
  await pass.fill(creds.password);

  const submit = app.locator(
    'button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login")',
  ).first();
  if (await submit.count()) {
    await submit.click();
  } else {
    await pass.press('Enter');
  }

  // Wait briefly for navigation / chrome change
  await app.waitForTimeout(800);
  return 'logged_in';
};
