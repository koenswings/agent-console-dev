import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Page } from '@playwright/test';
import {
  overviewCatalogTimeoutMs,
  isConnectingStatusLabel,
  isOverviewCatalogReady,
  waitForUserOverviewCatalog,
  OVERVIEW_CATALOG_DEFAULT_MS,
} from '../e2e/intents/stayOnOverview';

describe('overviewCatalogTimeoutMs (Prefer A r40)', () => {
  it('defaults to 180s for cold WS/catalog sync (cover-all-1dee371-r10 ~127s)', () => {
    expect(overviewCatalogTimeoutMs({})).toBe(180_000);
    expect(OVERVIEW_CATALOG_DEFAULT_MS).toBe(180_000);
  });

  it('DURATION_OVERVIEW_CATALOG_MS override', () => {
    expect(overviewCatalogTimeoutMs({ DURATION_OVERVIEW_CATALOG_MS: '45000' })).toBe(
      45_000,
    );
  });

  it('rejects values below 5s floor', () => {
    expect(overviewCatalogTimeoutMs({ DURATION_OVERVIEW_CATALOG_MS: '1000' })).toBe(
      5_000,
    );
  });
});

describe('isConnectingStatusLabel', () => {
  it('detects Connecting… / Searching…', () => {
    expect(isConnectingStatusLabel('Connecting…')).toBe(true);
    expect(isConnectingStatusLabel('Searching…')).toBe(true);
    expect(isConnectingStatusLabel('100.99.231.94')).toBe(false);
    expect(isConnectingStatusLabel('idea01')).toBe(false);
  });
});

describe('isOverviewCatalogReady (Prefer A)', () => {
  it('ready when not connecting and ≥1 instance card or Open button', () => {
    expect(isOverviewCatalogReady({ status: 'idea01', instanceCards: 2, openButtons: 0 })).toBe(true);
    expect(isOverviewCatalogReady({ status: 'idea01', instanceCards: 0, openButtons: 2 })).toBe(true);
  });
  it('never ready while Connecting… or with an empty catalog', () => {
    expect(isOverviewCatalogReady({ status: 'Connecting…', instanceCards: 2, openButtons: 2 })).toBe(false);
    expect(isOverviewCatalogReady({ status: 'idea01', instanceCards: 0, openButtons: 0 })).toBe(false);
  });
});

/** Fake Console page: catalog state as a function of fake time since start. */
function fakeConsole(stateAt: (elapsedMs: number) => { status: string; cards: number; open: number }) {
  const t0 = Date.now();
  const s = () => stateAt(Date.now() - t0);
  const reads: string[] = [];
  const page = {
    locator: (selector: string) => ({
      waitFor: async () => {},
      innerText: async () => {
        reads.push(selector);
        if (selector.includes('hostname')) return s().status;
        return s().status;
      },
      count: async () => {
        if (selector.includes('open-instance-')) return s().open;
        if (selector.includes('instance-')) return s().cards;
        return 0;
      },
    }),
    waitForTimeout: async (ms: number) => {
      vi.setSystemTime(Date.now() + ms);
    },
    url: () => 'http://idea01:8080/',
    evaluate: async () => ({}),
  };
  return { page: page as unknown as Page, reads };
}

describe('waitForUserOverviewCatalog', () => {
  const env = { ...process.env };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T14:30:00Z'));
    process.env.DURATION_OVERVIEW_CATALOG_MS = '10000';
  });
  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...env };
  });

  it('returns when cards appear within the budget', async () => {
    const { page } = fakeConsole((ms) => (ms < 3_000 ? { status: 'Connecting…', cards: 0, open: 0 } : { status: 'idea01', cards: 2, open: 2 }));
    await expect(waitForUserOverviewCatalog(page, 'open_console_as_teacher')).resolves.toBeUndefined();
  });

  it('final read after the budget: ready predicate met → returns (r10: cards=2 connecting=false)', async () => {
    // Ready only once the 10s budget has fully elapsed (slow last iteration).
    const { page } = fakeConsole((ms) => (ms < 10_000 ? { status: 'Connecting…', cards: 0, open: 0 } : { status: 'idea01', cards: 2, open: 2 }));
    await expect(waitForUserOverviewCatalog(page, 'open_console_as_teacher')).resolves.toBeUndefined();
  });

  it('Open buttons alone count as a populated catalog', async () => {
    const { page } = fakeConsole(() => ({ status: 'idea01', cards: 0, open: 2 }));
    await expect(waitForUserOverviewCatalog(page, 'open_console_as_teacher')).resolves.toBeUndefined();
  });

  it('still loud-fails on an empty catalog (no soft-pass)', async () => {
    const { page } = fakeConsole(() => ({ status: 'idea01', cards: 0, open: 0 }));
    await expect(waitForUserOverviewCatalog(page, 'open_console_as_teacher')).rejects.toThrow(
      /overview catalog not ready after 10000ms\. status="idea01" instanceCards=0 openButtons=0 connecting=false/,
    );
  });

  it('still loud-fails while Connecting… persists', async () => {
    const { page } = fakeConsole(() => ({ status: 'Connecting…', cards: 2, open: 2 }));
    await expect(waitForUserOverviewCatalog(page, 'open_console_as_learner')).rejects.toThrow(/connecting=true/);
  });
});
