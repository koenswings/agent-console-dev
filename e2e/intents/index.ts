/** Public entry for duration-walk Playwright Intents (idea#166 / #168). */
export {
  intentRegistry,
  getIntent,
  CONSOLE_INTENT_NAMES,
  sel,
  DURATION_FIXTURES,
  uuidForms,
  type ConsoleIntentName,
  type IntentFn,
  type IntentContext,
} from './registry';
export {
  runDurationIntent,
  hasDurationIntent,
  type DurationIntentResult,
  type RunDurationIntentOptions,
} from './durationBridge';
export {
  resolveSidecarUrl,
  sidecarPort,
  SIDECAR_DEFAULT_PORTS,
  APP_TAB_URL_RE,
  openAppInstance,
  tryOpenInstancePathA,
  openInstancePathB,
  type SidecarApp,
} from './registry';

