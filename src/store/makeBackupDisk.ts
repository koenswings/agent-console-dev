/**
 * Console helpers for the blank-stick / empty-disk `makeBackupDisk` flow
 * (idea#404, Console PR 2). Coded to Engine main bc5bd78 (agent-engine-dev#355,
 * `src/data/MakeBackupDisk.ts`, COMMANDS.md `makeBackupDisk`):
 *
 *   command:   makeBackupDisk <targetId> [<summaryTraceId> <confirmName…>]
 *              targetId = a docked disk id or an unformatted candidateId.
 *              summaryTraceId + the typed label are required when Erase runs
 *              (blank stick / candidate) and omitted when it is skipped
 *              (an adopted IDEA disk).
 *   capability: 'makeBackupDisk' (always on), fresh when
 *              capabilitiesBootedAt === lastBooted.
 *   Operation: kind 'makeBackupDisk', subject { type: 'disk', id: targetId },
 *              args { targetId, summaryTraceId?, confirmName? }; stepLabel
 *              Check / Erase / Re-dock / Create (0-based currentStep 0..3,
 *              totalSteps 4); on an adopted disk the Engine reports
 *              'Erase (skipped)' and 'Re-dock (skipped)'.
 *   result:    trace ok with result { targetId, diskId, erased, mode:
 *              'scheduled', schedule: '02:30' }; diskId equals the candidateId
 *              after an erase. Failures are `CODE: text` (trace errorCode and
 *              Operation error).
 *   Create:    BACKUP.yaml mode scheduled, daily 02:30, no links, backups/ root;
 *              the disk is re-processed so diskTypes gains 'backup'.
 *   Koen's decision (via Steve, idea#404): a new Backup Disk backs up every
 *   App on its Pi, new ones included, with no link step. Engine bc5bd78 still
 *   runs only `yaml.links` (backupScheduler.ts runDisk); engine#424 (Axle)
 *   makes it back up every App. The copy states the decided behaviour and
 *   does not promise a first backup at a set time.
 */
import { engineHasCapability } from './commands';
import { isDiskLocked } from './operations';
import { GENERIC_ERROR_TEXT, plainEngineText } from './plainError';
import {
  BACKUP_DISK_MIN_BYTES,
  BACKUP_DISK_TOO_SMALL_MIN,
  assessBackupDiskSize,
  instancesForAllAppsOnPi,
  type BackupDiskSizeGate,
} from './backupDiskSizeGate';
import type { Engine, Operation, Store } from '../types/store';

/** Own capability that gates the flow (engine#355, always on). */
export const MAKE_BACKUP_DISK_CAPABILITY = 'makeBackupDisk' as const;

/** Command name and Operation kind (same token). */
export const MAKE_BACKUP_DISK_COMMAND = 'makeBackupDisk';

/** Default daily time the Engine writes at Create (DEFAULT_BACKUP_TIME). */
export const MAKE_BACKUP_DISK_TIME = '02:30';

/**
 * Size wording (Steve, idea#404, 15 Nov 16:05). The Engine limit is 8 GiB
 * (MAKE_BACKUP_DISK_MIN_BYTES), so a stick sold as "8 GB" (8·10⁹ bytes) is
 * refused. A Backup Disk holds every App on the Pi (engine#424), so the
 * guidance is tied to the Pi's App data, not a fixed size.
 * The grey-out uses the shared Backup Disk size gate (console#219,
 * backupDiskSizeGate.ts): the 8 GiB floor on total size plus 1.5× the
 * measured App data of every App on this Pi (instancesForAllAppsOnPi, the
 * same set as the Engine's scheduledTargets, engine#424). When the 8 GiB
 * floor is the one that fails, the reason is MAKE_BACKUP_DISK_TOO_SMALL_REASON
 * (also the TOO_SMALL error text); a requirement stated on its own uses
 * MAKE_BACKUP_DISK_SIZE_NEED.
 */
export const MAKE_BACKUP_DISK_SIZE_GUIDANCE = 'Choose a disk larger than all the App data on this Pi.';
export const MAKE_BACKUP_DISK_TOO_SMALL_REASON = BACKUP_DISK_TOO_SMALL_MIN;
export const MAKE_BACKUP_DISK_SIZE_NEED = `Needs a disk larger than 8 GB. ${MAKE_BACKUP_DISK_SIZE_GUIDANCE}`;

/** Adopted empty IDEA disk: nothing is erased. */
export const MAKE_BACKUP_DISK_EMPTY_CONFIRM =
  `Nothing on this disk is erased. Backups run every day at ${MAKE_BACKUP_DISK_TIME} ` +
  'for every App on this Pi. You can change the time later.';

/** Blank stick: shown under the erase warning in the typed-confirm dialog. */
export const MAKE_BACKUP_DISK_BLANK_CONFIRM =
  `After erasing, backups run every day at ${MAKE_BACKUP_DISK_TIME} ` +
  'for every App on this Pi. You can change the time later.';

export const MAKE_BACKUP_DISK_SUCCESS_MESSAGE = 'This disk is now a Backup Disk.';

/**
 * Apps without x-app.backup use method 'stop' (Engine backupMethod.ts
 * defaultBackupSpec), so a backup stops and restarts a running App.
 */
export const MAKE_BACKUP_DISK_SUCCESS_HINT =
  `Backups run every day at ${MAKE_BACKUP_DISK_TIME} for every App on this Pi. ` +
  'Apps pause for a moment while a backup runs.';

export const MAKE_BACKUP_TIMEOUT_MESSAGE =
  "The Engine didn't respond. Check History for this command.";

/** Plain, teacher-facing text per makeBackupDisk result code (engine#355). */
export const MAKE_BACKUP_DISK_ERROR_TEXT: Record<string, string> = {
  BAD_ARGS: 'Something went wrong sending this. Close this window and try again.',
  NOT_FOUND: 'This disk is no longer available. Check that it is plugged in.',
  SYSTEM_DISK: "This is the Pi's own system disk, so it can't be a Backup Disk.",
  NOT_DOCKED: 'This disk is not plugged into this Pi.',
  ALREADY_BACKUP: 'This disk is already a Backup Disk.',
  BUSY: 'Something else is running on this Pi. Wait for it to finish, then try again.',
  IN_USE: 'An app is using this disk. Stop or move the app first.',
  SUMMARY_STALE: 'The check of this disk is too old. Check the disk again.',
  CONFIRM_MISMATCH: "The name you typed doesn't match the disk's name.",
  SERIAL_MISMATCH: 'This is not the disk that was checked. Check the disk again.',
  // Same text as the grey-out (Steve, round 3): an "8 GB" stick is under 8 GiB.
  TOO_SMALL: MAKE_BACKUP_DISK_TOO_SMALL_REASON,
  UNPLUGGED: 'The disk was unplugged during setup. Plug it back in and try again.',
  REDOCK_TIMEOUT: "The disk was erased but didn't come back. Unplug it, plug it back in and try again.",
  HIDDEN_PARTITIONS: 'This disk has hidden parts, so it was not erased.',
  OS_ROOTFS: 'This disk holds an operating system, so it was not erased.',
  INVALID_INSTANCE_ID: GENERIC_ERROR_TEXT,
  WRITE_FAILED: 'Setting up the Backup Disk failed. Try again.',
};

const LEADING_CODE_RE = /^\s*([A-Z][A-Z0-9_]{2,})\s*:\s*(.*)$/s;

/**
 * Read the result code: the trace's errorCode when given, else a leading
 * `CODE:` in the message. Unknown codes are kept out (plain text is used).
 */
export const parseMakeBackupDiskCode = (
  raw: string | null | undefined,
  errorCode?: string | null,
): { code: string | null; detail: string } => {
  const msg = String(raw ?? '').trim();
  const m = LEADING_CODE_RE.exec(msg);
  const detail = m ? m[2].trim() : msg;
  if (errorCode && MAKE_BACKUP_DISK_ERROR_TEXT[errorCode]) return { code: errorCode, detail };
  if (m && MAKE_BACKUP_DISK_ERROR_TEXT[m[1]]) return { code: m[1], detail };
  return { code: null, detail: msg };
};

/** Map a makeBackupDisk failure to plain wording (no codes, borg, YAML or helper). */
export const makeBackupDiskErrorText = (
  raw: string | null | undefined,
  errorCode?: string | null,
): string => {
  const { code, detail } = parseMakeBackupDiskCode(raw, errorCode);
  if (code) return MAKE_BACKUP_DISK_ERROR_TEXT[code];
  return plainEngineText(detail || raw);
};

export interface MakeBackupDiskStep {
  id: string;
  label: string;
}

/** Operation stepLabel tokens (engine#355) and the plain Console labels. */
export const MAKE_BACKUP_DISK_STEPS: MakeBackupDiskStep[] = [
  { id: 'Check', label: 'Checking the disk' },
  { id: 'Erase', label: 'Erasing the disk' },
  { id: 'Re-dock', label: 'Waiting for the disk to come back' },
  { id: 'Create', label: 'Setting up the Backup Disk' },
];

/** Steps the Engine skips on an adopted IDEA disk (stepLabel '<token> (skipped)'). */
export const MAKE_BACKUP_DISK_SKIPPED_ON_ADOPTED = ['Erase', 'Re-dock'];

const SKIPPED_SUFFIX_RE = /\s*\(skipped\)\s*$/i;

/** Steps to show: all four for a blank stick, Check + Create for an adopted disk. */
export const makeBackupDiskStepsFor = (adopted = false): MakeBackupDiskStep[] =>
  adopted
    ? MAKE_BACKUP_DISK_STEPS.filter((s) => !MAKE_BACKUP_DISK_SKIPPED_ON_ADOPTED.includes(s.id))
    : MAKE_BACKUP_DISK_STEPS;

export interface MakeBackupDiskProgressView {
  /** Current step token (always one of the shown steps). */
  currentId: string;
  label: string;
  percent: number | null;
}

/**
 * The current step from the Operation: the exact stepLabel token first, else
 * the 0-based currentStep. A skipped token counts as the next shown step.
 */
export const makeBackupDiskProgress = (
  op: Operation | null | undefined,
  adopted = false,
): MakeBackupDiskProgressView => {
  const steps = makeBackupDiskStepsFor(adopted);
  if (!op) return { currentId: steps[0].id, label: steps[0].label, percent: null };
  const raw = (op.stepLabel ?? '').trim();
  const token = raw.replace(SKIPPED_SUFFIX_RE, '');
  let fullIndex = MAKE_BACKUP_DISK_STEPS.findIndex((s) => s.id === token);
  if (fullIndex < 0 && op.currentStep != null && op.currentStep >= 0 && op.currentStep < MAKE_BACKUP_DISK_STEPS.length) {
    fullIndex = op.currentStep;
  }
  if (fullIndex < 0) fullIndex = 0;
  if (SKIPPED_SUFFIX_RE.test(raw)) fullIndex = Math.min(fullIndex + 1, MAKE_BACKUP_DISK_STEPS.length - 1);
  // Nearest shown step at or after the Engine's step.
  const step = MAKE_BACKUP_DISK_STEPS.slice(fullIndex).find((s) => steps.some((v) => v.id === s.id))
    ?? steps[steps.length - 1];
  return { currentId: step.id, label: step.label, percent: op.progressPercent ?? null };
};

const argIds = (op: Operation): string[] => {
  const args = op.args ?? {};
  return [op.subject?.id, args.targetId]
    .filter((id): id is string => id != null && String(id).length > 0)
    .map(String);
};

/** The current (or most recent) makeBackupDisk Operation for this disk or candidate. */
export const findMakeBackupDiskOp = (
  store: Store | null | undefined,
  engineId: string | undefined,
  targetId: string | undefined,
): Operation | null => {
  if (!store || !targetId) return null;
  const ops = Object.values(store.operationDB ?? {});
  const matches = ops.filter((op) => {
    if (op.kind !== MAKE_BACKUP_DISK_COMMAND) return false;
    if (engineId && op.engineId && String(op.engineId) !== String(engineId)) return false;
    return argIds(op).includes(targetId);
  });
  if (matches.length === 0) return null;
  const active = matches.filter((op) => op.status === 'Pending' || op.status === 'Running');
  const pool = active.length > 0 ? active : matches;
  return pool.reduce((a, b) => ((b.startedAt ?? 0) > (a.startedAt ?? 0) ? b : a));
};

/**
 * Engine minimum (MakeBackupDisk.ts MAKE_BACKUP_DISK_MIN_BYTES, bc5bd78): 8 GiB.
 * The Engine refuses `bytes < MIN` with TOO_SMALL at Check.
 */
export const MAKE_BACKUP_DISK_MIN_BYTES = BACKUP_DISK_MIN_BYTES;


const usableSize = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;

/**
 * The size the Engine compares, read from the same store fields
 * (MakeBackupDisk.ts sizeOf + SummariseDisk.ts resolveSummaryTarget):
 * a disk docked to this Engine with a device → Disk.sizeBytes; else
 * Engine.unformattedDisks[].sizeBytes; else an erasable usbDisk in
 * Engine.diskCandidates[].sizeBytes. Null when unknown (the Console then
 * leaves the decision to the Engine).
 */
export const makeBackupDiskSizeBytes = (
  engine: Engine | null | undefined,
  store: Store | null | undefined,
  targetId: string,
): number | null => {
  if (!engine) return null;
  const disk = store?.diskDB?.[targetId];
  if (disk && disk.device && String(disk.dockedTo) === String(engine.id)) return usableSize(disk.sizeBytes);
  const cand = engine.unformattedDisks?.find((c) => c.candidateId === targetId);
  if (cand) return usableSize(cand.sizeBytes);
  const dc = (engine.diskCandidates ?? []).find(
    (c) => c?.candidateId === targetId && c.kind === 'usbDisk' && (c.actions ?? []).includes('erase'),
  );
  return dc ? usableSize(dc.sizeBytes) : null;
};

/** True only when the size is known and below the Engine's 8 GiB minimum. */
export const isTooSmallForBackupDisk = (bytes: number | null): boolean =>
  bytes != null && bytes < MAKE_BACKUP_DISK_MIN_BYTES;

/**
 * The shared Backup Disk size gate (console#219) for a makeBackupDisk target:
 * the 8 GiB floor on the size the Engine compares, plus 1.5× the measured
 * App data of every App this disk will back up (engine#424: every instance
 * on a disk docked to the same Engine, except demos, instances on the target
 * itself and backupMethod 'none'). `capacityBytes` is the space left for
 * backups when the disk already holds data (#211 passes Disk.freeBytes);
 * leave it out for a blank or empty disk, where total size is the capacity.
 * Null when the Engine is unknown.
 */
export const makeBackupDiskSizeGate = (
  engine: Engine | null | undefined,
  store: Store | null | undefined,
  targetId: string,
  capacityBytes?: number | null,
): BackupDiskSizeGate | null => {
  if (!engine) return null;
  const args = {
    instances: instancesForAllAppsOnPi(store, String(engine.id), targetId),
    totalSizeBytes: makeBackupDiskSizeBytes(engine, store, targetId),
    wording: 'thisPi' as const,
  };
  return assessBackupDiskSize(capacityBytes === undefined ? args : { ...args, capacityBytes });
};

/**
 * Why the Make a Backup Disk action is disabled, or undefined when it may be
 * offered. Hidden entirely when the capability is absent (caller checks that).
 * A disk the size gate blocks (under 8 GiB, or under 1.5× the Pi's measured
 * App data) is greyed out before anything is typed; an unknown size is left
 * to the Engine (TOO_SMALL stays mapped as a fallback).
 */
export const makeBackupDiskBlockedReason = (
  engine: Engine | null | undefined,
  store: Store | null,
  targetId: string,
  capacityBytes?: number | null,
): string | undefined => {
  if (!engineHasCapability(engine, MAKE_BACKUP_DISK_CAPABILITY)) return undefined;
  const gate = makeBackupDiskSizeGate(engine, store, targetId, capacityBytes);
  if (gate?.blocked) return gate.blockReason;
  if (engine?.eraseInProgress) {
    return `An erase of ${engine.eraseInProgress.label} is already in progress.`;
  }
  if (store?.diskDB[targetId] && isDiskLocked(store, targetId)) {
    return 'Operation in progress — cannot make a Backup Disk';
  }
  return undefined;
};

/** The size-gate block reason alone (for hints), or undefined. */
export const makeBackupDiskSizeBlock = (gate: BackupDiskSizeGate | null): string | undefined =>
  gate?.blocked ? gate.blockReason : undefined;
