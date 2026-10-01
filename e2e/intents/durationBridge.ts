/**
 * Engine ↔ Console Playwright bridge (idea#168 Phase 3).
 *
 * Axle's duration runner (`test/duration/ui/`) should call `runDurationIntent`
 * with the YAML `action` key and a Playwright `Page` (plus optional ids).
 *
 * Import (from a sibling clone or path mapping):
 *   import { runDurationIntent, intentRegistry, CONSOLE_INTENT_NAMES }
 *     from 'idea-console/duration-intents';
 *   // or: from '../../agent-console-dev/e2e/intents/durationBridge'
 *
 * With stubUi:false, Engine dispatchAction should invoke this instead of uiStub.
 */
import type { Page } from '@playwright/test';
import { getIntent, intentRegistry, CONSOLE_INTENT_NAMES } from './registry';
import type { IntentContext, ConsoleIntentName } from './types';

export interface DurationIntentResult {
  ok: boolean;
  message?: string;
  /** Intent was registered in Console registry. */
  registered: boolean;
}

export interface RunDurationIntentOptions {
  page: Page;
  /** YAML action key — must match ACTIONS.md / CONSOLE_INTENT_NAMES. */
  action: string;
  diskId?: string;
  engineId?: string;
  instanceId?: string;
}

/**
 * Run one Console Intent by locked action name.
 * Returns ok:false for unknown / Engine-owned / deferred keys (does not throw
 * on unknown — Engine decides whether to fail the walk).
 */
export async function runDurationIntent(
  opts: RunDurationIntentOptions,
): Promise<DurationIntentResult> {
  const { action, page, diskId, engineId, instanceId } = opts;
  const fn = getIntent(action);
  if (!fn) {
    return {
      ok: false,
      registered: false,
      message:
        `Console Intent '${action}' not registered (Engine-owned infra_*, deferred ` +
        `keep_watching/next_resource/exit_lesson/finish_exercise/next_video/open_wikipedia_*, or unknown)`,
    };
  }
  const ctx: IntentContext = { page, diskId, engineId, instanceId };
  try {
    await fn(ctx);
    return { ok: true, registered: true, message: `ran ${action}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, registered: true, message: msg };
  }
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
