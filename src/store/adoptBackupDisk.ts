/**
 * "Make this also a Backup Disk" on an App or Files disk (agent-console-dev#209,
 * idea#404). The Engine's makeBackupDisk adopts an already-adopted IDEA disk
 * without erasing it (agent-engine-dev#355; read at Engine main 4b57456,
 * `src/data/MakeBackupDisk.ts`, unchanged since bc5bd78):
 *
 *   command:   makeBackupDisk <diskId>. A docked IDEA disk resolves to
 *              kind 'disk', so needsErase is false: no summary, no typed label.
 *   steps:     Check → Erase (skipped) → Re-dock (skipped) → Create.
 *   refusals:  SYSTEM_DISK, NOT_DOCKED, ALREADY_BACKUP, BUSY, TOO_SMALL (also
 *              for an unknown size), NOT_FOUND, BAD_ARGS, WRITE_FAILED. IN_USE
 *              is not raised on this path: the disk keeps its App instances.
 *   Create:    BACKUP.yaml (scheduled, daily 02:30, links: []) and backups/,
 *              then processDisk, so diskTypes becomes e.g. ['app', 'backup'].
 *
 * Koen's decision (via Steve, 15 Nov): a scheduled Backup Disk backs up every
 * App on its Pi, new ones included. engine#424 (Engine PR #431, 865df67,
 * `src/monitors/backupScheduler.ts` `scheduledTargets`) does this for a disk
 * with no links, at each run, and leaves out demo instances and the instances
 * stored on the Backup Disk itself. There is no link-Apps step.
 * Reuses the #187 helpers in ./makeBackupDisk, and the shared size gate
 * (console#219) with Disk.freeBytes as the capacity for the App data.
 */
import { engineHasCapability } from './commands';
import { hasAppRole } from './diskRoles';
import {
  MAKE_BACKUP_DISK_CAPABILITY,
  MAKE_BACKUP_DISK_COMMAND,
  MAKE_BACKUP_DISK_TIME,
  MAKE_BACKUP_DISK_TOO_SMALL_REASON,
  findMakeBackupDiskOp,
  makeBackupDiskBlockedReason,
  makeBackupDiskErrorText,
  makeBackupDiskSizeGate,
  parseMakeBackupDiskCode,
} from './makeBackupDisk';
import type { BackupDiskSizeGate } from './backupDiskSizeGate';
import type { RemoteCheck } from './remoteConfirm';
import type { Disk, Engine, Store } from '../types/store';

export const ADOPT_BACKUP_DISK_ACTION = 'Make this also a Backup Disk';

export const ADOPT_BACKUP_DISK_KEEP = 'Nothing on this disk is erased. Its Apps and files stay.';

export const ADOPT_BACKUP_DISK_SCHEDULE =
  `Backups run every day at ${MAKE_BACKUP_DISK_TIME} for every App on this Pi. ` +
  'You can change the time later.';

/**
 * Shown only when the disk holds App instances. The Engine leaves instances
 * stored on the Backup Disk itself out of a no-links run (engine#424,
 * backupScheduler.ts scheduledTargets), so this states that; it does not block.
 */
export const ADOPT_BACKUP_DISK_SAME_DISK_WARNING =
  'Apps stored on this disk are not backed up onto it. Move them to another disk to protect them.';

export const ADOPT_BACKUP_DISK_SUCCESS_MESSAGE = 'This disk is now also a Backup Disk.';

/** Apps without x-app.backup use the Engine's default method 'stop'. */
export const ADOPT_BACKUP_DISK_SUCCESS_HINT =
  `Backups run every day at ${MAKE_BACKUP_DISK_TIME} for every App on this Pi. ` +
  'Apps pause for a moment while a backup runs.';

/**
 * Size grey-out and TOO_SMALL wording: the #187 text. The Engine allows
 * exactly 8 GiB, but a stick sold as "8 GB" is smaller than that.
 */
export const ADOPT_BACKUP_DISK_TOO_SMALL_REASON = MAKE_BACKUP_DISK_TOO_SMALL_REASON;

export const ADOPT_BACKUP_DISK_SIZE_UNKNOWN =
  "The Pi couldn't read the size of this disk, so nothing was changed. Unplug it, plug it back in and try again.";

/** Confirm title naming the disk. */
export const adoptBackupDiskTitle = (name: string): string => `Make ${name} also a Backup Disk?`;

/** True when at least one instance is stored on this disk. */
export const diskHoldsInstances = (store: Store | null | undefined, diskId: string): boolean =>
  !!store && Object.values(store.instanceDB ?? {}).some((i) => String(i.storedOn) === String(diskId));

/**
 * Offer the action on an App or Files disk that has no Backup role yet, when
 * the Engine it is docked to has a fresh 'makeBackupDisk' flag. Hidden (not
 * greyed out) without the flag, on a Backup Disk, on the system disk and on
 * a disk that is not docked.
 */
export const canOfferAdoptBackupDisk = (
  disk: Disk | null | undefined,
  engine: Engine | null | undefined,
  store: Store | null | undefined,
): boolean => {
  if (!disk || !disk.device || !disk.dockedTo) return false;
  if (!engineHasCapability(engine, MAKE_BACKUP_DISK_CAPABILITY)) return false;
  const types = disk.diskTypes ?? [];
  if (types.includes('system') || types.includes('backup') || disk.backupConfig != null) return false;
  return types.includes('files') || hasAppRole(disk, store ?? null);
};

/**
 * The shared Backup Disk size gate (console#219) for this disk: the 8 GiB
 * floor on total Disk.sizeBytes (what the Engine checks), and 1.5× the
 * measured App data of every App this disk will back up compared with
 * Disk.freeBytes, because the disk already holds App or Files data. Unknown
 * free space warns and does not block the App-data part.
 */
export const adoptBackupDiskSizeGate = (
  engine: Engine | null | undefined,
  store: Store | null,
  diskId: string,
): BackupDiskSizeGate | null =>
  makeBackupDiskSizeGate(engine, store, diskId, store?.diskDB?.[diskId]?.freeBytes ?? null);

/**
 * Why the action is greyed out, or undefined: the size gate first (8 GiB
 * floor, App data against free space), then the shared #187 reasons (erase
 * running, disk locked). An unknown size is left to the Engine.
 */
export const adoptBackupDiskBlockedReason = (
  engine: Engine | null | undefined,
  store: Store | null,
  diskId: string,
): string | undefined =>
  makeBackupDiskBlockedReason(engine, store, diskId, store?.diskDB?.[diskId]?.freeBytes ?? null);

const SIZE_UNKNOWN_RE = /could not read the size/i;

/** Plain wording for a failure on this flow (no codes, borg, YAML or helper names). */
export const adoptBackupDiskErrorText = (
  raw: string | null | undefined,
  errorCode?: string | null,
): string => {
  const { code, detail } = parseMakeBackupDiskCode(raw, errorCode);
  if (code === 'TOO_SMALL') {
    return SIZE_UNKNOWN_RE.test(detail) || SIZE_UNKNOWN_RE.test(String(raw ?? ''))
      ? ADOPT_BACKUP_DISK_SIZE_UNKNOWN
      : ADOPT_BACKUP_DISK_TOO_SMALL_REASON;
  }
  return makeBackupDiskErrorText(raw, errorCode);
};

/** Ids of the makeBackupDisk Operations already in the store for this disk (send-time baseline). */
export const makeBackupDiskOpIds = (store: Store | null | undefined, diskId: string): Set<string> =>
  new Set(
    Object.values(store?.operationDB ?? {})
      .filter((op) => op.kind === MAKE_BACKUP_DISK_COMMAND && String(op.subject?.id ?? op.args?.targetId) === String(diskId))
      .map((op) => String(op.id)),
  );

/**
 * Cross-Engine confirmation from the store: a makeBackupDisk Operation that
 * was not there at send time is Done and the disk has the Backup role (the
 * Engine closes the Operation only after Create's processDisk), or it Failed.
 */
export const adoptBackupDiskRemoteCheck = (
  store: Store | null | undefined,
  engineId: string,
  diskId: string,
  baseline: Set<string>,
): RemoteCheck => {
  const op = findMakeBackupDiskOp(store, engineId, diskId);
  if (!op || baseline.has(String(op.id))) return null;
  if (op.status === 'Failed') {
    const raw = op.error ?? '';
    return { error: raw, code: parseMakeBackupDiskCode(raw).code };
  }
  if (op.status === 'Done' && (store?.diskDB?.[diskId]?.diskTypes ?? []).includes('backup')) return 'ok';
  return null;
};
