/**
 * captureAfterIntent / screenshotPath bridge (idea#168 — Axle --record-walk).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  captureAfterIntent,
  CAPTURE_AFTER_INTENT_DEFAULT_SETTLE_MS,
  runDurationIntent,
  hasDurationIntent,
} from '../e2e/intents';
import {
  isInAppIntent,
  resolveConsolePage,
} from '../e2e/intents/captureAfterIntent';

const makePage = (overrides: Record<string, unknown> = {}) => {
  const screenshot = vi.fn(async (opts: { path: string; fullPage?: boolean }) => {
    mkdirSync(dirname(opts.path), { recursive: true });
    writeFileSync(opts.path, Buffer.from('fake-png'));
    return Buffer.from('fake-png');
  });
  return {
    waitForLoadState: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    bringToFront: vi.fn(async () => undefined),
    screenshot,
    ...overrides,
  } as unknown as import('@playwright/test').Page;
};

describe('captureAfterIntent (Axle soft-detect contract)', () => {
  const dir = join(tmpdir(), `pixel-capture-${Date.now()}`);

  beforeEach(() => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  });

  it('defaults settleMs to 300, brings Console page to front, and screenshots viewport (fullPage: false)', async () => {
    expect(CAPTURE_AFTER_INTENT_DEFAULT_SETTLE_MS).toBe(300);
    const order: string[] = [];
    const page = makePage({
      bringToFront: vi.fn(async () => {
        order.push('bringToFront');
      }),
      waitForLoadState: vi.fn(async (state: string) => {
        order.push(`waitForLoadState:${state}`);
      }),
      waitForTimeout: vi.fn(async () => {
        order.push('waitForTimeout');
      }),
      screenshot: vi.fn(async (opts: { path: string; fullPage?: boolean }) => {
        order.push('screenshot');
        mkdirSync(dirname(opts.path), { recursive: true });
        writeFileSync(opts.path, Buffer.from('fake-png'));
        return Buffer.from('fake-png');
      }),
    });
    const path = join(dir, 'step-0001-open_app.png');
    await captureAfterIntent(page, { path, intent: 'open_app' });
    expect(page.bringToFront).toHaveBeenCalledTimes(1);
    expect(page.waitForLoadState).toHaveBeenCalledWith('domcontentloaded', expect.any(Object));
    expect(page.waitForTimeout).toHaveBeenCalledWith(300);
    expect(page.screenshot).toHaveBeenCalledWith({ path, fullPage: false });
    expect(order[0]).toBe('bringToFront');
    expect(order[order.length - 1]).toBe('screenshot');
    expect(existsSync(path)).toBe(true);
  });

  it('honours custom settleMs and brings Console page to front when intent is omitted', async () => {
    const page = makePage();
    const path = join(dir, 'step-0002.png');
    await captureAfterIntent(page, { path, settleMs: 0 });
    expect(page.bringToFront).toHaveBeenCalledTimes(1);
    expect(page.waitForTimeout).not.toHaveBeenCalled();
    expect(page.screenshot).toHaveBeenCalledWith({ path, fullPage: false });
  });

  it('never throws when bringToFront is missing or rejects', async () => {
    const noMethodPage = makePage({ bringToFront: undefined });
    const path1 = join(dir, 'step-0002a.png');
    await captureAfterIntent(noMethodPage, { path: path1, intent: 'reboot_engine', settleMs: 0 });
    expect(existsSync(path1)).toBe(true);

    const rejectingPage = makePage({
      bringToFront: vi.fn(async () => {
        throw new Error('Target page closed');
      }),
    });
    const path2 = join(dir, 'step-0002b.png');
    await captureAfterIntent(rejectingPage, { path: path2, intent: 'switch_engine', settleMs: 0 });
    expect(rejectingPage.screenshot).toHaveBeenCalledWith({ path: path2, fullPage: false });
    expect(existsSync(path2)).toBe(true);
  });

  it('resolves and focuses the Console page if an active App tab was passed during a Console step', async () => {
    const consolePage = makePage({
      url: () => 'http://idea01:8080/',
      isClosed: () => false,
    });
    const kolibriTab = makePage({
      url: () => 'http://idea01:18080/en/device/#/content',
      isClosed: () => false,
    });
    const ctx = { pages: () => [consolePage, kolibriTab] };
    (consolePage as unknown as { context: () => typeof ctx }).context = () => ctx;
    (kolibriTab as unknown as { context: () => typeof ctx }).context = () => ctx;

    expect(resolveConsolePage(kolibriTab)).toBe(consolePage);
    expect(resolveConsolePage(consolePage)).toBe(consolePage);

    const path = join(dir, 'step-0133-reboot_engine.png');
    await captureAfterIntent(kolibriTab, { path, intent: 'reboot_engine', settleMs: 0 });

    expect(consolePage.bringToFront).toHaveBeenCalledTimes(1);
    expect(consolePage.screenshot).toHaveBeenCalledWith({ path, fullPage: false });
    expect(kolibriTab.bringToFront).not.toHaveBeenCalled();
    expect(kolibriTab.screenshot).not.toHaveBeenCalled();
  });

  it('does not steal foreground focus back to Console during multi-step in-app intents, but still refocuses on leave', async () => {
    expect(isInAppIntent('open_video')).toBe(true);
    expect(isInAppIntent('create_class')).toBe(true);
    expect(isInAppIntent('browse_folders')).toBe(true);
    expect(isInAppIntent('open_app')).toBe(false);
    expect(isInAppIntent('leave_kolibri')).toBe(false);
    expect(isInAppIntent('back_to_console')).toBe(false);

    const consolePage = makePage({ url: () => 'http://idea01:8080/' });
    const inAppPath = join(dir, 'step-0010-open_video.png');
    await captureAfterIntent(consolePage, { path: inAppPath, intent: 'open_video', settleMs: 0 });
    expect(consolePage.bringToFront).not.toHaveBeenCalled();
    expect(consolePage.screenshot).toHaveBeenCalledWith({ path: inAppPath, fullPage: false });

    const leavePath = join(dir, 'step-0011-leave_kolibri.png');
    await captureAfterIntent(consolePage, { path: leavePath, intent: 'leave_kolibri', settleMs: 0 });
    expect(consolePage.bringToFront).toHaveBeenCalledTimes(1);
    expect(consolePage.screenshot).toHaveBeenCalledWith({ path: leavePath, fullPage: false });
  });

  it('runDurationIntent with screenshotPath captures after Intent (registered)', async () => {
    const page = makePage();
    // stay_on_overview is registered and only dwells — will wait for selectors;
    // mock locator chain minimally by making waitFor throw → Intent fails but capture still runs
    const loc = {
      or: () => loc,
      first: () => loc,
      waitFor: vi.fn(async () => {
        throw new Error('no DOM in unit test');
      }),
      isVisible: vi.fn(async () => false),
      count: vi.fn(async () => 0),
    };
    (page as unknown as { locator: () => typeof loc }).locator = () => loc;

    expect(hasDurationIntent('stay_on_overview')).toBe(true);
    const path = join(dir, 'step-0003-stay_on_overview.png');
    const result = await runDurationIntent({
      action: 'stay_on_overview',
      page,
      screenshotPath: path,
    });
    expect(result.registered).toBe(true);
    expect(result.ok).toBe(false); // no DOM
    expect(result.screenshotPath).toBe(path);
    expect(existsSync(path)).toBe(true);
    expect(page.screenshot).toHaveBeenCalledWith({ path, fullPage: false });
  });

  it('runDurationIntent screenshotPath still captures for unregistered actions', async () => {
    const page = makePage();
    const path = join(dir, 'step-0004-infra_dock_fixture.png');
    const result = await runDurationIntent({
      action: 'infra_dock_fixture',
      page,
      screenshotPath: path,
    });
    expect(result.registered).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.screenshotPath).toBe(path);
    expect(existsSync(path)).toBe(true);
  });

  it('exports captureAfterIntent for Engine soft-detect path 2', async () => {
    const { captureAfterIntent: exported } = await import('../e2e/intents');
    expect(typeof exported).toBe('function');
  });
});
