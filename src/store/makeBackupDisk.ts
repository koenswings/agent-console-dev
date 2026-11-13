/**
 * Console helpers for the blank-stick / empty-disk `makeBackupDisk` flow
 * (idea#404, Console PR 2).
 *
 * Agreed on idea#400 (issuecomment-6846779826) and Steve's decisions:
 *   command / Operation kind: `makeBackupDisk <diskOrCandidateId>`
 *   capability flag: `makeBackupDisk` (own flag, not scheduledBackups),
 *     with the usual capabilitiesBootedAt === lastBooted gate
 *   Operation step tokens: Check, Erase, Re-dock, Create
 *     (Erase is skipped on an adopted empty IDEA stick)
 *   leading result codes: TOO_SMALL, NOT_DOCKED, SYSTEM_DISK,
 *     NOT_EMPTY / erase guards, UNKNOWN (`CODE: text`)
 *
 * Engine main f114a28 has createBackupDisk, summariseDisk and eraseDisk, but
 * not makeBackupDisk (no command, capability, or Operation kind). This module
 * stays gated on MAKE_BACKUP_DISK_CAPABILITY and invents no Engine fields.
 *
 * MAKE_BACKUP_DISK_CAPABILITY and MAKE_BACKUP_DISK_STEPS each hold the
 * agreed flag / the four step tokens and their Console labels, so a later
 * Engine typo fix is still a single swap.
 */
import { engineHasCapability } from './commands';
import { isDiskLocked } from './operations';
import { GENERIC_ERROR_TEXT, plainEngineText } from './plainError';
import type { Engine, Operation, Store } from '../types/store';

/**
 * Own capability that gates the blank-stick / empty-disk flow.
 * Agreed: `makeBackupDisk`, not `scheduledBackups`.
 */
export const MAKE_BACKUP_DISK_CAPABILITY = 'makeBackupDisk' as const;

/** Agreed command name and Operation kind (same token). */
export const MAKE_BACKUP_DISK_COMMAND = 'makeBackupDisk';

/**
 * One confirm prepares the stick only: mode scheduled at the default 02:30,
 * no app linking (Steve, idea#404). Mode and time change later in settings.
 */
export const MAKE_BACKUP_DISK_EMPTY_CONFIRM =
  'This disk will back up every App on this Pi daily at 02:30. Apps are linked afterwards.';

export const MAKE_BACKUP_DISK_BLANK_CONFIRM =
  'It will back up every App on this Pi daily at 02:30. Apps are linked afterwards.';

export const MAKE_BACKUP_DISK_SUCCESS_MESSAGE = 'This disk is now a Backup Disk.';

export const MAKE_BACKUP_TIMEOUT_MESSAGE =
  "The Engine didn't respond. Check History for this command.";

/** Plain, teacher-facing text per agreed makeBackupDisk result code. */
export const MAKE_BACKUP_DISK_ERROR_TEXT: Record<string, string> = {
  TOO_SMALL: 'This stick is too small to be a Backup Disk',
  NOT_DOCKED: 'This disk is not plugged into this Pi.',
  SYSTEM_DISK: "This is the Pi's own system disk, so it cannot be a Backup Disk.",
  NOT_EMPTY: 'This disk is not empty, so it cannot be prepared as a Backup Disk this way.',
  UNKNOWN: GENERIC_ERROR_TEXT,
  // Common erase-guard codes the Check step may reuse (idea#400).
  BUSY: 'Another operation is running on this Pi. Wait for it to finish.',
  IN_USE_BY_APP: 'An app is using this disk. Stop the app first.',
  MOUNTED: 'The disk is in use (a part of it is mounted). Remove it from use first.',
  NOT_FOUND: 'This disk is no longer available.',
  OS_ROOTFS: "This disk holds an operating system, so it can't become a Backup Disk as it is.",
  NOT_EXT4: 'This disk is not formatted for IDEA yet.',
  ALREADY_IDEA: 'This disk is already an IDEA disk.',
};

const LEADING_CODE_RE = /^\s*([A-Z][A-Z0-9_]{2,})\s*:?\s*(.*)$/s;

/** Parse a leading `CODE:` (or a bare `CODE`) from an Engine error message. */
export const parseMakeBackupDiskCode = (
  raw: string | null | undefined,
): { code: string | null; detail: string } => {
  const msg = String(raw ?? '').trim();
  if (!msg) return { code: null, detail: '' };
  const m = LEADING_CODE_RE.exec(msg);
  if (!m) return { code: null, detail: msg };
  const code = m[1];
  if (MAKE_BACKUP_DISK_ERROR_TEXT[code] || code === 'UNKNOWN') {
    return { code, detail: m[2].trim() };
  }
  return { code: null, detail: msg };
};

/** Map a makeBackupDisk failure to plain wording (no codes, borg, YAML or helper). */
export const makeBackupDiskErrorText = (raw: string | null | undefined): string => {
  const { code, detail } = parseMakeBackupDiskCode(raw);
  if (code && MAKE_BACKUP_DISK_ERROR_TEXT[code]) return MAKE_BACKUP_DISK_ERROR_TEXT[code];
  return plainEngineText(detail || raw);
};

/** Build `makeBackupDisk <diskOrCandidateId>` (pure). The id is always an id, never a name. */
export const buildMakeBackupDiskCommand = (diskOrCandidateId: string): string =>
  `${MAKE_BACKUP_DISK_COMMAND} ${diskOrCandidateId}`;

export interface MakeBackupDiskStep {
  id: string;
  label: string;
}

/**
 * Agreed Operation step tokens (id) and the plain Console labels they map to.
 * Erase is skipped on an adopted empty IDEA stick (see `skipErase`).
 */
export const MAKE_BACKUP_DISK_STEPS: MakeBackupDiskStep[] = [
  { id: 'Check', label: 'Checking the stick' },
  { id: 'Erase', label: 'Erasing the disk' },
  { id: 'Re-dock', label: 'Waiting for the disk to come back' },
  { id: 'Create', label: 'Setting up the Backup Disk' },
];

/** Step token skipped on an already-adopted empty IDEA disk. */
export const MAKE_BACKUP_DISK_SKIP_ERASE_ON_ADOPTED = 'Erase';

/** Map an Engine stepLabel onto MAKE_BACKUP_DISK_STEPS ids (exact token first). */
const STEP_ALIASES: Record<string, string> = Object.fromEntries([
  ...MAKE_BACKUP_DISK_STEPS.flatMap((s) => [
    [s.id, s.id],
    [s.id.toLowerCase(), s.id],
    [s.label.toLowerCase(), s.id],
  ]),
  ['checking', 'Check'],
  ['erasing', 'Erase'],
  ['adopt', 'Re-dock'],
  ['redock', 'Re-dock'],
  ['re dock', 'Re-dock'],
  ['write', 'Create'],
  ['init', 'Create'],
  ['initialise', 'Create'],
  ['initialize', 'Create'],
]);

export interface MakeBackupDiskProgressView {
  currentId: string | null;
  label: string | null;
  percent: number | null;
  currentStep: number | null;
  totalSteps: number;
}

/** Resolve the current makeBackupDisk step from an Operation (or nothing yet). */
/** Steps to render, optionally omitting Erase on an adopted empty IDEA stick. */
export const makeBackupDiskStepsFor = (skipErase = false): MakeBackupDiskStep[] =>
  skipErase
    ? MAKE_BACKUP_DISK_STEPS.filter((s) => s.id !== MAKE_BACKUP_DISK_SKIP_ERASE_ON_ADOPTED)
    : MAKE_BACKUP_DISK_STEPS;

export const makeBackupDiskProgress = (
  op: Operation | null | undefined,
  skipErase = false,
): MakeBackupDiskProgressView => {
  const steps = makeBackupDiskStepsFor(skipErase);
  const totalSteps = steps.length;
  if (!op) {
    return { currentId: MAKE_BACKUP_DISK_STEPS[0].id, label: MAKE_BACKUP_DISK_STEPS[0].label, percent: null, currentStep: 1, totalSteps };
  }
  const rawLabel = (op.stepLabel ?? '').trim();
  const alias = rawLabel ? STEP_ALIASES[rawLabel.toLowerCase()] : undefined;
  let currentId: string | null = alias ?? null;
  if (!currentId && rawLabel) {
    const lower = rawLabel.toLowerCase();
    if (lower.includes('re-dock') || lower.includes('redock') || lower.includes('re dock')) currentId = 'Re-dock';
    else if (lower.includes('check')) currentId = 'Check';
    else if (lower.includes('erase')) currentId = 'Erase';
    else if (lower.includes('create') || lower.includes('write') || lower.includes('init') || lower.includes('adopt')) currentId = 'Create';
  }
  if (!currentId && op.currentStep != null) {
    // Accept 1-based (1..4) or 0-based (0..3).
    const n = op.currentStep;
    if (n >= 1 && n <= totalSteps) currentId = steps[n - 1].id;
    else if (n >= 0 && n < totalSteps) currentId = steps[n].id;
  }
  if (!currentId) currentId = MAKE_BACKUP_DISK_STEPS[0].id;
  const step = steps.find((s) => s.id === currentId) ?? steps[0];
  const index = steps.findIndex((s) => s.id === step.id);
  // Known tokens always use the Console label; unknown plain Engine text is kept.
  const isKnownToken = !!rawLabel && (!!STEP_ALIASES[rawLabel] || !!STEP_ALIASES[rawLabel.toLowerCase()]);
  const label = rawLabel && !isKnownToken && !/borg|yaml|helper/i.test(rawLabel)
    ? rawLabel
    : step.label;
  return {
    currentId: step.id,
    label,
    percent: op.progressPercent,
    currentStep: index >= 0 ? index + 1 : (op.currentStep ?? 1),
    totalSteps: op.totalSteps ?? totalSteps,
  };
};

const argIds = (op: Operation): string[] => {
  const args = op.args ?? {};
  return [
    op.subject?.id,
    args.diskId,
    args.candidateId,
    args.targetId,
    args.diskOrCandidateId,
  ].filter((id): id is string => id != null && String(id).length > 0).map(String);
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
 * Why the Make a Backup Disk action is disabled, or undefined when it may be
 * offered. Hidden entirely when the capability is absent (caller checks that).
 * There is no size rule — the Engine refuses TOO_SMALL at the Check step.
 */
export const makeBackupDiskBlockedReason = (
  engine: Engine | null | undefined,
  store: Store | null,
  targetId: string,
): string | undefined => {
  if (!engineHasCapability(engine, MAKE_BACKUP_DISK_CAPABILITY)) return undefined;
  if (engine?.eraseInProgress) {
    return `An erase of ${engine.eraseInProgress.label} is already in progress.`;
  }
  if (store?.diskDB[targetId] && isDiskLocked(store, targetId)) {
    return 'Operation in progress — cannot make a Backup Disk';
  }
  return undefined;
};
