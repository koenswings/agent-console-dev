/**
 * Cross-engine command feedback, approach (ii): store confirmation.
 *
 * When a command goes to an Engine other than the connected one, its trace is
 * in THAT Engine's command log, which the Console usually can't read. Instead
 * of a false "No response", the panel shows a neutral "Sent to <engine>,
 * waiting for confirmation" and resolves from the replicated store:
 *
 *   command          success (store)                                 failure (store)
 *   startInstance    status changed to Running, or new startApp op Done   status → Error / startApp op Failed
 *   stopInstance     status changed to Stopped/Docked, or stopApp Done    status → Error / stopApp op Failed
 *   backupApp        new backupApp op Done, or lastBackup advanced   new backupApp op Failed / Cancelled
 *   restoreApp       new restoreApp op Done                          new restoreApp op Failed / Cancelled
 *   copyApp          new copyApp op Done, or a newly created instance  new copyApp op Failed / Cancelled
 *                    (same app + name) on the target disk
 *   moveApp          new moveApp op Done, or storedOn changed to target new moveApp op Failed / Cancelled
 *   installApp       a newly created instance of the app on the disk —
 *   reboot           engine.lastBooted changed (went down, came up)  —
 *   ejectDisk        disk record gone / undocked / no device         —
 *   cancelOperation  the operation is no longer Pending / Running    —
 *
 * Red only on a real error (an error trace in a command log we can read, or
 * a Failed operation / Error status the Engine wrote to the store) or after
 * REMOTE_TIMEOUTS_MS with no confirmation at all.
 *
 * "New" means created after the send: id unseen at send time (see the
 * builders section for the exact rules and the clock-skew choice). Each
 * `confirm…` builder captures its baseline when called, so call it at send
 * time.
 */
import type { Accessor } from 'solid-js';
import type { OperationKind, Status, Store } from '../types/store';
import { isRemoteEngine } from './connectedEngine';
import { isLoadedLog, remoteCommandLog } from './remoteCommandLogs';
import type { CommandLogState } from './commandLog';

export type RemoteCheck = 'ok' | { error: string } | null;

export interface RemoteWatch {
  /** Target Engine hostname, for "Sent to <engine>". */
  engineLabel: string;
  /** Reactive: 'ok' when the store proves success, { error } when it proves failure. */
  check: () => RemoteCheck;
  /** Red "no confirmation" after this long. */
  timeoutMs: number;
  /** Approach (i): the target Engine's own command log, when loaded at send time. */
  log?: Accessor<CommandLogState>;
}

const MIN = 60_000;

/**
 * How long to wait for a cross-engine confirmation before turning red.
 * Generous on purpose: copy/move/backup/restore rsync whole app disks over the
 * network, a reboot takes a Pi through shutdown, boot and Engine start.
 */
export const REMOTE_TIMEOUTS_MS: Record<string, number> = {
  startInstance: 5 * MIN,
  stopInstance: 5 * MIN,
  backupApp: 30 * MIN,
  restoreApp: 30 * MIN,
  copyApp: 30 * MIN,
  moveApp: 30 * MIN,
  installApp: 20 * MIN,
  reboot: 10 * MIN,
  ejectDisk: 3 * MIN,
  cancelOperation: 3 * MIN,
};
export const DEFAULT_REMOTE_TIMEOUT_MS = 10 * MIN;

/** "30 min" / "90 s" for messages. */
export const formatWait = (ms: number): string =>
  ms >= MIN ? `${Math.round(ms / MIN)} min` : `${Math.round(ms / 1000)} s`;

/**
 * The remote watch for a command to `engineId`, or null when `engineId` is the
 * connected Engine (then the normal command-log result applies).
 */
export const remoteWatchFor = (
  store: Accessor<Store | null>,
  engineId: string,
  command: string,
  check: () => RemoteCheck,
): RemoteWatch | null => {
  const s = store();
  if (!isRemoteEngine(s, engineId)) return null;
  const log = remoteCommandLog(engineId);
  return {
    engineLabel: String(s?.engineDB?.[engineId]?.hostname ?? engineId),
    check,
    timeoutMs: REMOTE_TIMEOUTS_MS[command] ?? DEFAULT_REMOTE_TIMEOUT_MS,
    log: log && isLoadedLog(log()) ? log : undefined,
  };
};

// ---------------------------------------------------------------------------
// Confirmation builders (baseline captured at call time = send time)
// ---------------------------------------------------------------------------
//
// "Created after the send" (r30 caveat 3, no false greens):
//
//  1. Primary: the record's id was NOT in the store at send time. Engine
//     operation and instance ids are fresh uuids (createOperation, copyApp's
//     newInstanceId, installAppFromDisk), so an id we had never seen was
//     written after our snapshot. This needs no clock at all.
//  2. Attributes: the record must also be the one our command produces
//     (op kind + args.instanceId + target/backup disk + cause console-command
//     or cross-engine-cmd; instance on the target disk with the expected name
//     / app). This rules out an op or instance that was created just before
//     the send on the remote Engine but replicated to us just after.
//  3. Clock skew: we NEVER compare an Engine timestamp (op.startedAt,
//     instance.created) with the Console's Date.now(): school Pis often have
//     no RTC / NTP and can be hours or days off. As defence in depth we only
//     compare it with the SAME Engine's own clock: its engine.lastRun as seen
//     at send time, minus ENGINE_CLOCK_SLACK_MS (heartbeat jitter, small NTP
//     steps back). If either value is missing the check is skipped.
//
// Start/stop use transitions instead: the status must differ from its
// at-send value (or have been seen leaving it and come back), or a NEW
// startApp/stopApp operation for the instance must be Done.

/** Allowed lag of an Engine record's own timestamp behind that Engine's lastRun at send. */
export const ENGINE_CLOCK_SLACK_MS = 5 * MIN;

/** Op causes that a command (Console or cross-engine dispatch) produces. */
const COMMAND_CAUSES = new Set(['console-command', 'cross-engine-cmd']);

/** What the store looked like when the command was sent. */
export interface SendSnapshot {
  opIds: Set<string>;
  instanceIds: Set<string>;
  /** engineDB[engineId].lastRun at send (that Engine's clock), or null. */
  engineClock: number | null;
}

export const snapshotAtSend = (store: Accessor<Store | null>, engineId?: string | null): SendSnapshot => {
  const s = store();
  const lastRun = engineId ? Number(s?.engineDB?.[engineId]?.lastRun) : NaN;
  return {
    opIds: new Set(Object.keys(s?.operationDB ?? {})),
    instanceIds: new Set(Object.keys(s?.instanceDB ?? {})),
    engineClock: Number.isFinite(lastRun) && lastRun > 0 ? lastRun : null,
  };
};

/** Engine-clock freshness (same Engine's clock only, see above). Unknown → true. */
export const freshByEngineClock = (ts: unknown, snap: SendSnapshot): boolean => {
  const t = Number(ts);
  if (snap.engineClock === null || !Number.isFinite(t) || t <= 0) return true;
  return t >= snap.engineClock - ENGINE_CLOCK_SLACK_MS;
};

/**
 * Instance status confirmation for start/stop. 'ok' only for a transition
 * observed after the send: the status differs from its at-send value and is
 * one of `okStatuses`, or it was seen leaving the at-send value and came back
 * (e.g. Running → Starting → Running). An instance already in an ok status at
 * send time, with no transition, does NOT confirm. A NEW startApp/stopApp
 * operation (`opKind`) for the instance that is Done also confirms (covers a
 * Starting step that replicated too fast to be observed); Failed is an error.
 * Going to Error after the send is a failure.
 */
export const confirmInstanceStatus = (
  store: Accessor<Store | null>,
  instanceId: string,
  okStatuses: Status[],
  opKind?: OperationKind,
): (() => RemoteCheck) => {
  const baseline = store()?.instanceDB?.[instanceId]?.status ?? null;
  const snap = snapshotAtSend(store);
  let leftBaseline = false;
  return () => {
    const s = store();
    if (opKind) {
      const ops = Object.values(s?.operationDB ?? {}).filter((op) =>
        !snap.opIds.has(op.id) && op.kind === opKind && String(op.args?.instanceId) === instanceId);
      const failed = ops.find((op) => op.status === 'Failed');
      if (failed) return { error: failed.error || `${opKind} failed.` };
      if (ops.some((op) => op.status === 'Done')) return 'ok';
    }
    const inst = s?.instanceDB?.[instanceId];
    if (!inst) return null;
    if (inst.status !== baseline) leftBaseline = true;
    if (okStatuses.includes(inst.status) && (inst.status !== baseline || leftBaseline)) return 'ok';
    if (inst.status === 'Error' && (baseline !== 'Error' || leftBaseline)) {
      return { error: inst.statusCondition || 'The app went into an error state.' };
    }
    return null;
  };
};

export interface NewOperationMatch {
  /** Engine the command went to (its clock is used for the freshness check). */
  engineId?: string;
  /** Op args that must equal these values (e.g. { targetDiskId }). */
  args?: Record<string, string>;
  /** Store proof when the op record is late (also "created after send" based). */
  fallbackOk?: () => boolean;
}

/**
 * A NEW operation of `kind` on `instanceId`: its id was not in the store at
 * send time, its args match, its cause is a command, and its startedAt is not
 * older than the Engine's own clock at send. Done → ok, Failed/Cancelled →
 * error. An op that existed at send time never counts.
 */
export const confirmNewOperation = (
  store: Accessor<Store | null>,
  kind: OperationKind,
  instanceId: string,
  match: NewOperationMatch = {},
): (() => RemoteCheck) => {
  const snap = snapshotAtSend(store, match.engineId);
  const argsMatch = (args: Record<string, string> | undefined) =>
    Object.entries(match.args ?? {}).every(([k, v]) => String(args?.[k]) === v);
  return () => {
    const ops = Object.values(store()?.operationDB ?? {}).filter((op) =>
      !snap.opIds.has(op.id)
      && op.kind === kind
      && String(op.args?.instanceId) === instanceId
      && argsMatch(op.args)
      && (op.cause == null || COMMAND_CAUSES.has(String(op.cause)))
      && freshByEngineClock(op.startedAt, snap));
    // 'Cancelled' is written by the Engine's cancelOperation (not in OperationStatus here).
    const failed = ops.find((op) => op.status === 'Failed' || String(op.status) === 'Cancelled');
    if (failed) return { error: failed.error || `${kind} ${String(failed.status) === 'Cancelled' ? 'was cancelled' : 'failed'}.` };
    if (ops.some((op) => op.status === 'Done')) return 'ok';
    if (match.fallbackOk?.()) return 'ok';
    return null;
  };
};

/**
 * An instance CREATED after the send (id unseen at send, Engine-clock fresh)
 * stored on `diskId`, matching every given field. Used for the copyApp
 * fallback (same app AND same name as the source; copyApp keeps both) and
 * installApp (same app, see confirmInstalled).
 * A pre-existing instance with that name / app never counts.
 */
export const newInstanceOnDisk = (
  store: Accessor<Store | null>,
  diskId: string,
  match: { instanceOf?: string; name?: string; engineId?: string },
): (() => boolean) => {
  const snap = snapshotAtSend(store, match.engineId);
  return () => Object.values(store()?.instanceDB ?? {}).some((i) =>
    !snap.instanceIds.has(i.id)
    && String(i.storedOn) === diskId
    && (match.instanceOf === undefined || String(i.instanceOf) === match.instanceOf)
    && (match.name === undefined || String(i.name) === match.name)
    && freshByEngineClock(i.created, snap));
};

/**
 * moveApp fallback: the instance's storedOn CHANGED to the target disk after
 * the send. If it was already on the target at send time it never confirms.
 */
export const instanceStoredOn = (store: Accessor<Store | null>, instanceId: string, diskId: string): (() => boolean) => {
  const atSend = String(store()?.instanceDB?.[instanceId]?.storedOn ?? '');
  return () => atSend !== diskId && String(store()?.instanceDB?.[instanceId]?.storedOn) === diskId;
};

/** backupApp fallback: lastBackup moved forward after the send (Engine clock vs the same Engine's clock). */
export const lastBackupAdvanced = (store: Accessor<Store | null>, instanceId: string): (() => boolean) => {
  const baseline = Number(store()?.instanceDB?.[instanceId]?.lastBackup ?? 0);
  return () => Number(store()?.instanceDB?.[instanceId]?.lastBackup ?? 0) > baseline;
};

/**
 * installApp / lesson install: a NEW instance (id unseen at send, Engine-clock
 * fresh) of `appId` on the target disk. Matched by app, not by name: Engine
 * 8d98718 takes the instance name from the copied compose file (the source
 * instance's or the app bundle's x-app.instanceName), not from --name, so a
 * name match could miss a real install. A pre-existing instance never counts.
 */
export const confirmInstalled = (
  store: Accessor<Store | null>,
  diskId: string,
  appId: string,
  engineId?: string,
): (() => RemoteCheck) => {
  const found = newInstanceOnDisk(store, diskId, { instanceOf: appId, engineId });
  return () => (found() ? 'ok' : null);
};

/**
 * reboot: the Engine booted again — lastBooted CHANGED from its at-send value
 * (both written by that Engine's clock; "changed" rather than "greater" so a
 * Pi whose clock restarts behind after a reboot without RTC still confirms).
 */
export const confirmRebooted = (store: Accessor<Store | null>, engineId: string): (() => RemoteCheck) => {
  const baseline = Number(store()?.engineDB?.[engineId]?.lastBooted ?? 0);
  return () => {
    const now = Number(store()?.engineDB?.[engineId]?.lastBooted ?? 0);
    return now > 0 && now !== baseline ? 'ok' : null;
  };
};

/** ejectDisk: the disk record is gone, undocked or has no device. */
export const confirmEjected = (store: Accessor<Store | null>, diskId: string): (() => RemoteCheck) =>
  () => {
    const s = store();
    if (!s) return null;
    const d = s.diskDB?.[diskId];
    return !d || d.dockedTo == null || d.device == null ? 'ok' : null;
  };

/** cancelOperation: the operation is no longer Pending / Running. */
export const confirmCancelled = (store: Accessor<Store | null>, opId: string): (() => RemoteCheck) =>
  () => {
    const s = store();
    if (!s) return null;
    const op = s.operationDB?.[opId];
    return !op || (op.status !== 'Pending' && op.status !== 'Running') ? 'ok' : null;
  };
