/**
 * Wait for Engine store sync so [data-testid=sign-in] leaves "Connecting…"
 * (disabled while props.store is null — AccountScreen / LoginForm).
 *
 * Prefer A: after undock/dock + return_to_start + open_console_as_operator,
 * WS/Automerge can lag; Intents must wait (finite) then loud-fail with diagnostics.
 */
import type { Page } from '@playwright/test';
import { sel } from './selectors';

export type SignInReadyState =
  | 'ready'
  | 'already_logged_in'
  | 'first_time_setup';

export interface WaitForSignInReadyOptions {
  timeoutMs?: number;
  intent?: string;
  /** Poll interval while Connecting… */
  pollMs?: number;
}

const defaultTimeoutMs = (): number => {
  const raw = process.env.DURATION_SIGNIN_READY_MS?.trim();
  if (raw && /^[0-9]+$/.test(raw)) return Math.max(5_000, parseInt(raw, 10));
  return 60_000;
};

/** Snapshot connection chrome for loud-fail messages. */
export async function collectConnectionDiagnostics(page: Page): Promise<string> {
  const bits: string[] = [];
  try {
    bits.push(`url=${page.url()}`);
  } catch {
    bits.push('url=?');
  }

  const statusText = await page
    .locator('[data-testid="status-bar-indicator"], .status-bar__indicator')
    .innerText()
    .catch(() => '');
  if (statusText) bits.push(`statusBar=${JSON.stringify(statusText.replace(/\s+/g, ' ').trim())}`);

  const demo = await page.locator('.status-bar__demo-badge').isVisible().catch(() => false);
  bits.push(`DEMO=${demo}`);

  const signIn = page.locator(sel.signIn).first();
  if (await signIn.count()) {
    const text = ((await signIn.textContent()) ?? '').trim();
    const disabled = await signIn.isDisabled().catch(() => true);
    bits.push(`signInText=${JSON.stringify(text)} disabled=${disabled}`);
  } else {
    bits.push('signIn=missing');
  }

  const hint = await page
    .locator('.form-field__hint, .account-screen__section')
    .filter({ hasText: /Waiting for engine|Connecting/i })
    .first()
    .innerText()
    .catch(() => '');
  if (hint) bits.push(`hint=${JSON.stringify(hint.replace(/\s+/g, ' ').trim().slice(0, 120))}`);

  const ws = await page
    .evaluate(() => {
      // Best-effort: no public WS handle; report online + localStorage demo/host
      return {
        onLine: navigator.onLine,
        demoMode: localStorage.getItem('demoMode'),
        engineHostname: localStorage.getItem('engineHostname'),
      };
    })
    .catch(() => null);
  if (ws) {
    bits.push(
      `onLine=${ws.onLine} demoMode=${ws.demoMode ?? 'null'} engineHostname=${ws.engineHostname ?? 'null'}`,
    );
  }

  return bits.join(' | ');
}

/**
 * Wait until login is actionable, first-time setup is up, or operator already in.
 */
export async function waitForSignInReady(
  page: Page,
  opts: WaitForSignInReadyOptions = {},
): Promise<SignInReadyState> {
  const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs();
  const pollMs = opts.pollMs ?? 500;
  const intent = opts.intent ?? 'sign_in';
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // First-time setup takes precedence
    if (await page.locator(sel.firstTimeSetup).isVisible().catch(() => false)) {
      return 'first_time_setup';
    }

    // Already operator (session restore) — Account shows Change Password / Log out
    const loggedIn =
      (await page.locator(sel.logOut).isVisible().catch(() => false)) ||
      ((await page.locator(sel.changePasswordForm).isVisible().catch(() => false)) &&
        !(await page.locator(sel.loginForm).isVisible().catch(() => false)));
    if (loggedIn) return 'already_logged_in';

    const form = page.locator(sel.loginForm);
    if (await form.isVisible().catch(() => false)) {
      const btn = page.locator(sel.signIn).first();
      if (await btn.count()) {
        const text = ((await btn.textContent()) ?? '').trim();
        const disabled = await btn.isDisabled().catch(() => true);
        // Ready when enabled and not Connecting… / Verifying…
        if (!disabled && /^log in$/i.test(text)) {
          return 'ready';
        }
      } else {
        // Form without sign-in testid — any enabled submit
        const submit = form.locator('button[type="submit"]').first();
        if (await submit.count()) {
          const text = ((await submit.textContent()) ?? '').trim();
          const disabled = await submit.isDisabled().catch(() => true);
          if (!disabled && !/connecting/i.test(text)) return 'ready';
        }
      }
    }

    await page.waitForTimeout(pollMs);
  }

  const diag = await collectConnectionDiagnostics(page);
  throw new Error(
    `idea#168 ${intent}: timed out ${timeoutMs}ms waiting for Engine store sync ` +
      `(sign-in left "Connecting…" / disabled). After dock/undock, WS may lag — ` +
      `increase DURATION_SIGNIN_READY_MS or ensure Engine Automerge is up. Diagnostics: ${diag}`,
  );
}

/**
 * Fill operator login and submit once sign-in is ready.
 * Returns 'already_logged_in' if no form needed.
 */
export async function performOperatorSignIn(
  page: Page,
  opts: WaitForSignInReadyOptions & {
    username?: string;
    password?: string;
  } = {},
): Promise<SignInReadyState> {
  const username =
    opts.username ||
    process.env.DURATION_OPERATOR_USERNAME?.trim() ||
    'admin';
  const password =
    opts.password ||
    process.env.DURATION_OPERATOR_PASSWORD?.trim() ||
    'admin911!';

  // Ensure Account / login surface
  if (
    !(await page.locator(sel.loginForm).isVisible().catch(() => false)) &&
    !(await page.locator(sel.firstTimeSetup).isVisible().catch(() => false)) &&
    !(await page.locator(sel.logOut).isVisible().catch(() => false))
  ) {
    if (await page.locator(sel.accountBtn).count()) {
      await page.locator(sel.accountBtn).click();
      await page.locator(sel.opEntry).waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    }
  }

  const state = await waitForSignInReady(page, opts);
  if (state === 'already_logged_in') return state;
  if (state === 'first_time_setup') return state;

  const form = page.locator(sel.loginForm);
  await form.waitFor({ state: 'visible', timeout: 5_000 });
  await form.locator('input[autocomplete="username"]').fill(username);
  await form
    .locator('input[autocomplete="current-password"], input[type="password"]')
    .first()
    .fill(password);

  const submit = page.locator(sel.signIn).first();
  if (await submit.isDisabled().catch(() => true)) {
    const diag = await collectConnectionDiagnostics(page);
    throw new Error(
      `idea#168 ${opts.intent ?? 'sign_in'}: sign-in became ready then disabled again before click. ${diag}`,
    );
  }
  await submit.click();
  return 'ready';
}
