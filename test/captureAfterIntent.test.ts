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

const makePage = (overrides: Record<string, unknown> = {}) => {
  const screenshot = vi.fn(async (opts: { path: string; fullPage?: boolean }) => {
    mkdirSync(dirname(opts.path), { recursive: true });
    writeFileSync(opts.path, Buffer.from('fake-png'));
    return Buffer.from('fake-png');
  });
  return {
    waitForLoadState: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
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

  it('defaults settleMs to 300 and screenshots viewport (fullPage: false)', async () => {
    expect(CAPTURE_AFTER_INTENT_DEFAULT_SETTLE_MS).toBe(300);
    const page = makePage();
    const path = join(dir, 'step-0001-open_app.png');
    await captureAfterIntent(page, { path, intent: 'open_app' });
    expect(page.waitForLoadState).toHaveBeenCalledWith('domcontentloaded', expect.any(Object));
    expect(page.waitForTimeout).toHaveBeenCalledWith(300);
    expect(page.screenshot).toHaveBeenCalledWith({ path, fullPage: false });
    expect(existsSync(path)).toBe(true);
  });

  it('honours custom settleMs', async () => {
    const page = makePage();
    const path = join(dir, 'step-0002.png');
    await captureAfterIntent(page, { path, settleMs: 0 });
    expect(page.waitForTimeout).not.toHaveBeenCalled();
    expect(page.screenshot).toHaveBeenCalledWith({ path, fullPage: false });
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
    const path = join(dir, 'step-0004-exit_lesson.png');
    const result = await runDurationIntent({
      action: 'exit_lesson',
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
