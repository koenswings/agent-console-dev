import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Page } from '@playwright/test';
import { resolveStartInstanceId } from '../e2e/intents/operatorActions';
import { open_app, runOpenApp } from '../e2e/intents/operatorDeepActions';
import {
  open_kolibri_as_teacher,
  open_kolibri_as_learner,
} from '../e2e/intents/openApp';
import {
  open_nextcloud_as_teacher,
  open_nextcloud_as_learner,
} from '../e2e/intents/nextcloudDeep';
import { DURATION_FIXTURES } from '../e2e/intents/fixtures';

type TabRecord = {
  url: string;
  closed: boolean;
  page: Page;
  close: ReturnType<typeof vi.fn>;
  bringToFront: ReturnType<typeof vi.fn>;
};

function makeFakeBrowser(opts: {
  openButtonVisible?: boolean;
  popupUrl?: string;
  popupReturnsNull?: boolean;
  sidecarStatus?: number;
  sidecarGotoThrows?: Error;
  sameTabNav?: boolean;
  bodyText?: string;
  ncUser?: string;
  appGotoUrl?: string;
} = {}) {
  const tabs: TabRecord[] = [];
  const ctxObj = {
    pages: () => tabs.filter((t) => !t.closed).map((t) => t.page),
    on: vi.fn(),
    waitForEvent: vi.fn(async (event: string) => {
      if (event !== 'page' || opts.popupReturnsNull) return null;
      const popup = addTab(opts.popupUrl ?? 'http://idea01:18080/en/device/#/content');
      return popup.page;
    }),
    newPage: vi.fn(async () => {
      const tab = addTab('about:blank');
      return tab.page;
    }),
  };

  function addTab(initialUrl: string): TabRecord {
    const rec: TabRecord = {
      url: initialUrl,
      closed: false,
      close: vi.fn(async () => {
        rec.closed = true;
      }),
      bringToFront: vi.fn(async () => {}),
      page: null as unknown as Page,
    };
    const makeLoc = (selector?: string) => {
      const isOpenBtn = selector?.includes('open-instance-');
      const isBreadcrumbs = selector === '[data-cy-files-content-breadcrumbs]';
      const isHead = selector === 'head';
      const countVal =
        (isOpenBtn && opts.openButtonVisible) || (isBreadcrumbs && opts.ncUser) ? 1 : 0;
      return {
        first: () => makeLoc(selector),
        or: () => makeLoc(selector),
        waitFor: async () => {},
        count: async () => countVal,
        isVisible: async () => Boolean(isOpenBtn && opts.openButtonVisible),
        isDisabled: async () => false,
        getAttribute: async (attr: string) =>
          isHead && attr === 'data-user' ? (opts.ncUser ?? null) : null,
        innerText: async () => opts.bodyText ?? '',
        click: async () => {
          if (isOpenBtn && opts.sameTabNav) {
            rec.url = opts.popupUrl ?? 'http://idea01:18080/en/device/#/content';
          }
        },
      };
    };
    rec.page = {
      url: () => rec.url,
      isClosed: () => rec.closed,
      close: rec.close,
      bringToFront: rec.bringToFront,
      context: () => ctxObj,
      on: vi.fn(),
      waitForLoadState: async () => {},
      waitForTimeout: async (ms: number) => {
        vi.setSystemTime(Date.now() + ms);
      },
      goto: vi.fn(async (u: string) => {
        if (opts.sidecarGotoThrows) throw opts.sidecarGotoThrows;
        rec.url = opts.appGotoUrl ?? u;
        return {
          status: () => opts.sidecarStatus ?? 200,
          url: () => rec.url,
        };
      }),
      request: {
        get: vi.fn(async () => ({ status: () => opts.sidecarStatus ?? 200 })),
      },
      locator: (selector: string) => makeLoc(selector),
    } as unknown as Page;
    tabs.push(rec);
    return rec;
  }

  const consoleTab = addTab('http://idea01:8080/');
  return { consoleTab, tabs, ctxObj };
}

/**
 * open_app / openAppInstance align instance id with start_instance
 * (DURATION_START_INSTANCE_ID / kolibri-grade5a-001).
 */
describe('open_app instance id alignment (Prefer A r18)', () => {
  it('shares resolveStartInstanceId default with start_instance', () => {
    expect(resolveStartInstanceId(undefined, {})).toBe(
      DURATION_FIXTURES.kolibri.instanceId,
    );
    expect(DURATION_FIXTURES.kolibri.instanceId).toBe('kolibri-grade5a-001');
  });

  it('DURATION_START_INSTANCE_ID applies to open path', () => {
    expect(
      resolveStartInstanceId(undefined, {
        DURATION_START_INSTANCE_ID: 'fleet-open-id',
      }),
    ).toBe('fleet-open-id');
  });
});

describe('open_app closes opened App tab and refocuses Console (kc10)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T20:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('closes Path A popup tab and calls page.bringToFront() on Console page', async () => {
    const { consoleTab, tabs } = makeFakeBrowser({ openButtonVisible: true });
    await open_app({ page: consoleTab.page });

    expect(tabs).toHaveLength(2);
    const appTab = tabs[1]!;
    expect(appTab.close).toHaveBeenCalledTimes(1);
    expect(appTab.closed).toBe(true);
    expect(consoleTab.close).not.toHaveBeenCalled();
    expect(consoleTab.bringToFront).toHaveBeenCalledTimes(1);
  });

  it('closes Path B newPage tab and calls page.bringToFront() on Console page', async () => {
    const { consoleTab, tabs } = makeFakeBrowser({ openButtonVisible: false, sidecarStatus: 200 });
    await open_app({ page: consoleTab.page });

    expect(tabs).toHaveLength(2);
    const appTab = tabs[1]!;
    expect(appTab.close).toHaveBeenCalledTimes(1);
    expect(appTab.closed).toBe(true);
    expect(consoleTab.close).not.toHaveBeenCalled();
    expect(consoleTab.bringToFront).toHaveBeenCalledTimes(1);
  });

  it('still closes any newly opened tab and calls page.bringToFront() when openAppInstance throws', async () => {
    // Path A opens an unrecognized popup tab (pick -> null), then Path B fails with HTTP 500
    const { consoleTab, tabs } = makeFakeBrowser({
      openButtonVisible: true,
      popupUrl: 'http://idea01:9999/unexpected',
      sidecarStatus: 500,
    });

    await expect(open_app({ page: consoleTab.page })).rejects.toThrow();

    expect(tabs.length).toBeGreaterThanOrEqual(2);
    for (const extra of tabs.slice(1)) {
      expect(extra.close).toHaveBeenCalled();
      expect(extra.closed).toBe(true);
    }
    expect(consoleTab.close).not.toHaveBeenCalled();
    expect(consoleTab.bringToFront).toHaveBeenCalledTimes(1);
  });

  it('does not close Console page when opener returns Console page itself, still brings to front', async () => {
    const { consoleTab, tabs } = makeFakeBrowser();

    await runOpenApp({ page: consoleTab.page }, async (p) => p);

    expect(tabs).toHaveLength(1);
    expect(consoleTab.close).not.toHaveBeenCalled();
    expect(consoleTab.bringToFront).toHaveBeenCalledTimes(1);
  });

  it('closes opener-created tab and calls bringToFront() when opener throws', async () => {
    const { consoleTab, tabs } = makeFakeBrowser();

    await expect(
      runOpenApp({ page: consoleTab.page }, async (p) => {
        await p.context().newPage();
        throw new Error('post-open check failed');
      }),
    ).rejects.toThrow('post-open check failed');

    expect(tabs).toHaveLength(2);
    expect(tabs[1]!.close).toHaveBeenCalledTimes(1);
    expect(tabs[1]!.closed).toBe(true);
    expect(consoleTab.close).not.toHaveBeenCalled();
    expect(consoleTab.bringToFront).toHaveBeenCalledTimes(1);
  });

  it('preserves multi-step classroom/app intents (leaves App tab open until back_to_console)', async () => {
    const cases = [
      {
        fn: open_kolibri_as_teacher,
        opts: { openButtonVisible: false, sidecarStatus: 200, bodyText: 'Classes Grade 5A' },
      },
      {
        fn: open_kolibri_as_learner,
        opts: { openButtonVisible: false, sidecarStatus: 200 },
      },
      {
        fn: open_nextcloud_as_teacher,
        opts: {
          openButtonVisible: false,
          sidecarStatus: 200,
          ncUser: DURATION_FIXTURES.nextcloud.auth.teacher.username,
          appGotoUrl: 'http://idea01:18280/apps/files/',
        },
      },
      {
        fn: open_nextcloud_as_learner,
        opts: {
          openButtonVisible: false,
          sidecarStatus: 200,
          ncUser: DURATION_FIXTURES.nextcloud.auth.learner.username,
          appGotoUrl: 'http://idea01:18280/apps/files/',
        },
      },
    ];

    for (const { fn, opts } of cases) {
      const { consoleTab, tabs } = makeFakeBrowser(opts);
      await fn({ page: consoleTab.page });
      expect(tabs).toHaveLength(2);
      expect(tabs[1]!.close).not.toHaveBeenCalled();
      expect(tabs[1]!.closed).toBe(false);
    }
  });
});
