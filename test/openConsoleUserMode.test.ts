import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Page } from '@playwright/test';
import { ensureUserModeOverview } from '../e2e/intents/openConsole';
import { sel } from '../e2e/intents/selectors';

/**
 * Fake Console shell: operator (op-overview) ↔ Account overlay ↔ user (console-overview).
 * Mirrors App.tsx Switch: Account Match sits above main layout / AppBrowser.
 */
function fakeConsoleShell(start: 'user' | 'operator' | 'account-login') {
  let mode: 'operator' | 'user' = start === 'operator' ? 'operator' : 'user';
  let accountOpen = start === 'account-login';
  let loggedIn = start === 'operator';
  const clicks: string[] = [];

  const visible = (selector: string): boolean => {
    if (selector === sel.consoleOverview) return mode === 'user' && !accountOpen;
    if (selector === sel.opOverview) return mode === 'operator' && !accountOpen;
    if (selector === sel.opEntry) return accountOpen;
    if (selector === sel.loginForm) return accountOpen && !loggedIn;
    if (selector === sel.logOut) return accountOpen && loggedIn;
    if (selector === sel.accountBtn) return true;
    if (selector === '.status-bar__username') return loggedIn && mode === 'operator';
    return false;
  };

  const locator = (selector: string) => {
    const self = {
      async isVisible() {
        return visible(selector);
      },
      async count() {
        return visible(selector) ? 1 : 0;
      },
      async waitFor(opts: { state: string; timeout?: number }) {
        const wantVisible = opts.state === 'visible';
        if (visible(selector) === wantVisible) return;
        throw new Error(`waitFor ${selector} state=${opts.state} timeout`);
      },
      async click() {
        clicks.push(selector);
        if (selector === sel.accountBtn) {
          accountOpen = !accountOpen;
          return;
        }
        if (selector === sel.logOut) {
          if (!accountOpen || !loggedIn) throw new Error('log-out not available');
          loggedIn = false;
          mode = 'user';
          // Account stays open showing login-form (App.tsx Account Match)
          accountOpen = true;
          return;
        }
      },
    };
    return self;
  };

  const page = {
    locator,
    url: () => 'http://idea01:8080/',
    waitForTimeout: async (ms: number) => {
      vi.setSystemTime(Date.now() + ms);
    },
  };

  return {
    page: page as unknown as Page,
    clicks,
    snapshot: () => ({ mode, accountOpen, loggedIn }),
  };
}

describe('ensureUserModeOverview (cover-all-b5de16a-r13)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T15:30:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('already on console-overview → no logout click', async () => {
    const f = fakeConsoleShell('user');
    await ensureUserModeOverview(f.page, 'open_console_as_teacher');
    expect(f.clicks).toEqual([]);
    expect(f.snapshot()).toEqual({ mode: 'user', accountOpen: false, loggedIn: false });
  });

  it('on op-overview → Account → log-out → close Account → console-overview', async () => {
    const f = fakeConsoleShell('operator');
    await ensureUserModeOverview(f.page, 'open_console_as_teacher');
    expect(f.clicks).toEqual([sel.accountBtn, sel.logOut, sel.accountBtn]);
    expect(f.snapshot()).toEqual({ mode: 'user', accountOpen: false, loggedIn: false });
  });

  it('Account already open on login-form (post-logout) → just closes Account', async () => {
    const f = fakeConsoleShell('account-login');
    await ensureUserModeOverview(f.page, 'open_console_as_learner');
    expect(f.clicks).toEqual([sel.accountBtn]);
    expect(f.snapshot().accountOpen).toBe(false);
    expect(f.snapshot().mode).toBe('user');
  });

  it('loud-fails with idea#168 when log-out does not yield login-form', async () => {
    const f = fakeConsoleShell('operator');
    // Break logout: click log-out but keep loggedIn by monkey-patching
    const realLocator = f.page.locator.bind(f.page);
    f.page.locator = ((selector: string) => {
      const loc = realLocator(selector);
      if (selector === sel.logOut) {
        return {
          ...loc,
          count: async () => 1,
          click: async () => {
            f.clicks.push(sel.logOut);
            // pretend click did nothing
          },
        };
      }
      if (selector === sel.loginForm) {
        return {
          ...loc,
          isVisible: async () => false,
          waitFor: async () => {
            throw new Error('waitFor login-form timeout');
          },
          count: async () => 0,
        };
      }
      return loc;
    }) as typeof f.page.locator;

    await expect(ensureUserModeOverview(f.page, 'open_console_as_teacher')).rejects.toThrow(
      /idea#168 open_console_as_teacher: clicked log-out but login-form not visible/,
    );
  });
});
