/**
 * Backup Disk size gate (console#219): block a disk that is under the Engine's
 * 8 GiB minimum, or under 1.5× the measured App data it will hold.
 *
 * The 8 GiB floor matches makeBackupDisk's Check
 * (MAKE_BACKUP_DISK_MIN_BYTES = 8 × 1024³, compared with total sizeBytes).
 * createBackupDisk and initialiseDisk … backup do not enforce that floor on
 * the Engine; the Console still applies it so a teacher is not offered a
 * disk the Engine's Backup Disk policy would refuse.
 *
 * 1.5× leaves room for a first borg backup (roughly up to the current data;
 * we do not count on compression), later versions, and some growth after
 * dataBytes was measured.
 *
 * backupMethod 'none' is left out: those Apps copy nothing to the Backup Disk.
 * dataBytes unknown: warn, do not block (unless the 8 GiB floor already failed).
 * Disk size unknown: warn, do not block.
 */
import { formatAppDataSize } from './backupSizing';
import type { Disk, Instance, Store } from '../types/store';

/** Same constant as Engine MakeBackupDisk.ts MAKE_BACKUP_DISK_MIN_BYTES. */
export const BACKUP_DISK_MIN_BYTES = 8 * 1024 * 1024 * 1024;

/** Headroom on measured App data so a first backup, versions and growth fit. */
export const BACKUP_DISK_HEADROOM = 1.5;

export const BACKUP_DISK_TOO_SMALL_MIN =
  'Too small: needs more than 8 GB. Choose a disk larger than all the App data on this Pi.';

export const BACKUP_DISK_SIZE_UNKNOWN_WARN =
  "This disk's size isn't known yet, so we can't check whether it's big enough. You can continue.";

export const BACKUP_DISK_FREE_UNKNOWN_WARN =
  "This disk's free space isn't known yet, so we can't check whether the Apps will fit. You can continue.";

export type BackupDiskSizeWording = 'selected' | 'thisPi';

export interface BackupDiskSizeGate {
  /** True when the confirm action must be disabled and the command not sent. */
  blocked: boolean;
  /** Teacher-facing block reason; set only when blocked. */
  blockReason: string | undefined;
  /** Calm hint when we cannot fully check; unset when blocked. */
  warning: string | undefined;
  /** Instances considered for the size sum (already excluding method none, etc.). */
  instanceCount: number;
  measuredCount: number;
  unmeasuredCount: number;
  /** Sum of numeric dataBytes only. */
  measuredSum: number;
  /** 1.5 × measuredSum (0 when nothing is measured). */
  neededForApps: number;
}

const isMeasured = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Known, usable byte size; null for missing, 0, or non-finite. */
export const usableDiskBytes = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;

const appsWord = (n: number): string => (n === 1 ? '1 App' : `${n} Apps`);

/** "about 12 GB" or "less than 1 GB" (no "about"), matching #215. */
export const appDataSizePhrase = (bytes: number): string => {
  const size = formatAppDataSize(bytes);
  return size === 'less than 1 GB' ? size : `about ${size}`;
};

const theyUse = (measuredSum: number, unmeasuredCount: number): string => {
  const size = `They use ${appDataSizePhrase(measuredSum)}`;
  return unmeasuredCount > 0
    ? `${size} (${appsWord(unmeasuredCount)} not measured yet)`
    : size;
};

const appDataBlockReason = (
  wording: BackupDiskSizeWording,
  measuredSum: number,
  unmeasuredCount: number,
  neededForApps: number,
): string => {
  const who = wording === 'selected'
    ? 'This disk is too small for the Apps you chose.'
    : "This disk is too small for this Pi's Apps.";
  return `${who} ${theyUse(measuredSum, unmeasuredCount)}, so the Backup Disk needs ${appDataSizePhrase(neededForApps)}. Choose a larger disk.`;
};

const allUnmeasuredWarn = (wording: BackupDiskSizeWording): string => {
  const who = wording === 'selected'
    ? "The Apps you chose haven't been measured yet"
    : "This Pi's Apps haven't been measured yet";
  return `${who}, so we can't check whether this disk is big enough. You can continue, or wait until the sizes appear.`;
};

const mixedWarn = (
  wording: BackupDiskSizeWording,
  measuredSum: number,
  unmeasuredCount: number,
): string => {
  const who = wording === 'selected' ? 'The Apps you chose use' : "This Pi's Apps use";
  const rest = unmeasuredCount === 1
    ? "the App that hasn't been measured"
    : "the Apps that haven't been measured";
  return `${who} ${appDataSizePhrase(measuredSum)} (${appsWord(unmeasuredCount)} not measured yet). This disk looks large enough for the measured Apps, but we can't check ${rest}.`;
};

const countsOf = (instances: Instance[]) => {
  let measuredSum = 0;
  let measuredCount = 0;
  for (const inst of instances) {
    if (isMeasured(inst.dataBytes)) {
      measuredSum += inst.dataBytes;
      measuredCount += 1;
    }
  }
  return {
    instanceCount: instances.length,
    measuredCount,
    unmeasuredCount: instances.length - measuredCount,
    measuredSum,
    neededForApps: measuredCount > 0 ? measuredSum * BACKUP_DISK_HEADROOM : 0,
  };
};

const emptyGate = (over: Partial<BackupDiskSizeGate> = {}): BackupDiskSizeGate => ({
  blocked: false,
  blockReason: undefined,
  warning: undefined,
  instanceCount: 0,
  measuredCount: 0,
  unmeasuredCount: 0,
  measuredSum: 0,
  neededForApps: 0,
  ...over,
});

export interface AssessBackupDiskSizeArgs {
  /** Instances this disk will copy (already excluding method none, demos, etc.). */
  instances: Instance[];
  /** Total disk size; used for the 8 GiB floor (Engine makeBackupDisk Check). */
  totalSizeBytes: number | null | undefined;
  /**
   * Capacity for the 1.5× App-data rule. Defaults to totalSizeBytes.
   * Pass freeBytes for a disk that already holds App or Files data (#211).
   * If this is passed as null, the 1.5× rule warns and does not block;
   * the 8 GiB floor still uses totalSizeBytes.
   */
  capacityBytes?: number | null;
  wording: BackupDiskSizeWording;
}

/**
 * Decide whether to block or warn when making a Backup Disk.
 * Pure; no store reads.
 */
export const assessBackupDiskSize = (args: AssessBackupDiskSizeArgs): BackupDiskSizeGate => {
  const stats = countsOf(args.instances);
  const total = usableDiskBytes(args.totalSizeBytes);
  const capacityExplicit = args.capacityBytes !== undefined;
  const capacity = capacityExplicit ? usableDiskBytes(args.capacityBytes) : total;

  const underMin = total != null && total < BACKUP_DISK_MIN_BYTES;
  const underApps = stats.measuredCount > 0 && capacity != null && capacity < stats.neededForApps;

  if (underMin || underApps) {
    const preferAppsWording = underApps && (!underMin || stats.neededForApps > BACKUP_DISK_MIN_BYTES);
    return emptyGate({
      ...stats,
      blocked: true,
      blockReason: preferAppsWording
        ? appDataBlockReason(args.wording, stats.measuredSum, stats.unmeasuredCount, stats.neededForApps)
        : BACKUP_DISK_TOO_SMALL_MIN,
    });
  }

  let warning: string | undefined;
  if (total == null && !capacityExplicit) {
    warning = BACKUP_DISK_SIZE_UNKNOWN_WARN;
  } else if (capacityExplicit && capacity == null) {
    warning = BACKUP_DISK_FREE_UNKNOWN_WARN;
  } else if (stats.instanceCount > 0 && stats.measuredCount === 0) {
    warning = allUnmeasuredWarn(args.wording);
  } else if (stats.unmeasuredCount > 0) {
    warning = mixedWarn(args.wording, stats.measuredSum, stats.unmeasuredCount);
  }

  return emptyGate({ ...stats, warning });
};

const isNoneMethod = (inst: Instance): boolean => inst.backupMethod === 'none';

/**
 * Instances the EmptyDiskPanel createBackupDisk form will copy:
 * the ticked ids, excluding backupMethod 'none' (they take no Backup Disk space).
 */
export const instancesForLinkedBackup = (
  store: Pick<Store, 'instanceDB'> | null | undefined,
  selectedIds: string[],
): Instance[] => {
  if (!store) return [];
  const out: Instance[] = [];
  for (const id of selectedIds) {
    const inst = store.instanceDB?.[id];
    if (inst && !isNoneMethod(inst)) out.push(inst);
  }
  return out;
};

/**
 * Instances a scheduled Backup Disk with no links will copy (engine#424):
 * stored on a disk docked to this Engine, with a device, not a demo, not
 * stored on the target disk itself, and not backupMethod 'none'.
 */
export const instancesForAllAppsOnPi = (
  store: Pick<Store, 'diskDB' | 'instanceDB'> | null | undefined,
  engineId: string | null | undefined,
  excludeDiskId?: string | null,
): Instance[] => {
  if (!store || !engineId) return [];
  const docked = new Set(
    Object.values(store.diskDB ?? {})
      .filter((disk): disk is Disk =>
        !!disk && !!disk.device && String(disk.dockedTo) === String(engineId),
      )
      .map((disk) => String(disk.id)),
  );
  const exclude = excludeDiskId != null && excludeDiskId !== '' ? String(excludeDiskId) : null;
  const out: Instance[] = [];
  for (const inst of Object.values(store.instanceDB ?? {})) {
    if (!inst?.storedOn || !docked.has(String(inst.storedOn))) continue;
    if (inst.demo === true) continue;
    if (exclude && String(inst.storedOn) === exclude) continue;
    if (isNoneMethod(inst)) continue;
    out.push(inst);
  }
  return out;
};
