/**
 * Intent registry keyed by Axle YAML / ACTIONS.md action names (idea#166).
 * Engine-owned keys (enter_infra_fleet_walk, infra_*) are intentionally absent.
 */
import type { ConsoleIntentName, IntentFn } from './types';
import {
  open_console_as_learner,
  open_console_as_operator,
  open_console_as_teacher,
} from './openConsole';
import {
  stay_on_learner_overview,
  stay_on_overview,
  stay_on_teacher_overview,
} from './stayOnOverview';
import { return_to_start } from './returnToStart';
import {
  open_kolibri_as_learner,
  open_kolibri_as_teacher,
  open_nextcloud_as_learner,
  open_nextcloud_as_teacher,
} from './openApp';
import { open_disk_inventory, open_instance_controls } from './openDisk';
import {
  add_files,
  cancel_eject,
  cancel_erase,
  close_account,
  close_settings,
  confirm_eject,
  confirm_erase,
  eject_disk,
  erase_disk,
  make_files_disk,
  open_account,
  open_settings,
  sign_in,
  start_instance,
  stop_instance,
} from './operatorActions';

export const intentRegistry: Record<ConsoleIntentName, IntentFn> = {
  open_console_as_teacher,
  open_console_as_learner,
  open_console_as_operator,
  stay_on_teacher_overview,
  stay_on_learner_overview,
  stay_on_overview,
  return_to_start,
  open_kolibri_as_teacher,
  open_kolibri_as_learner,
  open_nextcloud_as_teacher,
  open_nextcloud_as_learner,
  open_disk_inventory,
  open_instance_controls,
  eject_disk,
  confirm_eject,
  cancel_eject,
  erase_disk,
  confirm_erase,
  cancel_erase,
  start_instance,
  stop_instance,
  open_account,
  close_account,
  open_settings,
  close_settings,
  sign_in,
  make_files_disk,
  add_files,
};

export function getIntent(name: string): IntentFn | undefined {
  return (intentRegistry as Record<string, IntentFn>)[name];
}

export {
  CONSOLE_INTENT_NAMES,
  type ConsoleIntentName,
  type IntentFn,
  type IntentContext,
} from './types';
export { sel } from './selectors';
export { DURATION_FIXTURES } from './fixtures';
