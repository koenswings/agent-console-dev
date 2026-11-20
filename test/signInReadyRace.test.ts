/**
 * Markov seed 42, random-mixed-bf8ef1a-5805bb0-markov-20261120, step 1 open_console_as_operator: the step died with a raw
 * "locator.textContent: Timeout 30000ms exceeded ... [data-testid="sign-in"]" instead of waitForSignInReady's own
 * 60 s loud failure, although the Console showed a rendered Operator Login. The loop did count() then textContent()
 * (+ isVisible/isDisabled round trips), each with Playwright's 30 s default outside the loop's deadline.
 * Now every poll is ONE bounded page.evaluate; a throw or a stall is "no reading" and the loop retries.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  decideSignInReady,
  readSignInDom,
  waitForSignInReady,
  type SignInDomSnapshot,
} from '../e2e/intents/signInReady';
import { readEraseCommandMarker } from '../e2e/intents/operatorActions';

const loginPage = (btn: { text: string; disabled?: boolean } | null = { text: 'Log in' }) => {
  document.body.innerHTML = `<div data-testid="op-entry"><form data-testid="login-form">${
    btn ? `<button type="submit" data-testid="sign-in"${btn.disabled ? ' disabled' : ''}>${btn.text}</button>` : ''
  }</form></div>`;
};

const snap = (over: Partial<SignInDomSnapshot> = {}): SignInDomSnapshot => ({
  firstTimeSetupVisible: false,
  logOutVisible: false,
  changePasswordVisible: false,
  loginFormVisible: true,
  signIn: { text: 'Log in', disabled: false },
  submit: null,
  ...over,
});

/**
 * Fake Playwright page over jsdom. `script` decides what each page.evaluate does: 'ok' runs it against the DOM,
 * 'throw' rejects like a detached/destroyed context, 'hang' never answers (stalled main thread).
 * Any locator-level read throws: the intent must not use them (they carry the 30 s default).
 */
const fakePage = (script: Array<'ok' | 'throw' | 'hang'> | ((n: number) => 'ok' | 'throw' | 'hang')) => {
  let n = 0;
  const calls = { evaluate: 0, waits: 0, locatorReads: 0 };
  const locator = () => {
    const l: Record<string, unknown> = {};
    for (const m of ['count', 'textContent', 'isDisabled', 'isVisible', 'getAttribute']) {
      l[m] = async () => { calls.locatorReads++; throw new Error(`locator.${m}: Timeout 30000ms exceeded`); };
    }
    l.innerText = async () => { throw new Error('no element'); };
    l.filter = () => l;
    l.first = () => l;
    return l;
  };
  const page = {
    calls,
    url: () => 'http://idea01:8080/',
    locator,
    waitForTimeout: async () => { calls.waits++; await new Promise((r) => setTimeout(r, 1)); },
    evaluate: async <R, A>(fn: (a: A) => R, arg: A): Promise<R> => {
      calls.evaluate++;
      const step = typeof script === 'function' ? script(n) : script[Math.min(n, script.length - 1)]!;
      n++;
      if (step === 'throw') throw new Error('page.evaluate: Execution context was destroyed, most likely because of a navigation\nCall log: ...');
      if (step === 'hang') return new Promise<R>(() => {});
      return fn(arg);
    },
  };
  return page;
};

describe('readSignInDom (one atomic, bounded read)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('reads visibility, text and disabled of the sign-in button in one evaluate', async () => {
    loginPage({ text: 'Connecting…', disabled: true });
    const page = fakePage(['ok']);
    const { snap: s, error } = await readSignInDom(page);
    expect(error).toBeNull();
    expect(s).toMatchObject({ loginFormVisible: true, logOutVisible: false, signIn: { text: 'Connecting…', disabled: true } });
    expect(page.calls.evaluate).toBe(1);
    expect(page.calls.locatorReads).toBe(0);
  });

  it('absent button / form: nulls and false, never waits', async () => {
    document.body.innerHTML = '';
    const { snap: s } = await readSignInDom(fakePage(['ok']));
    expect(s).toEqual({ firstTimeSetupVisible: false, logOutVisible: false, changePasswordVisible: false, loginFormVisible: false, signIn: null, submit: null });
  });

  it('a throwing evaluate is "no reading" with the first error line', async () => {
    const r = await readSignInDom(fakePage(['throw']));
    expect(r.snap).toBeNull();
    expect(r.error).toBe('page.evaluate: Execution context was destroyed, most likely because of a navigation');
  });

  it('a stalled page (evaluate never answers) gives up after the per-read budget instead of hanging', async () => {
    const t0 = Date.now();
    const r = await readSignInDom(fakePage(['hang']), 30);
    expect(r.snap).toBeNull();
    expect(r.error).toMatch(/did not answer within 30ms/);
    expect(Date.now() - t0).toBeLessThan(1_000);
  });
});

describe('decideSignInReady (same precedence as the old loop)', () => {
  it('ready only when enabled and exactly "Log in"', () => {
    expect(decideSignInReady(snap())).toBe('ready');
    expect(decideSignInReady(snap({ signIn: { text: 'Connecting…', disabled: true } }))).toBeNull();
    expect(decideSignInReady(snap({ signIn: { text: 'Verifying…', disabled: false } }))).toBeNull();
    expect(decideSignInReady(snap({ signIn: { text: 'Log in', disabled: true } }))).toBeNull();
  });
  it('first-time setup wins; logged in via Log out or Change Password without the login form', () => {
    expect(decideSignInReady(snap({ firstTimeSetupVisible: true }))).toBe('first_time_setup');
    expect(decideSignInReady(snap({ logOutVisible: true }))).toBe('already_logged_in');
    expect(decideSignInReady(snap({ changePasswordVisible: true, loginFormVisible: false }))).toBe('already_logged_in');
    expect(decideSignInReady(snap({ changePasswordVisible: true, loginFormVisible: true }))).toBe('ready');
  });
  it('form without the sign-in testid: any enabled, non-connecting submit', () => {
    expect(decideSignInReady(snap({ signIn: null, submit: { text: 'Sign in', disabled: false } }))).toBe('ready');
    expect(decideSignInReady(snap({ signIn: null, submit: { text: 'Connecting…', disabled: false } }))).toBeNull();
    expect(decideSignInReady(snap({ signIn: null, submit: null }))).toBeNull();
    expect(decideSignInReady(snap({ loginFormVisible: false }))).toBeNull();
  });
});

describe('waitForSignInReady (seed 42 step 1)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('a read that throws (remount / destroyed context) is retried and the step passes', async () => {
    loginPage();
    const page = fakePage(['throw', 'throw', 'ok']);
    await expect(waitForSignInReady(page as never, { timeoutMs: 5_000, pollMs: 1 })).resolves.toBe('ready');
    expect(page.calls.evaluate).toBe(3);
    expect(page.calls.locatorReads).toBe(0); // no 30 s-default locator reads in the loop
  });

  it('Connecting… then Log in: keeps polling, returns ready', async () => {
    loginPage({ text: 'Connecting…', disabled: true });
    const page = fakePage((n) => { if (n === 3) loginPage(); return 'ok'; });
    await expect(waitForSignInReady(page as never, { timeoutMs: 5_000, pollMs: 1 })).resolves.toBe('ready');
    expect(page.calls.evaluate).toBeGreaterThanOrEqual(4);
  });

  it('operator already signed in is still recognised', async () => {
    document.body.innerHTML = '<button data-testid="log-out">Log out</button>';
    await expect(waitForSignInReady(fakePage(['ok']) as never, { timeoutMs: 5_000, pollMs: 1 })).resolves.toBe('already_logged_in');
  });

  it('still loud: reads that never succeed end with the 60 s-style timeout error (here 300 ms), naming the failed reads', async () => {
    const t0 = Date.now();
    const page = fakePage(['throw']);
    const err = await waitForSignInReady(page as never, { timeoutMs: 300, pollMs: 20, intent: 'open_console_as_operator' }).catch((e) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/idea#168 open_console_as_operator: timed out 300ms waiting for Engine store sync/);
    expect((err as Error).message).toMatch(/\d+ sign-in DOM read\(s\) failed or stalled \(last: page\.evaluate: Execution context was destroyed/);
    expect((err as Error).message).toMatch(/Diagnostics: url=http:\/\/idea01:8080\/ .*signIn=unreadable/);
    expect(Date.now() - t0).toBeLessThan(5_000); // no 30 s Playwright wait hides inside the loud failure
  });

  it('still loud with a stuck "Connecting…" button (no read failures noted)', async () => {
    loginPage({ text: 'Connecting…', disabled: true });
    const err = await waitForSignInReady(fakePage(['ok']) as never, { timeoutMs: 200, pollMs: 20 }).catch((e) => e as Error);
    expect((err as Error).message).toMatch(/timed out 200ms waiting for Engine store sync/);
    expect((err as Error).message).not.toMatch(/DOM read\(s\) failed/);
    expect((err as Error).message).toMatch(/signInText="Connecting…" disabled=true/);
  });
});

describe('readEraseCommandMarker (analogous count()-then-getAttribute poll read)', () => {
  const markerPage = (attrs: Record<string, string> | null, failAfterCount = false) => ({
    locator: () => ({
      count: async () => (attrs ? 1 : 0),
      getAttribute: async (a: string, o?: { timeout?: number }) => {
        if (failAfterCount) throw new Error(`locator.getAttribute: Timeout ${o?.timeout ?? 30000}ms exceeded`);
        return attrs?.[a] ?? null;
      },
    }),
  });
  it('reads the marker', async () => {
    expect(await readEraseCommandMarker(markerPage({ 'data-seq': '4', 'data-status': 'ok' }) as never)).toEqual({ seq: 4, status: 'ok', error: null });
  });
  it('marker vanished between count() and getAttribute(): null, not a thrown timeout', async () => {
    expect(await readEraseCommandMarker(markerPage({ 'data-seq': '4', 'data-status': 'ok' }, true) as never)).toBeNull();
    expect(await readEraseCommandMarker(markerPage(null) as never)).toBeNull();
  });
});
