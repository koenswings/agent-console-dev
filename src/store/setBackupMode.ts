/**
 * Backup Disk mode and schedule controls (idea#400, Engine f114a28).
 *
 * Command: setBackupMode <backupDiskId> <immediate|on-demand|scheduled> [HH:MM]
 * sent to the Engine in Disk.dockedTo, always by id. Shown only when that
 * Engine advertises a fresh scheduledBackups capability.
 *
 * Operator copy has no jargon (no borg, YAML, helper, command names, or
 * result-code tokens). lastRun is never written from the Console.
 */

import { plainEngineText } from './plainError';
import type { BackupMode } from '../types/store';

/** Capability that gates the schedule controls. Engine f114a28. */
export const SCHEDULED_BACKUPS_CAPABILITY = 'scheduledBackups' as const;

export const SET_BACKUP_MODE_COMMAND = 'setBackupMode';

/** Default daily time when schedule is absent or invalid (Engine createBackupDisk / setBackupMode). */
export const DEFAULT_BACKUP_TIME = '02:30';

export const SET_BACKUP_MODE_TIMEOUT_MESSAGE =
  "The Engine didn't respond. Check History.";

export const SCHEDULE_ERROR_COPY =
  'The saved backup time is not valid, so this disk runs at 02:30 until it is fixed.';

export const BACKUP_MODE_OPTIONS: { value: BackupMode; label: string; description: string }[] = [
  {
    value: 'on-demand',
    label: 'On demand',
    description: 'Back up only when you press Back up.',
  },
  {
    value: 'immediate',
    label: 'Immediate',
    description: 'Back up when this disk is next plugged in.',
  },
  {
    value: 'scheduled',
    label: 'Scheduled',
    description: "Back up every day at a time you choose (this Pi's local time).",
  },
];

/** Plain wording for every setBackupMode refusal code (Engine f114a28). */
export const SET_BACKUP_MODE_ERROR_TEXT: Record<string, string> = {
  NOT_DOCKED: "This Backup Disk isn't plugged into this Pi.",
  AMBIGUOUS: "That name matches more than one disk. Use the disk's id.",
  SYSTEM_DISK: "This is the Pi's own system disk, so its backup mode can't be changed.",
  NOT_A_BACKUP_DISK: "This isn't a Backup Disk.",
  BAD_BACKUP_YAML: "This Backup Disk's settings couldn't be read, so the mode wasn't changed.",
  BAD_MODE: "That isn't a valid backup mode.",
  BAD_TIME: "That isn't a valid time. Use 24-hour time, for example 02:30.",
  BUSY: 'A backup is already running on this disk. Try again when it has finished.',
};

const LEADING_CODE_RE = /^\s*([A-Z][A-Z0-9_]{2,}):/;

/** Leading refusal code from `CODE: setBackupMode: …`, or null. */
export const leadingErrorCode = (raw: string | null | undefined): string | null => {
  const m = LEADING_CODE_RE.exec(String(raw ?? '').trim());
  return m ? m[1] : null;
};

/** Plain, teacher-facing text for a setBackupMode refusal. */
export const setBackupModeErrorText = (raw: string | null | undefined): string => {
  const code = leadingErrorCode(raw);
  if (code && SET_BACKUP_MODE_ERROR_TEXT[code]) return SET_BACKUP_MODE_ERROR_TEXT[code];
  return plainEngineText(raw);
};

/**
 * Parse a daily time. Accepts `H:MM` or `HH:MM` (00:00–23:59).
 * Returns null if the string is not a time.
 */
export const parseDailyTime = (daily: string): { hours: number; minutes: number } | null => {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(daily.trim());
  if (!m) return null;
  return { hours: Number(m[1]), minutes: Number(m[2]) };
};

/** Normalise a valid daily time to `HH:MM`, or null if it is not a time. */
export const normalizeDailyTime = (raw: string): string | null => {
  const parsed = parseDailyTime(raw);
  if (!parsed) return null;
  const hh = String(parsed.hours).padStart(2, '0');
  const mm = String(parsed.minutes).padStart(2, '0');
  return `${hh}:${mm}`;
};

/** Client-side time check. Returns an error message, or null when valid. */
export const validateBackupTime = (raw: string): string | null => {
  if (raw.trim() === '') return 'Enter a time, for example 02:30.';
  if (!normalizeDailyTime(raw)) return SET_BACKUP_MODE_ERROR_TEXT.BAD_TIME;
  return null;
};

/** The success payload Engine f114a28 attaches to the setBackupMode trace. */
export interface SetBackupModeTraceResult {
  backupDiskId?: string;
  previousMode?: string;
  mode?: string;
  schedule?: { daily: string } | null;
  scheduleError?: string | null;
  changed?: boolean;
  note?: string;
}

/**
 * Plain success line from the Engine result's `changed` and `note` fields
 * (mode and schedule). The raw note is not shown: it can name commands.
 */
export const plainSetBackupModeSuccess = (result: SetBackupModeTraceResult): string => {
  const daily = result.schedule?.daily;
  const time = daily && parseDailyTime(daily) ? normalizeDailyTime(daily) : DEFAULT_BACKUP_TIME;
  let body: string;
  if (result.mode === 'scheduled') {
    body = `This disk will back up every day at ${time} (this Pi's local time).`;
  } else if (result.mode === 'immediate') {
    body = 'This disk will back up when it is next plugged in.';
  } else if (result.mode === 'on-demand') {
    body = 'This disk will back up only when you press Back up.';
  } else {
    body = 'The backup mode was saved.';
  }
  const prefix = result.changed === false ? 'Already set this way. ' : 'Saved. ';
  return `${prefix}${body}`;
};
