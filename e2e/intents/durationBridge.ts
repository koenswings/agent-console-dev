/**
 * Engine ↔ Console Playwright bridge (idea#168 Phase 3).
 *
 * Axle's duration runner (`test/duration/ui/`) should call `runDurationIntent`
 * with the YAML `action` key and a Playwright `Page` (plus optional ids).
 *
 * --record-walk soft-detect (Engine PlaywrightUiDriver):
 *   1) pass screenshotPath into runDurationIntent (we write viewport PNG here)
 *   2) else bridge.captureAfterIntent(page, { path, intent?, settleMs? })
 *   3) else page.screenshot({ path, fullPage: true })  // Engine fallback
 *
 * When screenshotPath is set we settle + capture once inside this call so
 * Engine's post-Intent captureFrame sees the file and skips a second settle.
 */
import type { Page } from '@playwright/test';
import { getIntent, intentRegistry, CONSOLE_INTENT_NAMES } from './registry';
import type { IntentContext, ConsoleIntentName } from './types';
import { captureAfterIntent } from './captureAfterIntent';

export interface DurationIntentResult {
  ok: boolean;
  message?: string;
  /** Intent was registered in Console registry. */
  registered: boolean;
  /** PNG written when screenshotPath was requested. */
  screenshotPath?: string;
}

export interface RunDurationIntentOptions {
  page: Page;
  /** YAML action key — must match ACTIONS.md / CONSOLE_INTENT_NAMES. */
  action: string;
  diskId?: string;
  engineId?: string;
  instanceId?: string;
  /**
   * When set (--record-walk), capture a viewport PNG after the Intent attempt
   * (success or fail) via captureAfterIntent. Engine soft-detects the file.
   */
  screenshotPath?: string;
}

/**
 * Run one Console Intent by locked action name.
 * Returns ok:false for unknown / Engine-owned / deferred keys (does not throw
 * on unknown — Engine decides whether to fail the walk).
 */
export async function runDurationIntent(
  opts: RunDurationIntentOptions,
): Promise<DurationIntentResult> {
  const { action, page, diskId, engineId, instanceId, screenshotPath } = opts;
  const fn = getIntent(action);
  if (!fn) {
    const miss: DurationIntentResult = {
      ok: false,
      registered: false,
      message:
        `Console Intent '${action}' not registered (Engine-owned infra_* or unknown)`,
    };
    // Still capture when recording — useful to see Console state on miss
    if (screenshotPath) {
      try {
        await captureAfterIntent(page, { path: screenshotPath, intent: action });
        miss.screenshotPath = screenshotPath;
      } catch {
        /* ignore capture errors on unregistered */
      }
    }
    return miss;
  }
  const ctx: IntentContext = { page, diskId, engineId, instanceId };
  let result: DurationIntentResult;
  try {
    await fn(ctx);
    result = { ok: true, registered: true, message: `ran ${action}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result = { ok: false, registered: true, message: msg };
  }

  if (screenshotPath) {
    try {
      await captureAfterIntent(page, { path: screenshotPath, intent: action });
      result.screenshotPath = screenshotPath;
    } catch (capErr) {
      const capMsg = capErr instanceof Error ? capErr.message : String(capErr);
      result.message = `${result.message ?? ''} [captureAfterIntent failed: ${capMsg}]`.trim();
      // Do not flip ok solely due to capture failure — Intent outcome stands
    }
  }
  return result;
}

/** True when Console owns a Playwright adapter for this action key. */
export function hasDurationIntent(action: string): boolean {
  return typeof getIntent(action) === 'function';
}

export {
  intentRegistry,
  getIntent,
  CONSOLE_INTENT_NAMES,
  type ConsoleIntentName,
  type IntentContext,
};

export {
  captureAfterIntent,
  CAPTURE_AFTER_INTENT_DEFAULT_SETTLE_MS,
  type CaptureAfterIntentOptions,
} from './captureAfterIntent';
