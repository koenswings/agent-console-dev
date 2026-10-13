/**
 * r57 FAIL@35 (Stage 2): the real Console Open put Kiwix on http://idea03.local:18480 while the harness pin
 * (DURATION_KIWIX_URL) was http://idea03:18480. kiwixPage matched by exact origin → "no Kiwix tab".
 * Tabs now match by the pinned port plus any host form of the App's engine (bare, .local, LAN IP,
 * Tailscale IP — DURATION_<APP>_HOSTS), so Console #139 (Open via engine.lanAddress) keeps working.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { appKindForUrl, isSidecarUrlFor, sidecarHostForms } from '../e2e/intents/sidecarUrls';
import { isKiwixTabUrl, kiwixPage } from '../e2e/intents/wikipedia';
import { leaveAppToConsole } from '../e2e/intents/operatorDeepActions';

const BOOK = 'duration_wikipedia_en_grade5a_stub_2026-10';
const KEYS = ['KIWIX', 'NEXTCLOUD', 'KOLIBRI'].flatMap((a) => [`DURATION_${a}_URL`, `DURATION_${a}_HOSTS`, `DURATION_${a}_PORT`]);
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
});

/** Stage 2 harness pins (r57): store URL + every host form of the engine. */
const stage2Pins = () => {
  process.env.DURATION_KIWIX_URL = 'http://idea03:18480';
  process.env.DURATION_KIWIX_HOSTS = 'idea03,idea03.local,10.99.0.13,100.126.117.80';
  process.env.DURATION_NEXTCLOUD_URL = 'http://idea03:61820';
  process.env.DURATION_NEXTCLOUD_HOSTS = 'idea03,idea03.local,10.99.0.13,100.126.117.80';
  process.env.DURATION_KOLIBRI_URL = 'http://100.108.39.45:18080';
  process.env.DURATION_KOLIBRI_HOSTS = 'idea04,idea04.local,10.99.0.14,100.108.39.45';
};

const ctx = (urls: string[]) => {
  const pages: { url: () => string; close: () => Promise<void>; closed?: boolean }[] = [];
  const ctxObj = { pages: () => pages };
  for (const u of urls) {
    const p = { url: () => u, context: () => ctxObj, close: vi.fn(async () => {}) } as never;
    pages.push(p);
  }
  return pages as unknown as Page[];
};

describe('r57 step-35 replay: kiwixPage finds the Console-Open tab on any host form', () => {
  it('idea03.local:18480 tab with pin idea03:18480 → found (was: "no Kiwix tab")', () => {
    stage2Pins();
    const [consolePage, kiwix] = ctx(['http://idea01:8080/', `http://idea03.local:18480/viewer#${BOOK}/Main_Page`]);
    expect(kiwixPage(consolePage!, 'idea#166 search_browse_wikipedia')).toBe(kiwix);
  });
  it('Console #139: Open via engine.lanAddress (10.99.0.13:18480) → found', () => {
    stage2Pins();
    const [consolePage, kiwix] = ctx(['http://idea01:8080/', 'http://10.99.0.13:18480/']);
    expect(kiwixPage(consolePage!, 't')).toBe(kiwix);
  });
  it('Tailscale IP and bare name → found; library root (no #viewer) counts', () => {
    stage2Pins();
    expect(isKiwixTabUrl('http://100.126.117.80:18480/', 'http://idea03:18480')).toBe(true);
    expect(isKiwixTabUrl('http://idea03:18480/', 'http://idea03:18480')).toBe(true);
  });
  it('another engine on the same port, or the NC port on the Kiwix engine → not Kiwix', () => {
    stage2Pins();
    expect(isKiwixTabUrl('http://idea01:18480/', 'http://idea03:18480')).toBe(false);
    expect(isKiwixTabUrl('http://idea01.local:18480/', 'http://idea03:18480')).toBe(false);
    expect(isKiwixTabUrl('http://idea03.local:61820/login', 'http://idea03:18480')).toBe(false);
    const [consolePage] = ctx(['http://idea01:8080/', 'http://idea01:18380/viewer#x/Main_Page']);
    expect(() => kiwixPage(consolePage!, 't')).toThrow(/no Kiwix tab on http:\/\/idea03:18480/);
  });
});

describe('appKindForUrl: port + host forms (NC, Kolibri moved to idea04, copies)', () => {
  it('Nextcloud on idea03.local:61820 / LAN IP root (before the /login redirect) → nextcloud', () => {
    stage2Pins();
    expect(appKindForUrl('http://idea03.local:61820/')).toBe('nextcloud');
    expect(appKindForUrl('http://10.99.0.13:61820/')).toBe('nextcloud');
    expect(appKindForUrl('http://idea03:61820/')).toBe('nextcloud');
  });
  it('moved Kolibri on idea04 (after step 62): .local / LAN / bare root → kolibri; idea01:18080 root is not this pin', () => {
    stage2Pins();
    expect(appKindForUrl('http://idea04.local:18080/')).toBe('kolibri');
    expect(appKindForUrl('http://10.99.0.14:18080/')).toBe('kolibri');
    expect(isSidecarUrlFor('kolibri', 'http://idea01:18080/')).toBe(false);
  });
  it('a copy on a store port (open_app / open_copied_instance) → kolibri via any host form', () => {
    process.env.DURATION_KOLIBRI_URL = 'http://100.126.117.80:58312';
    process.env.DURATION_KOLIBRI_HOSTS = 'idea03,idea03.local,10.99.0.13,100.126.117.80';
    expect(appKindForUrl('http://idea03.local:58312/')).toBe('kolibri');
    expect(appKindForUrl('http://10.99.0.13:58312/')).toBe('kolibri');
  });
  it('no pin at all: unchanged default-port behaviour', () => {
    expect(appKindForUrl('http://idea01:18380/')).toBe('kiwix');
    expect(appKindForUrl('http://idea01:18280/')).toBe('nextcloud');
    expect(sidecarHostForms('kiwix')).toEqual([]);
  });
});

describe('leaveAppToConsole closes App tabs on store ports (Kiwix library root)', () => {
  it('closes idea03.local:18480/ (was left open: no /viewer#, no known port)', async () => {
    stage2Pins();
    const pages = ctx(['http://idea01:8080/', 'http://idea03.local:18480/']);
    const consolePage = pages[0] as unknown as Record<string, unknown>;
    Object.assign(consolePage, {
      bringToFront: async () => {},
      locator: () => ({ isVisible: async () => false, count: async () => 0, click: async () => {}, first: () => ({}) }),
      waitForTimeout: async () => {},
    });
    await leaveAppToConsole(pages[0]!).catch(() => {});
    expect((pages[1] as unknown as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalled();
  });
});
