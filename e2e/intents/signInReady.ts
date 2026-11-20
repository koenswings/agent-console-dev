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

/**
 * One bounded, atomic DOM read of the sign-in surface (Markov seed 42, random-mixed-bf8ef1a-5805bb0 step 1,
 * open_console_as_operator: raw "locator.textContent: Timeout 30000ms exceeded" on [data-testid="sign-in"] instead
 * of the 60 s loud-fail below).
 *
 * The old loop did `btn.count()` then `btn.textContent()` (and `isVisible()` / `isDisabled()` round trips between):
 * every such call has Playwright's own 30 s default, outside this loop's deadline. If the button is gone or the page
 * does not answer when the second call runs (remount while the Console swaps views as the Engine store lands, or a
 * main thread busy syncing the big shared doc), `textContent()` waits 30 s and throws, aborting a step the loop
 * would have passed a moment later. Now: ONE `page.evaluate` per poll, raced against a short budget; a throw or a
 * stall is just "no reading" and the loop retries until its own deadline, so the loud failure stays the only exit.
 */
export interface SignInControl { text: string; disabled: boolean }
export interface SignInDomSnapshot {
  firstTimeSetupVisible: boolean;
  logOutVisible: boolean;
  changePasswordVisible: boolean;
  loginFormVisible: boolean;
  /** First [data-testid=sign-in] in the document, or null when absent. */
  signIn: SignInControl | null;
  /** First button[type=submit] inside the login form, or null when absent. */
  submit: SignInControl | null;
}

/** Per-poll budget for the DOM read; the loop's own deadline stays the only way out. */
export const SIGNIN_READ_TIMEOUT_MS = 2_000;

export interface SignInDomPage {
  evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>;
}

export async function readSignInDom(
  page: SignInDomPage,
  readTimeoutMs: number = SIGNIN_READ_TIMEOUT_MS,
): Promise<{ snap: SignInDomSnapshot | null; error: string | null }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = page.evaluate(
      (s: Record<string, string>): SignInDomSnapshot => {
        // No nested named functions: tsx/esbuild keepNames would inject __name into the page.
        const vis = [s.firstTimeSetup, s.logOut, s.changePasswordForm, s.loginForm].map((q) => {
          const e = document.querySelector(q);
          if (!e) return false;
          if (typeof (e as Element & { checkVisibility?: unknown }).checkVisibility === 'function') {
            return (e as Element & { checkVisibility: (o: object) => boolean }).checkVisibility({ visibilityProperty: true });
          }
          const cs = getComputedStyle(e);
          return cs.display !== 'none' && cs.visibility !== 'hidden';
        });
        const ctl = [document.querySelector(s.signIn), document.querySelector(`${s.loginForm} button[type="submit"]`)].map((b) =>
          b ? { text: (b.textContent ?? '').trim(), disabled: (b as HTMLButtonElement).disabled === true } : null,
        );
        return {
          firstTimeSetupVisible: vis[0]!,
          logOutVisible: vis[1]!,
          changePasswordVisible: vis[2]!,
          loginFormVisible: vis[3]!,
          signIn: ctl[0] ?? null,
          submit: ctl[1] ?? null,
        };
      },
      {
        firstTimeSetup: sel.firstTimeSetup,
        logOut: sel.logOut,
        changePasswordForm: sel.changePasswordForm,
        loginForm: sel.loginForm,
        signIn: sel.signIn,
      },
    );
    read.catch(() => {}); // a read abandoned by the race must not become an unhandled rejection
    const stalled = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`sign-in DOM read did not answer within ${readTimeoutMs}ms`)), readTimeoutMs);
    });
    return { snap: await Promise.race([read, stalled]), error: null };
  } catch (e) {
    return { snap: null, error: e instanceof Error ? e.message.split('\n')[0]! : String(e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The loop's decision from one snapshot (same precedence as before): null = keep waiting. */
export function decideSignInReady(s: SignInDomSnapshot): SignInReadyState | null {
  if (s.firstTimeSetupVisible) return 'first_time_setup';
  if (s.logOutVisible || (s.changePasswordVisible && !s.loginFormVisible)) return 'already_logged_in';
  if (!s.loginFormVisible) return null;
  if (s.signIn) {
    // Ready when enabled and not Connecting… / Verifying…
    return !s.signIn.disabled && /^log in$/i.test(s.signIn.text) ? 'ready' : null;
  }
  // Form without sign-in testid — any enabled submit
  if (s.submit) return !s.submit.disabled && !/connecting/i.test(s.submit.text) ? 'ready' : null;
  return null;
}

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
    .innerText({ timeout: SIGNIN_READ_TIMEOUT_MS })
    .catch(() => '');
  if (statusText) bits.push(`statusBar=${JSON.stringify(statusText.replace(/\s+/g, ' ').trim())}`);

  const preview = await page.locator('.status-bar__preview-badge').isVisible().catch(() => false);
  bits.push(`PREVIEW=${preview}`);

  // Bounded like the loop: diagnostics must never turn the loud failure into another 30 s Playwright timeout.
  const { snap, error } = await readSignInDom(page);
  if (snap?.signIn) {
    bits.push(`signInText=${JSON.stringify(snap.signIn.text)} disabled=${snap.signIn.disabled}`);
  } else if (snap) {
    bits.push('signIn=missing');
  } else {
    bits.push(`signIn=unreadable (${error ?? 'no answer'})`);
  }

  const hint = await page
    .locator('.form-field__hint, .account-screen__section')
    .filter({ hasText: /Waiting for engine|Connecting/i })
    .first()
    .innerText({ timeout: SIGNIN_READ_TIMEOUT_MS })
    .catch(() => '');
  if (hint) bits.push(`hint=${JSON.stringify(hint.replace(/\s+/g, ' ').trim().slice(0, 120))}`);

  // page.evaluate has no timeout of its own: race it so a stalled page cannot hang the loud failure.
  const ws = await Promise.race([
    page.evaluate(() => {
      // Best-effort: no public WS handle; report online + localStorage preview/host
      return {
        onLine: navigator.onLine,
        previewMode: localStorage.getItem('previewMode'),
        demoMode: localStorage.getItem('demoMode'),
        engineHostname: localStorage.getItem('engineHostname'),
      };
    }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), SIGNIN_READ_TIMEOUT_MS)),
  ]).catch(() => null);
  if (ws) {
    bits.push(
      `onLine=${ws.onLine} previewMode=${ws.previewMode ?? 'null'} demoMode=${ws.demoMode ?? 'null'} engineHostname=${ws.engineHostname ?? 'null'}`,
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

  let readFailures = 0;
  let lastReadError: string | null = null;
  while (Date.now() < deadline) {
    const { snap, error } = await readSignInDom(page);
    if (snap) {
      const state = decideSignInReady(snap);
      if (state) return state;
    } else {
      // Transient detach / remount / stalled page: just retry; the deadline below still ends the wait loudly.
      readFailures++;
      lastReadError = error;
    }
    await page.waitForTimeout(pollMs);
  }

  const diag = await collectConnectionDiagnostics(page);
  throw new Error(
    `idea#168 ${intent}: timed out ${timeoutMs}ms waiting for Engine store sync ` +
      `(sign-in left "Connecting…" / disabled). After dock/undock, WS may lag — ` +
      `increase DURATION_SIGNIN_READY_MS or ensure Engine Automerge is up. ` +
      `${readFailures ? `${readFailures} sign-in DOM read(s) failed or stalled (last: ${lastReadError ?? '?'}). ` : ''}Diagnostics: ${diag}`,
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
  if (await submit.isDisabled({ timeout: SIGNIN_READ_TIMEOUT_MS }).catch(() => true)) {
    const diag = await collectConnectionDiagnostics(page);
    throw new Error(
      `idea#168 ${opts.intent ?? 'sign_in'}: sign-in became ready then disabled again before click. ${diag}`,
    );
  }
  await submit.click();
  return 'ready';
}
