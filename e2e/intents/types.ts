/**
 * Playwright Intent adapter types (idea#166 / duration-tests.md).
 * Intent names are snake_case action keys from Axle's YAML / ACTIONS.md.
 */
import type { Page } from '@playwright/test';

/** Context the walker passes into an Intent (ids never by position). */
export interface IntentContext {
  page: Page;
  /** Disk id (defaults to Kid duration-kolibri-grade5a-001 when omitted). */
  diskId?: string;
  /** Engine id. */
  engineId?: string;
  /** Instance id (defaults to Kid kolibri/nextcloud grade5a-001 per Intent). */
  instanceId?: string;
}

/** One Intent: named click sequence matching a YAML `action:` key. */
export type IntentFn = (ctx: IntentContext) => Promise<void>;

/**
 * Console Intent names registered in e2e/intents (idea#166 Phase 1–3).
 * Engine-owned infra_* and enter_infra_fleet_walk are NOT registered here.
 * Keys match Axle ACTIONS.md / school-day.yaml.
 */
export const CONSOLE_INTENT_NAMES = [
  // Hub
  'open_console_as_teacher',
  'open_console_as_learner',
  'open_console_as_operator',
  'return_to_start',
  // Minimal usage dwell
  'stay_on_teacher_overview',
  'stay_on_learner_overview',
  // Phase 3 — open App from overview (Kid fixture IDs)
  'open_kolibri_as_teacher',
  'open_kolibri_as_learner',
  'open_nextcloud_as_teacher',
  'open_nextcloud_as_learner',
  // Phase 3 — thin operator deeper path
  'open_disk_inventory',
  'open_instance_controls',
] as const;

export type ConsoleIntentName = (typeof CONSOLE_INTENT_NAMES)[number];
