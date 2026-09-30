/**
 * Intent registry keyed by Axle YAML action names (idea#166).
 * Engine-owned keys (enter_infra_fleet_walk, infra_*) are intentionally absent.
 */
import type { ConsoleIntentName, IntentFn } from './types';
import {
  open_console_as_learner,
  open_console_as_operator,
  open_console_as_teacher,
} from './openConsole';
import { stay_on_learner_overview, stay_on_teacher_overview } from './stayOnOverview';
import { return_to_start } from './returnToStart';

export const intentRegistry: Record<ConsoleIntentName, IntentFn> = {
  open_console_as_teacher,
  open_console_as_learner,
  open_console_as_operator,
  stay_on_teacher_overview,
  stay_on_learner_overview,
  return_to_start,
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
