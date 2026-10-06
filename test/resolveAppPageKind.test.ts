/**
 * cover-all-8c8fe30-r9 FAIL@21: after a Kolibri learner segment, open_nextcloud_as_learner
 * must not treat the leftover Kolibri tab as Nextcloud.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Page } from '@playwright/test';
import { resolveAppPage, isAppTabOfKind, openAppInstance } from '../e2e/intents/openApp';
import { appKindForUrl } from '../e2e/intents/sidecarUrls';

const CONSOLE = 'http://idea01:8080/';
const KOLIBRI = 'http://idea01:18080/en/device/#/content';
const NC = 'http://idea01:18280/apps/files/';

type FakePage = {
  url: () => string;
  isClosed: () => boolean;
  context: () => { pages: () => FakePage[] };
};

function makeContext(urls: string[]) {
  const pages: FakePage[] = [];
  const ctx = { pages: () => pages.filter((p) => !p.isClosed()) };
  for (const u of urls) {
    pages.push({ url: () => u, isClosed: () => false, context: () => ctx });
  }
  return { consolePage: pages[0]! as unknown as Page, pages };
}

describe('resolveAppPage kind-aware (Prefer A, cover-all r9)', () => {
  it('without kind: newest App tab (legacy)', () => {
    const { consolePage, pages } = makeContext([CONSOLE, KOLIBRI, NC]);
    expect(resolveAppPage(consolePage)).toBe(pages[2]);
  });

  it('with kind=nextcloud: skips leftover Kolibri, returns Nextcloud', () => {
    const { consolePage, pages } = makeContext([CONSOLE, KOLIBRI, NC]);
    expect(resolveAppPage(consolePage, 'nextcloud')).toBe(pages[2]);
    expect(isAppTabOfKind(pages[2]! as unknown as Page, consolePage, 'nextcloud')).toBe(true);
    expect(isAppTabOfKind(pages[1]! as unknown as Page, consolePage, 'nextcloud')).toBe(false);
  });

  it('with kind=nextcloud and only Kolibri leftover: returns Console (not Kolibri)', () => {
    // cover-all-8c8fe30-r9: leave_kolibri / return_to_start left :18080 open
    const { consolePage, pages } = makeContext([CONSOLE, KOLIBRI]);
    const got = resolveAppPage(consolePage, 'nextcloud');
    expect(got).toBe(consolePage);
    expect(got).not.toBe(pages[1]);
    expect(appKindForUrl((pages[1] as FakePage).url())).toBe('kolibri');
  });

  it('with kind=kolibri: skips Nextcloud, returns Kolibri', () => {
    const { consolePage, pages } = makeContext([CONSOLE, NC, KOLIBRI]);
    expect(resolveAppPage(consolePage, 'kolibri')).toBe(pages[2]);
  });
});

describe('openAppInstance kind-aware (leftover Kolibri must not short-circuit Nextcloud)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T14:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('opens Path B Nextcloud when only a Kolibri leftover tab is open', async () => {
    const { consolePage, pages } = makeContext([CONSOLE, KOLIBRI]);
    const opened: string[] = [];
    const ncPage: FakePage = {
      url: () => NC,
      isClosed: () => false,
      context: () => (consolePage as unknown as FakePage).context(),
    };
    // Path A Open missing; Path B newPage -> NC
    const req = {
      get: async () => ({ status: () => 200 }),
    };
    Object.assign(consolePage, {
      locator: () => ({
        count: async () => 0,
        isVisible: async () => false,
        isDisabled: async () => true,
        getAttribute: async () => null,
        first: () => ({
          isVisible: async () => false,
          isDisabled: async () => true,
          getAttribute: async () => null,
        }),
        or: () => ({ first: () => ({ waitFor: async () => {} }) }),
      }),
      waitForTimeout: async (ms: number) => {
        vi.setSystemTime(Date.now() + ms);
      },
      request: req,
      context: () => ({
        pages: () => pages.filter((p) => !p.isClosed()),
        waitForEvent: async () => null,
        newPage: async () => {
          pages.push(ncPage);
          opened.push('newPage');
          return {
            ...ncPage,
            goto: async (u: string) => {
              opened.push(u);
              return { status: () => 200 };
            },
            close: async () => {},
            waitForLoadState: async () => {},
          };
        },
      }),
    });

    const got = await openAppInstance(consolePage, 'nextcloud-grade5a-001', 'nextcloud');
    expect(opened).toContain('newPage');
    expect(opened.some((u) => u.includes(':18280'))).toBe(true);
    expect(got.url()).toBe(NC);
    expect(got.url()).not.toContain(':18080');
  });
});
