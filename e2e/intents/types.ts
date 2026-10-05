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
 * Console Intent names registered in e2e/intents (idea#166 Phase 1–5 / idea#168 harden).
 * Engine-owned infra_* and enter_infra_fleet_walk are NOT registered here.
 * Keys match Axle ACTIONS.md / school-day.yaml; proposal snake_case for
 * Console-owned operator edges not yet listed in ACTIONS.md.
 */
export const CONSOLE_INTENT_NAMES = [
  // Hub
  'open_console_as_teacher',
  'open_console_as_learner',
  'open_console_as_operator',
  'return_to_start',
  // Minimal usage / operator dwell
  'stay_on_teacher_overview',
  'stay_on_learner_overview',
  'stay_on_overview',
  // Phase 3 — open App from overview (Kid fixture IDs)
  'open_kolibri_as_teacher',
  'open_kolibri_as_learner',
  'open_nextcloud_as_teacher',
  'open_nextcloud_as_learner',
  'browse_folders',
  // Phase 5 — Kolibri content (Kid @0bca699 CONTENT.seeded.json)
  'open_video',
  'keep_watching',
  'next_resource',
  'finish_exercise',
  'next_video',
  'exit_lesson',
  'open_exercise',
  // Phase 3 — thin operator deeper path
  'open_disk_inventory',
  'open_instance_controls',
  // Phase 4 — ACTIONS.md eject_disk + proposal operator edges
  'eject_disk',
  'confirm_eject',
  'cancel_eject',
  'erase_disk',
  'confirm_erase',
  'cancel_erase',
  'start_instance',
  'stop_instance',
  'open_account',
  'close_account',
  'open_settings',
  'close_settings',
  'sign_in',
  'make_files_disk',
  'add_files_role',
  // Operator deep (proposal grow — Console UI that exists)
  'install_app',
  'start_after_install',
  'stay_on_disk',
  'make_backup_disk',
  'restore_from_backup',
  'open_app',
  'backup_instance',
  'back_to_disk',
  'back_to_overview',
  'log_out',
  'notice_usb_dock',
  'retry_login_first_time_setup',
  'change_password',
  'add_operator',
  'remove_operator',
  // Multi-disk HTML5 drag + Copy/Move modal (≥2 docked duration disks)
  'copy_app',
  'move_app',
  // Part B — remaining operator edges (ACTIONS.md Pixel-missing operator)
  'files_role_added',
  'backup_configured_restored',
  'done_redistribute',
  'stay_on_source_disk',
  'open_copied_instance',
  'switch_engine',
  'reboot_engine',
  // Usage leave / back (Console-side; App tab close or overview assert)
  'back_to_console',
  'leave_kolibri',
  'leave_nextcloud_as_teacher',
  'leave_nextcloud_as_learner',
  // Kolibri coaching (kolibri_manage — after open_kolibri_as_teacher)
  'create_class',
  'enroll_learners',
  'build_lesson',
  'create_quiz',
  'read_reports',
  'preview_as_learner',
  'browse_classes',
] as const;

export type ConsoleIntentName = (typeof CONSOLE_INTENT_NAMES)[number];
