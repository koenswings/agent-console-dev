/**
 * Post-Intent viewport screenshot for Axle --record-walk (idea#168).
 *
 * Locked contract with Engine PlaywrightUiDriver soft-detect:
 *   captureAfterIntent(page, { path, intent?, settleMs? })
 *
 * Settle once here (domcontentloaded → optional networkidle → settleMs).
 * Engine must NOT add a second settle wait when this export exists / when
 * runDurationIntent already wrote the PNG via screenshotPath.
 *
 * Screenshot: fullPage: false (viewport only — stitch-friendly for walk.mp4).
 * Engine fallback may use fullPage: true; this hook stays viewport.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Page } from '@playwright/test';

export const CAPTURE_AFTER_INTENT_DEFAULT_SETTLE_MS = 300;

export interface CaptureAfterIntentOptions {
  /** Absolute or relative path for the PNG. */
  path: string;
  /** YAML action key (for diagnostics / future overlays). */
  intent?: string;
  /** Extra settle after load states (default 300ms). */
  settleMs?: number;
}

/**
 * Wait for a settled DOM, then write a viewport PNG to opts.path.
 * Best-effort load waits — never throws solely because networkidle timed out.
 */
export async function captureAfterIntent(
  page: Page,
  opts: CaptureAfterIntentOptions,
): Promise<void> {
  const settleMs = opts.settleMs ?? CAPTURE_AFTER_INTENT_DEFAULT_SETTLE_MS;
  const outPath = opts.path;
  if (!outPath) {
    throw new Error('idea#168 captureAfterIntent: opts.path is required');
  }

  mkdirSync(dirname(outPath), { recursive: true });

  // Settle once — Engine soft-detect skips a second wait when PNG already exists
  // or when this function is invoked from captureFrame.
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 });
  } catch {
    /* page may already be idle / closed-ish — still try screenshot */
  }
  try {
    await page.waitForLoadState('networkidle', { timeout: 5_000 });
  } catch {
    /* networkidle is optional; many SPAs never go fully idle */
  }
  if (settleMs > 0) {
    await page.waitForTimeout(settleMs);
  }

  await page.screenshot({
    path: outPath,
    fullPage: false, // viewport — stitch-friendly; Engine fallback may differ
  });
}
