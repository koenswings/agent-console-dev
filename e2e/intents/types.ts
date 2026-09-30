/**
 * Playwright Intent adapter types (idea#166 / duration-tests.md).
 * Intent names are snake_case action keys from Axle's YAML (locked).
 */
import type { Page } from '@playwright/test';

/** Context the walker passes into an Intent (ids never by position). */
export interface IntentContext {
  page: Page;
  /** Optional disk id for disk-scoped Intents (later Phase 3). */
  diskId?: string;
  /** Optional engine id. */
  engineId?: string;
  /** Optional instance id. */
  instanceId?: string;
}

/** One Intent: named click sequence matching a YAML `action:` key. */
export type IntentFn = (ctx: IntentContext) => Promise<void>;

/**
 * Axle-locked Hub + minimal usage Console Intent names (idea#166).
 * Engine-owned infra_* and enter_infra_fleet_walk are NOT registered here.
 */
export const CONSOLE_INTENT_NAMES = [
  'open_console_as_teacher',
  'open_console_as_learner',
  'open_console_as_operator',
  'stay_on_teacher_overview',
  'stay_on_learner_overview',
  'return_to_start',
] as const;

export type ConsoleIntentName = (typeof CONSOLE_INTENT_NAMES)[number];
