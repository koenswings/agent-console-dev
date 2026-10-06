/**
 * Cross-engine command feedback, approach (ii): store confirmation.
 *
 * When a command goes to an Engine other than the connected one, its trace is
 * in THAT Engine's command log, which the Console usually can't read. Instead
 * of a false "No response", the panel shows a neutral "Sent to <engine>,
 * waiting for confirmation" and resolves from the replicated store:
 *
 *   command          success (store)                                 failure (store)
 *   startInstance    instance status Running                         status → Error (statusCondition)
 *   stopInstance     instance status Stopped / Docked                status → Error (statusCondition)
 *   backupApp        new backupApp op Done, or lastBackup advanced   new backupApp op Failed / Cancelled
 *   restoreApp       new restoreApp op Done                          new restoreApp op Failed / Cancelled
 *   copyApp          new copyApp op Done, or a new instance of the   new copyApp op Failed / Cancelled
 *                    same app on the target disk
 *   moveApp          new moveApp op Done, or storedOn = target disk  new moveApp op Failed / Cancelled
 *   installApp       a new instance with that name on the disk       —
 *   reboot           engine.lastBooted advanced (went down, came up) —
 *   ejectDisk        disk record gone / undocked / no device         —
 *   cancelOperation  the operation is no longer Pending / Running    —
 *
 * Red only on a real error (an error trace in a command log we can read, or
 * a Failed operation / Error status the Engine wrote to the store) or after
 * REMOTE_TIMEOUTS_MS with no confirmation at all.
 *
 * Each `confirm…` builder captures its baseline when called, so call it at
 * send time.
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
// Confirmation builders (baseline captured at call time)
// ---------------------------------------------------------------------------

/** Instance reaches one of `okStatuses`; going to Error after the send is a failure. */
export const confirmInstanceStatus = (
  store: Accessor<Store | null>,
  instanceId: string,
  okStatuses: Status[],
): (() => RemoteCheck) => {
  const baseline = store()?.instanceDB?.[instanceId]?.status ?? null;
  let leftBaseline = false;
  return () => {
    const inst = store()?.instanceDB?.[instanceId];
    if (!inst) return null;
    if (inst.status !== baseline) leftBaseline = true;
    if (okStatuses.includes(inst.status)) return 'ok';
    if (inst.status === 'Error' && (baseline !== 'Error' || leftBaseline)) {
      return { error: inst.statusCondition || 'The app went into an error state.' };
    }
    return null;
  };
};

/**
 * A NEW operation of `kind` on `instanceId` (not present at send time):
 * Done → ok, Failed/Cancelled → error. `fallbackOk` covers Engines whose op
 * record is late or pruned (e.g. the copied instance is already on the target).
 */
export const confirmNewOperation = (
  store: Accessor<Store | null>,
  kind: OperationKind,
  instanceId: string,
  fallbackOk?: () => boolean,
): (() => RemoteCheck) => {
  const baselineOps = new Set(Object.keys(store()?.operationDB ?? {}));
  return () => {
    const ops = Object.values(store()?.operationDB ?? {}).filter(
      (op) => !baselineOps.has(op.id) && op.kind === kind && String(op.args?.instanceId) === instanceId,
    );
    // 'Cancelled' is written by the Engine's cancelOperation (not in OperationStatus here).
    const failed = ops.find((op) => op.status === 'Failed' || String(op.status) === 'Cancelled');
    if (failed) return { error: failed.error || `${kind} ${String(failed.status) === 'Cancelled' ? 'was cancelled' : 'failed'}.` };
    if (ops.some((op) => op.status === 'Done')) return 'ok';
    if (fallbackOk?.()) return 'ok';
    return null;
  };
};

/** copyApp fallback: a new instance of the same app stored on the target disk. */
export const newInstanceOnDisk = (
  store: Accessor<Store | null>,
  diskId: string,
  match: { instanceOf?: string; name?: string },
): (() => boolean) => {
  const baselineIds = new Set(Object.keys(store()?.instanceDB ?? {}));
  return () => Object.values(store()?.instanceDB ?? {}).some((i) =>
    !baselineIds.has(i.id)
    && String(i.storedOn) === diskId
    && (match.instanceOf === undefined || i.instanceOf === match.instanceOf)
    && (match.name === undefined || i.name === match.name));
};

/** moveApp fallback: the instance now lives on the target disk. */
export const instanceStoredOn = (store: Accessor<Store | null>, instanceId: string, diskId: string): (() => boolean) =>
  () => String(store()?.instanceDB?.[instanceId]?.storedOn) === diskId;

/** backupApp fallback: lastBackup moved forward. */
export const lastBackupAdvanced = (store: Accessor<Store | null>, instanceId: string): (() => boolean) => {
  const baseline = store()?.instanceDB?.[instanceId]?.lastBackup ?? 0;
  return () => (store()?.instanceDB?.[instanceId]?.lastBackup ?? 0) > baseline;
};

/** installApp: a new instance with that name on the disk. */
export const confirmInstalled = (store: Accessor<Store | null>, diskId: string, instanceName?: string): (() => RemoteCheck) => {
  const found = newInstanceOnDisk(store, diskId, { name: instanceName });
  return () => (found() ? 'ok' : null);
};

/** reboot: the Engine booted again (lastBooted advanced). */
export const confirmRebooted = (store: Accessor<Store | null>, engineId: string): (() => RemoteCheck) => {
  const baseline = Number(store()?.engineDB?.[engineId]?.lastBooted ?? 0);
  return () => (Number(store()?.engineDB?.[engineId]?.lastBooted ?? 0) > baseline ? 'ok' : null);
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
