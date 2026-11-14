/**
 * Demo apps (idea#235) — Console side of Axle's accepted Engine design
 * engine#369 (Steve's decisions, comment 6875084189). Pure helpers only.
 *
 * Contract used (engine#369):
 *   - capability `demoApps` (§1), fresh only when capabilitiesBootedAt === lastBooted;
 *   - `setupDemo <targetDiskId> [--apps kolibri,nextcloud]` and
 *     `removeDemo [<instanceId>...]`, scope engine, sent by id (§2);
 *   - `Instance.demo?: true`, mirrored from `x-app.demo` in compose.yaml (§3);
 *   - `OperationKind` 'setupDemo' | 'removeDemo' with `Operation.demo` progress
 *     and stable step ids (§3);
 *   - optional `internet` / `demoLocal` on the ephemeral `idea/hb` (§4);
 *   - error codes as `CODE: text` (§9).
 *
 * Permissions (Koen, idea#235, 14 Nov 2026 10:15): only operators may set up
 * and remove demo apps. The Engine has no role model, so the Console enforces
 * it: the section is hidden unless `isOperator()` (engine#369 §11).
 *
 * One demo set per Engine is Engine-enforced (DEMO_EXISTS / DEMO_AMBIGUOUS);
 * the Console mirrors it to grey the button out early, and only warns
 * (never blocks) when another Engine already runs demo apps (Q2).
 */
import { engineHasCapability, type EngineCapability } from './commands';
import { plainEngineText } from './plainError';
import { REMOVE_REFUSALS, removeRefusalCode } from './removeInstance';
import type { LiveState } from './live';
import type {
  DemoAppId,
  DemoAppProgress,
  DemoStepId,
  DemoStepStatus,
  Disk,
  Engine,
  Instance,
  Operation,
  Store,
} from '../types/store';

export const DEMO_APPS_CAPABILITY: EngineCapability = 'demoApps';
export const SETUP_DEMO_COMMAND = 'setupDemo';
export const REMOVE_DEMO_COMMAND = 'removeDemo';

/** The demo apps and their display names, in the Engine's run order (Kolibri, then Nextcloud). */
export const DEMO_APPS: readonly { id: DemoAppId; name: string }[] = [
  { id: 'kolibri', name: 'Kolibri Demo' },
  { id: 'nextcloud', name: 'Nextcloud Demo' },
];

const APP_NAME: Record<string, string> = Object.fromEntries(DEMO_APPS.map((a) => [a.id, a.name]));
export const demoAppName = (app: string): string => APP_NAME[app] ?? app;

// ── Copy ────────────────────────────────────────────────────────────────────

/** Koen's text (idea#235 approach comment) when there is no way to get the content. */
export const DEMO_NO_SOURCE_TEXT =
  'Set up demo apps needs internet. Connect the Engine, or insert a disk with the IDEA demo pack.';
export const DEMO_NO_TARGET_TEXT = 'Plug an App Disk or an empty disk into this Engine to set up demo apps.';
export const DEMO_BUSY_TEXT = 'Demo apps are being set up or removed on this Engine. Wait until that has finished.';
export const DEMO_AMBIGUOUS_TEXT =
  'This Engine has more than one copy of a demo app. Remove the demo apps first, then set them up again.';
export const demoExistsText = (diskName: string): string =>
  `Demo apps are already on the disk "${diskName}". Pick that disk, or remove the demo apps first.`;
export const demoElsewhereText = (engineNames: readonly string[]): string =>
  `IDEA demo apps already run on ${engineNames.join(', ')}.`;
export const removeDemoConfirmText = (names: readonly string[]): string =>
  `Remove ${names.join(' and ')}? Only these demo apps are taken off the disk. Their data is kept aside on the disk, not deleted. Real apps are not touched.`;

/** Plain words for each engine#369 step id. */
export const DEMO_STEP_TEXT: Record<DemoStepId, string> = {
  install: 'Install the app',
  download: 'Get the demo content',
  verify: 'Check the demo content',
  seed: 'Add the demo school, users and files',
  start: 'Start the app',
  ready: 'Wait until the app is ready',
  classwork: 'Add demo classwork',
  stop: 'Stop the app',
  remove: 'Take the app off the disk',
};

export const DEMO_STEP_STATUS_TEXT: Record<DemoStepStatus, string> = {
  pending: 'Waiting',
  running: 'Working…',
  done: 'Done',
  skipped: 'Already done',
  failed: 'Failed',
};

/** Plain wording for every engine#369 §9 code (refusals, failures, done). */
export const DEMO_ERROR_TEXT: Record<string, string> = {
  // Refusals (no Operation)
  UNKNOWN_APP: "That isn't one of the demo apps.",
  NOT_FOUND: 'That disk or app is no longer there.',
  NOT_DOCKED: "That disk isn't plugged into this Engine.",
  NOT_LOCAL: 'That demo app is on a disk in another Engine. Remove it from that Engine.',
  SYSTEM_DISK: "Demo apps can't go on the Engine's own system disk. Pick an App Disk.",
  NOT_APP_DISK: "Demo apps can only go on an App Disk or an empty disk.",
  DEMO_EXISTS: 'Demo apps are already on another disk of this Engine. Pick that disk, or remove them first.',
  DEMO_AMBIGUOUS: DEMO_AMBIGUOUS_TEXT,
  NO_SOURCE: DEMO_NO_SOURCE_TEXT,
  PACK_OUTDATED: 'The demo pack is too old. Connect the Engine to the internet, or insert a newer IDEA demo pack.',
  NO_SPACE: 'There is not enough free space on that disk for the demo apps.',
  BUSY: 'Something else is running on this Engine or disk. Try again when it has finished.',
  NOT_DEMO: "One of these apps isn't a demo app, so nothing was removed.",
  HELPER_OUTDATED: 'This Engine needs an update before it can set up demo apps.',
  // Failures
  DOWNLOAD_FAILED: "The demo content couldn't be downloaded. Check the internet connection and press the button again.",
  CHECKSUM_MISMATCH: "The downloaded demo content didn't match what was expected, so it wasn't used.",
  INSTALL_FAILED: "The demo app couldn't be installed. Press the button again to retry.",
  HOOK_MISSING: 'The app on this disk is too old for demo apps. Update the app, then try again.',
  HOOK_FAILED: "The demo content couldn't be added. Press the button again to retry.",
  START_FAILED: "The demo app couldn't be started. Press the button again to retry.",
  NOT_READY: "The demo app started but didn't become ready in time. Press the button again to retry.",
  DOCK_CHANGED: 'The disk was unplugged during setup. Plug it back in and press the button again.',
  INTERRUPTED: 'The Engine restarted before this finished. Press the button again to continue.',
  REMOVE_FAILED: "A demo app couldn't be removed.",
  // Done
  DEMO_READY: 'Demo apps are ready.',
  DEMO_REMOVED: 'Demo apps removed. Their data is kept aside on the disk, not deleted.',
};

const LEADING_CODE_RE = /^\s*([A-Z][A-Z0-9_]{2,})(?::|$)/;

/** The leading engine#369 code of `CODE: text` (or a bare code), or null. */
export const demoCodeOf = (raw: string | null | undefined): string | null => {
  const m = LEADING_CODE_RE.exec(String(raw ?? '').trim());
  return m ? m[1] : null;
};

/**
 * Plain text for a demo code or `CODE: text` message. REMOVE_FAILED carries
 * removeInstance's inner code in its text (engine#369 §2), which is mapped too.
 * Unknown codes fall back to plainEngineText (never shows a code or CLI words).
 */
export const demoErrorText = (raw: string | null | undefined): string => {
  const code = demoCodeOf(raw);
  if (code === 'REMOVE_FAILED') {
    const rest = String(raw ?? '').replace(LEADING_CODE_RE, '');
    const inner = removeRefusalCode(rest);
    return inner ? `${DEMO_ERROR_TEXT.REMOVE_FAILED} ${REMOVE_REFUSALS[inner]}` : DEMO_ERROR_TEXT.REMOVE_FAILED;
  }
  if (code && DEMO_ERROR_TEXT[code]) return DEMO_ERROR_TEXT[code];
  return plainEngineText(raw);
};

// ── Store reads ─────────────────────────────────────────────────────────────

/** True only for engine#369's `Instance.demo === true`. Never inferred from the name. */
export const isDemoInstance = (inst: Pick<Instance, 'demo'> | null | undefined): boolean => inst?.demo === true;

/** Show the Demo apps section for this Engine: operator AND fresh `demoApps`. */
export const canOfferDemoApps = (engine: Engine | null | undefined, operator: boolean): boolean =>
  operator && engineHasCapability(engine, DEMO_APPS_CAPABILITY);

const dockedEngineOf = (store: Store | null | undefined, inst: Instance): string | null => {
  const diskId = inst.storedOn;
  const disk = diskId ? store?.diskDB?.[diskId] : undefined;
  return disk?.dockedTo != null ? String(disk.dockedTo) : null;
};

/** Demo instances on disks docked to `engineId`, sorted by name then id. */
export const demoInstancesOnEngine = (store: Store | null | undefined, engineId: string | null | undefined): Instance[] => {
  if (!store || !engineId) return [];
  return Object.values(store.instanceDB ?? {})
    .filter((i) => isDemoInstance(i) && dockedEngineOf(store, i) === String(engineId))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)));
};

/** Hostnames of OTHER Engines whose docked disks hold demo instances (Q2: warning only). */
export const demoEnginesElsewhere = (store: Store | null | undefined, engineId: string | null | undefined): string[] => {
  if (!store) return [];
  const names = new Set<string>();
  for (const inst of Object.values(store.instanceDB ?? {})) {
    if (!isDemoInstance(inst)) continue;
    const eid = dockedEngineOf(store, inst);
    if (!eid || eid === String(engineId)) continue;
    names.add(String(store.engineDB?.[eid]?.hostname ?? eid));
  }
  return [...names].sort();
};

/**
 * Disks setupDemo may target (engine#369 Q1, §2 refusals 2–3): docked to this
 * Engine, not the system disk, and diskTypes include 'app' or 'empty'. Sorted
 * by free space, most first (the default target); unknown free space last.
 */
export const demoTargetDisks = (store: Store | null | undefined, engineId: string | null | undefined): Disk[] => {
  if (!store || !engineId) return [];
  return Object.values(store.diskDB ?? {})
    .filter((d) => String(d.dockedTo) === String(engineId))
    .filter((d) => !(d.diskTypes ?? []).includes('system'))
    .filter((d) => (d.diskTypes ?? []).includes('app') || (d.diskTypes ?? []).includes('empty'))
    .sort((a, b) => (Number(b.freeBytes ?? -1) - Number(a.freeBytes ?? -1)) || String(a.id).localeCompare(String(b.id)));
};

/** The hb's optional engine#369 §4 fields; null = unknown (old Engine or no hb yet). */
export const demoHeartbeat = (live: LiveState, engineId: string | null | undefined): { internet: boolean | null; demoLocal: boolean | null } => {
  const beat = engineId ? live.beats[String(engineId)] : undefined;
  return { internet: beat?.internet ?? null, demoLocal: beat?.demoLocal ?? null };
};

/** engine#369 §4: grey out only when BOTH are known false. Unknown lets the Engine decide (NO_SOURCE). */
export const noDemoSource = (hb: { internet: boolean | null; demoLocal: boolean | null }): boolean =>
  hb.internet === false && hb.demoLocal === false;

const DEMO_KINDS = new Set<string>(['setupDemo', 'removeDemo']);
const ACTIVE = new Set<string>(['Pending', 'Running']);

/** The newest setupDemo/removeDemo Operation for this Engine (subject engine, §3), or null. */
export const latestDemoOperation = (store: Store | null | undefined, engineId: string | null | undefined): Operation | null => {
  if (!store || !engineId) return null;
  let best: Operation | null = null;
  for (const op of Object.values(store.operationDB ?? {})) {
    if (!DEMO_KINDS.has(op.kind)) continue;
    const forEngine = String(op.engineId) === String(engineId)
      || (op.subject?.type === 'engine' && String(op.subject.id) === String(engineId));
    if (!forEngine) continue;
    if (!best || Number(op.startedAt) > Number(best.startedAt)) best = op;
  }
  return best;
};

export const isDemoOperationActive = (op: Operation | null | undefined): boolean => !!op && ACTIVE.has(op.status);

export type DemoSetupMode = 'setup' | 'resume' | 'refresh';

/** Button label per mode. */
export const DEMO_SETUP_LABEL: Record<DemoSetupMode, string> = {
  setup: 'Set up demo apps',
  resume: 'Continue setting up demo apps',
  refresh: 'Check and refresh demo apps',
};

/**
 * Shown under the button when the full demo set is already there. A re-press
 * re-verifies (and, when needed, re-downloads) the demo content and re-runs
 * the idempotent seed steps; it never installs a second copy (engine#369 §8,
 * addendum decision 5: an outdated pack after updateApp is fixed this way).
 */
export const DEMO_REFRESH_HINT =
  'Demo apps are already set up. Press to check the demo content and add anything missing. Nothing is installed twice.';

export interface DemoSetupGate {
  /** Why the button is greyed out, or null when it can be sent. */
  reason: string | null;
  /**
   * setup: nothing there yet; resume: a partial set on the chosen disk or the
   * last setup failed (engine#369 §8); refresh: the full set is there, so a
   * press re-verifies and re-seeds (addendum decision 5).
   */
  mode: DemoSetupMode;
}

/**
 * Which demo app an instance is, from its App record's `name` (app ids are
 * versioned, e.g. `kolibri-1.0`, and `instanceOf` changes to the new app id
 * after updateApp, engine#369 addendum A). Without an App record, the id's
 * `<name>-<digit>` prefix is used. Null when it isn't a demo app's instance.
 */
export const demoAppIdOf = (store: Store | null | undefined, inst: Pick<Instance, 'instanceOf'>): DemoAppId | null => {
  const appId = String(inst.instanceOf ?? '');
  const name = store?.appDB?.[appId]?.name;
  for (const a of DEMO_APPS) {
    if (name != null ? String(name) === a.id : appId === a.id || new RegExp(`^${a.id}-\\d`).test(appId)) return a.id;
  }
  return null;
};

/**
 * Whether Set up demo apps can be sent to this Engine for `targetDiskId`.
 * Mirrors engine#369 refusals the Console can see beforehand; the Engine
 * still decides (BUSY, NO_SPACE, NO_SOURCE when hb fields are unknown, …).
 */
export const demoSetupGate = (input: {
  store: Store | null | undefined;
  engineId: string | null | undefined;
  live: LiveState;
  targetDiskId: string | null | undefined;
}): DemoSetupGate => {
  const { store, engineId, live, targetDiskId } = input;
  const op = latestDemoOperation(store, engineId);
  if (isDemoOperationActive(op)) return { reason: DEMO_BUSY_TEXT, mode: 'setup' };
  const targets = demoTargetDisks(store, engineId);
  if (targets.length === 0 || !targetDiskId || !targets.some((d) => d.id === targetDiskId)) {
    return { reason: DEMO_NO_TARGET_TEXT, mode: 'setup' };
  }
  const existing = demoInstancesOnEngine(store, engineId);
  const perApp = new Map<string, Instance[]>();
  for (const i of existing) {
    const key = demoAppIdOf(store, i) ?? String(i.instanceOf);
    perApp.set(key, [...(perApp.get(key) ?? []), i]);
  }
  if ([...perApp.values()].some((l) => l.length > 1)) return { reason: DEMO_AMBIGUOUS_TEXT, mode: 'setup' };
  const elsewhere = existing.find((i) => i.storedOn !== targetDiskId);
  if (elsewhere) {
    const disk = elsewhere.storedOn ? store?.diskDB?.[elsewhere.storedOn] : undefined;
    return { reason: demoExistsText(String(disk?.name ?? elsewhere.storedOn ?? '')), mode: 'setup' };
  }
  const complete = DEMO_APPS.every((a) => perApp.has(a.id));
  const lastFailed = op?.kind === 'setupDemo' && op.status === 'Failed';
  const mode: DemoSetupMode = lastFailed || (existing.length > 0 && !complete) ? 'resume' : complete ? 'refresh' : 'setup';
  if (noDemoSource(demoHeartbeat(live, engineId))) return { reason: DEMO_NO_SOURCE_TEXT, mode };
  return { reason: null, mode };
};

// ── Progress (Operation.demo) ───────────────────────────────────────────────

/** App ids in the Operation, in order; the ID list a <For> iterates. */
export const demoProgressAppIds = (op: Operation | null | undefined): string[] =>
  (op?.demo?.apps ?? []).map((a) => String(a.app));

export const demoAppProgress = (op: Operation | null | undefined, app: string): DemoAppProgress | undefined =>
  (op?.demo?.apps ?? []).find((a) => String(a.app) === app);

/** Step ids of one app, in the Engine's order; the ID list a <For> iterates. */
export const demoStepIds = (op: Operation | null | undefined, app: string): DemoStepId[] =>
  (demoAppProgress(op, app)?.steps ?? []).map((s) => s.id);

const MB = 1_000_000;
/** Plain label for one step, with the download size when known. */
export const demoStepLabel = (step: { id: DemoStepId | string; bytesTotal?: number | null }): string => {
  const base = DEMO_STEP_TEXT[step.id as DemoStepId] ?? 'Working';
  return step.id === 'download' && typeof step.bytesTotal === 'number' && step.bytesTotal > 0
    ? `${base} (${Math.round(step.bytesTotal / MB)} MB)`
    : base;
};

/**
 * One plain line for a finished or failed demo Operation: the code from
 * Operation.demo.code, else Operation.error (`CODE: text`). Null while running.
 */
export const demoOperationResultText = (op: Operation | null | undefined): string | null => {
  if (!op || isDemoOperationActive(op)) return null;
  const raw = op.demo?.code ?? op.error ?? null;
  if (op.status === 'Done') {
    if (raw && DEMO_ERROR_TEXT[raw]) return DEMO_ERROR_TEXT[raw];
    return op.kind === 'removeDemo' ? DEMO_ERROR_TEXT.DEMO_REMOVED : DEMO_ERROR_TEXT.DEMO_READY;
  }
  // A Failed op's code is the most specific: an app-level code beats the generic one.
  const appCode = (op.demo?.apps ?? []).map((a) => a.code).find((c) => c && c !== 'DEMO_READY' && c !== 'DEMO_REMOVED');
  return demoErrorText(op.error ?? appCode ?? raw);
};
