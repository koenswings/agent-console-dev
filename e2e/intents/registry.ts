/**
 * Intent registry keyed by Axle YAML / ACTIONS.md action names (idea#166).
 * Engine-owned keys (enter_infra_fleet_walk, infra_*) are intentionally absent.
 * keep_watching is registered (stay on /topics/c/<video node id> — no chrome testids).
 * next_resource is registered (Kolibri resource-list panel → exercise sibling).
 * finish_exercise is registered (Perseus Check → completion → Learn home).
 * Lesson chrome (exit_lesson / next_video) and
 * open_wikipedia_* stay unregistered until Kid App testids.
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
  finish_exercise,
  keep_watching,
  next_resource,
  open_exercise,
  open_video,
} from './openKolibriContent';
import {
  add_files_role,
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
import {
  add_operator,
  back_to_disk,
  back_to_overview,
  backup_instance,
  change_password,
  install_app,
  log_out,
  make_backup_disk,
  notice_usb_dock,
  open_app,
  remove_operator,
  restore_from_backup,
  retry_login_first_time_setup,
  start_after_install,
  stay_on_disk,
  files_role_added,
  backup_configured_restored,
  done_redistribute,
  stay_on_source_disk,
  open_copied_instance,
  switch_engine,
  reboot_engine,
  back_to_console,
  leave_kolibri,
  leave_nextcloud_as_teacher,
  leave_nextcloud_as_learner,
} from './operatorDeepActions';
import { copy_app, move_app } from './copyMoveApp';
import {
  create_class,
  enroll_learners,
  build_lesson,
  create_quiz,
  read_reports,
  preview_as_learner,
  browse_classes,
} from './kolibriCoaching';

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
  open_video,
  keep_watching,
  next_resource,
  finish_exercise,
  open_exercise,
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
  add_files_role,
  install_app,
  start_after_install,
  stay_on_disk,
  make_backup_disk,
  restore_from_backup,
  open_app,
  backup_instance,
  back_to_disk,
  back_to_overview,
  log_out,
  notice_usb_dock,
  retry_login_first_time_setup,
  change_password,
  add_operator,
  remove_operator,
  copy_app,
  move_app,
  files_role_added,
  backup_configured_restored,
  done_redistribute,
  stay_on_source_disk,
  open_copied_instance,
  switch_engine,
  reboot_engine,
  back_to_console,
  leave_kolibri,
  leave_nextcloud_as_teacher,
  leave_nextcloud_as_learner,
  create_class,
  enroll_learners,
  build_lesson,
  create_quiz,
  read_reports,
  preview_as_learner,
  browse_classes,
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
export { DURATION_FIXTURES, uuidForms } from './fixtures';
export {
  resolveSidecarUrl,
  sidecarPort,
  SIDECAR_DEFAULT_PORTS,
  APP_TAB_URL_RE,
  type SidecarApp,
} from './sidecarUrls';
export { openAppInstance, tryOpenInstancePathA, openInstancePathB } from './openApp';
