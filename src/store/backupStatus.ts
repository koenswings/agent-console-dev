/**
 * Backup Disk status lines (idea#404, Console PR 1 of 2).
 *
 * Derives operator-facing copy from the idea#400 store summary, aligned to
 * Engine main (PR #353 schedule + PR #354 helper-gated `backupCleanup`).
 * All new store fields are optional: when the `scheduledBackups` flag is
 * missing or stale, this module returns no lines and the existing UI is unchanged.
 * Instance.lastAttempt is not a field; lastResult.time is the result time.
 * Disk.lastAttempt is kept. There is no nextRun field: the next run is
 * computed from schedule.daily only while clockTrusted is true.
 *
 * Operator copy has no jargon (no borg, YAML, helper, or result-code tokens).
 */

import { engineHasCapability } from './commands';
import type {
  BackupRunResult,
  BackupStaleLock,
  Disk,
  Engine,
  Instance,
  Store,
} from '../types/store';

/** Capability that gates every new status line and schedule controls. Engine f114a28 / PR #353. */
export const SCHEDULED_BACKUPS_CAPABILITY = 'scheduledBackups' as const;

/**
 * Fullness-driven Backup Disk cleanup (Engine PR #354, idea#400 §3.1).
 * Helper-gated like `flashCard`: advertised only when the app-data root helper
 * is at BACKUP_CLEANUP_HELPER_MIN (v10) or newer, checked once at startup.
 * Freshness is the usual `capabilitiesBootedAt === lastBooted` rule.
 */
export const BACKUP_CLEANUP_CAPABILITY = 'backupCleanup' as const;

/** Default daily time when schedule is absent or invalid (Engine createBackupDisk / setBackupMode). */
export const DEFAULT_BACKUP_TIME = '02:30';

export type BackupStatusTone = 'ok' | 'warn' | 'error' | 'neutral' | 'unknown' | 'info';

export interface BackupStatusLine {
  /** Stable id for an ID-keyed <For>. */
  id: string;
  tone: BackupStatusTone;
  text: string;
}

export const CLOCK_UNKNOWN_COPY =
  "Backup time unknown: this Pi's clock may be wrong";
export const DISK_FULL_COPY = 'Backup Disk full: add a bigger disk';
export const CLEANING_COPY = 'Cleaning up old backups';
export const HELPER_OUTDATED_COPY = 'Cleanup paused: Pi needs an update';
/** Pre-run warning when scheduledBackups is fresh but backupCleanup is not. */
export const CLEANUP_NEEDS_UPDATE_COPY =
  'This Pi needs an update before backups can clean up old copies';
export const HOOK_FALLBACK_COPY = 'Backed up, but the App was briefly stopped';
export const HOOK_POST_WARNING_COPY = 'Done, with a warning';
export const APP_DISK_NOT_DOCKED_COPY = "This App's disk isn't plugged in.";
export const METHOD_NONE_COPY = 'Not backed up: its content is on the App Disk';
export const FAILED_COPY = 'The backup did not finish.';
export const SCHEDULE_ERROR_COPY =
  'The saved backup time is not valid, so this disk runs at 02:30 until it is fixed.';
export const SCHEDULE_ERROR_IDLE_COPY = 'The saved backup time is not valid.';

export const orphanLinksCopy = (ids: readonly string[] | null | undefined): string | null => {
  const n = ids?.length ?? 0;
  if (n === 0) return null;
  if (n === 1) {
    return "1 older backup belongs to an app that isn't on this network. It is kept and skipped.";
  }
  return `${n} older backups belong to apps that aren't on this network. They are kept and skipped.`;
};

const RESULT_OK = 'OK';
const RESULT_HOOK_FALLBACK = 'HOOK_FALLBACK';
const RESULT_HOOK_POST_WARNING = 'HOOK_POST_WARNING';
const RESULT_APP_DISK_NOT_DOCKED = 'APP_DISK_NOT_DOCKED';
const RESULT_INTERRUPTED = 'INTERRUPTED';
const RESULT_SKIPPED_LOCKED = 'SKIPPED_LOCKED';
const RESULT_BACKUP_DISK_FULL = 'BACKUP_DISK_FULL';
const RESULT_HELPER_OUTDATED = 'HELPER_OUTDATED';
const RESULT_FAILED = 'FAILED';

/** True when the docked Engine advertises a fresh scheduledBackups flag. */
export const engineShowsBackupStatus = (
  engine: Engine | null | undefined,
): boolean => engineHasCapability(engine, SCHEDULED_BACKUPS_CAPABILITY);

const formatWhen = (ts: number): string =>
  new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Parse a daily "HH:MM" schedule. Returns null if the string is not a time. */
export const parseDailyTime = (daily: string): { hours: number; minutes: number } | null => {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(daily.trim());
  if (!m) return null;
  return { hours: Number(m[1]), minutes: Number(m[2]) };
};

/**
 * Next daily run at or after `now`. If today's slot has already passed,
 * returns tomorrow's slot. `now` is injected so tests do not depend on the clock.
 */
export const nextScheduledRun = (daily: string, now: number): Date | null => {
  const parsed = parseDailyTime(daily);
  if (!parsed) return null;
  const next = new Date(now);
  next.setHours(parsed.hours, parsed.minutes, 0, 0);
  if (next.getTime() <= now) next.setDate(next.getDate() + 1);
  return next;
};

const isSameLocalDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear()
  && a.getMonth() === b.getMonth()
  && a.getDate() === b.getDate();

/**
 * Daily time used for a scheduled disk: a valid schedule.daily, otherwise the
 * Engine default 02:30 (absent or invalid schedule still runs at 02:30).
 */
export const scheduledDailyTime = (disk: Disk): string | null => {
  if (disk.backupConfig?.mode !== 'scheduled') return null;
  const daily = disk.backupConfig.schedule?.daily;
  return daily && parseDailyTime(daily) ? daily : DEFAULT_BACKUP_TIME;
};

const scheduleLine = (disk: Disk, now: number, clockTrusted: boolean): BackupStatusLine | null => {
  const when = scheduledDailyTime(disk);
  if (!when) return null;
  if (!clockTrusted) {
    return { id: 'schedule', tone: 'neutral', text: `Scheduled daily at ${when}.` };
  }
  const next = nextScheduledRun(when, now);
  if (!next) {
    return { id: 'schedule', tone: 'neutral', text: `Scheduled daily at ${when}.` };
  }
  const today = new Date(now);
  const dayWord = isSameLocalDay(next, today) ? 'today' : 'tomorrow';
  const hh = String(next.getHours()).padStart(2, '0');
  const mm = String(next.getMinutes()).padStart(2, '0');
  return {
    id: 'schedule',
    tone: 'neutral',
    text: `Scheduled daily at ${when}. Next run ${dayWord} at ${hh}:${mm}.`,
  };
};

const scheduleErrorLine = (disk: Disk): BackupStatusLine | null => {
  const err = disk.backupConfig?.scheduleError;
  if (!err) return null;
  const scheduled = disk.backupConfig?.mode === 'scheduled';
  return {
    id: 'schedule-error',
    tone: 'warn',
    text: scheduled ? SCHEDULE_ERROR_COPY : SCHEDULE_ERROR_IDLE_COPY,
  };
};

/** Plain-language result, never the raw Engine code. */
export const plainBackupResult = (
  result: string | null | undefined,
  method?: string | null,
): { text: string; tone: BackupStatusTone } | null => {
  if (!result && !method) return null;
  if (method === 'none') {
    return { text: METHOD_NONE_COPY, tone: 'neutral' };
  }
  switch (result) {
    case RESULT_OK:
      // method 'stop' on an OK result is the App's intended stop method, not a hook fallback.
      return {
        text: 'The backup completed.',
        tone: 'ok',
      };
    case RESULT_HOOK_FALLBACK:
      return { text: HOOK_FALLBACK_COPY, tone: 'warn' };
    case RESULT_HOOK_POST_WARNING:
      return { text: HOOK_POST_WARNING_COPY, tone: 'warn' };
    case RESULT_APP_DISK_NOT_DOCKED:
      return { text: APP_DISK_NOT_DOCKED_COPY, tone: 'warn' };
    case RESULT_INTERRUPTED:
      return { text: 'The backup was interrupted.', tone: 'error' };
    case RESULT_SKIPPED_LOCKED:
      return { text: 'Skipped: a backup was already running.', tone: 'neutral' };
    case RESULT_BACKUP_DISK_FULL:
      return { text: DISK_FULL_COPY, tone: 'error' };
    case RESULT_HELPER_OUTDATED:
      return { text: HELPER_OUTDATED_COPY, tone: 'warn' };
    case RESULT_FAILED:
      return { text: FAILED_COPY, tone: 'error' };
    default:
      if (!result) return null;
      return { text: FAILED_COPY, tone: 'error' };
  }
};

const instanceName = (instances: Instance[], instanceId: string): string =>
  instances.find((i) => i.id === instanceId)?.name ?? 'an App';

const latestAttempt = (disk: Disk, instances: Instance[]): { time: number; result?: BackupRunResult } | null => {
  let best: { time: number; result?: BackupRunResult } | null = null;
  const consider = (time: number | null | undefined, result?: BackupRunResult) => {
    if (time == null) return;
    if (!best || time > best.time || (time === best.time && result && !best.result)) {
      best = { time, result };
    }
  };
  consider(disk.lastAttempt);
  for (const inst of instances) {
    // Agreed: no Instance.lastAttempt; lastResult.time is the result time.
    if (inst.lastResult) consider(inst.lastResult.time, inst.lastResult);
  }
  return best;
};

const staleLocks = (disk: Disk): BackupStaleLock[] =>
  (disk.backupStaleLocks ?? []).filter(Boolean);

/**
 * Disk-level status lines for RestorePanel, in the §5 / agreed-approach order.
 * Returns [] when the capability flag is absent or stale.
 */
export const diskBackupStatusLines = (opts: {
  disk: Disk;
  engine: Engine | null | undefined;
  instances?: Instance[];
  now?: number;
}): BackupStatusLine[] => {
  if (!engineShowsBackupStatus(opts.engine)) return [];
  const now = opts.now ?? Date.now();
  const disk = opts.disk;
  const instances = opts.instances ?? [];
  // Next run only when the Engine has said the clock is trusted (f114a28).
  const clockTrusted = disk.clockTrusted === true;
  const lines: BackupStatusLine[] = [];

  const sched = scheduleLine(disk, now, clockTrusted);
  if (sched) lines.push(sched);
  const schedErr = scheduleErrorLine(disk);
  if (schedErr) lines.push(schedErr);

  // Engine #356: optional Disk.backupConfig.orphanLinks. Missing or empty → no line.
  // Neutral/info, not a warning; no delete action.
  const orphanText = orphanLinksCopy(disk.backupConfig?.orphanLinks);
  if (orphanText) {
    lines.push({ id: 'orphan-links', tone: 'info', text: orphanText });
  }

  const attempt = latestAttempt(disk, instances);
  if (attempt) {
    const plain = plainBackupResult(attempt.result?.result, attempt.result?.method);
    const resultText = plain ? ` ${plain.text}` : '';
    lines.push({
      id: 'last-attempt',
      tone: plain?.tone ?? 'neutral',
      text: `Last attempt: ${formatWhen(attempt.time)}.${resultText}`,
    });
  }

  if (typeof disk.missedRuns === 'number' && disk.missedRuns > 0) {
    const n = disk.missedRuns;
    lines.push({
      id: 'missed-runs',
      tone: clockTrusted ? 'warn' : 'neutral',
      text: n === 1
        ? '1 scheduled backup was missed.'
        : `${n} scheduled backups were missed.`,
    });
  }

  if (disk.clockTrusted === false) {
    lines.push({ id: 'clock', tone: 'unknown', text: CLOCK_UNKNOWN_COPY });
  }

  if (typeof disk.freePct === 'number') {
    const pct = disk.freePct <= 1 && disk.freePct > 0 ? disk.freePct * 100 : disk.freePct;
    const shown = Number.isInteger(pct) ? String(pct) : pct.toFixed(0);
    lines.push({
      id: 'free-space',
      tone: 'neutral',
      text: `${shown}% free`,
    });
  }

  if (disk.cleaning === true) {
    lines.push({ id: 'cleaning', tone: 'warn', text: CLEANING_COPY });
  }

  const anyFull = instances.some((i) => i.lastResult?.result === RESULT_BACKUP_DISK_FULL)
    || attempt?.result?.result === RESULT_BACKUP_DISK_FULL;
  if (anyFull && disk.cleaning !== true) {
    lines.push({ id: 'disk-full', tone: 'error', text: DISK_FULL_COPY });
  }

  // Pre-run: fresh scheduledBackups but no fresh backupCleanup (Engine PR #354).
  // HELPER_OUTDATED on a result remains the runtime fallback. When both apply,
  // show the pre-run warning once — do not also emit the result line.
  const missingCleanup = !engineHasCapability(opts.engine, BACKUP_CLEANUP_CAPABILITY);
  const anyHelper = instances.some((i) => i.lastResult?.result === RESULT_HELPER_OUTDATED)
    || attempt?.result?.result === RESULT_HELPER_OUTDATED;
  if (missingCleanup) {
    lines.push({ id: 'pi-update', tone: 'warn', text: CLEANUP_NEEDS_UPDATE_COPY });
  } else if (anyHelper) {
    lines.push({ id: 'pi-update', tone: 'warn', text: HELPER_OUTDATED_COPY });
  }

  const anyFallback = instances.some((i) => i.lastResult?.result === RESULT_HOOK_FALLBACK);
  if (anyFallback) {
    lines.push({ id: 'hook-fallback', tone: 'warn', text: HOOK_FALLBACK_COPY });
  }
  const anyPostWarning = instances.some((i) => i.lastResult?.result === RESULT_HOOK_POST_WARNING);
  if (anyPostWarning) {
    lines.push({ id: 'hook-post-warning', tone: 'warn', text: HOOK_POST_WARNING_COPY });
  }
  const anyAppDiskGone = instances.some((i) => i.lastResult?.result === RESULT_APP_DISK_NOT_DOCKED);
  if (anyAppDiskGone) {
    lines.push({ id: 'app-disk-not-docked', tone: 'warn', text: APP_DISK_NOT_DOCKED_COPY });
  }

  const locks = staleLocks(disk);
  const interruptedIds = new Set<string>();
  for (const lock of locks) interruptedIds.add(lock.instanceId);
  for (const inst of instances) {
    if (inst.lastResult?.result === RESULT_INTERRUPTED) interruptedIds.add(inst.id);
  }
  for (const id of interruptedIds) {
    const name = instanceName(instances, id);
    const lock = locks.find((l) => l.instanceId === id);
    const started = lock?.startedAt != null ? ` It started at ${formatWhen(lock.startedAt)}.` : '';
    lines.push({
      id: `interrupted-${id}`,
      tone: 'error',
      text: `A backup of ${name} was interrupted.${started}`,
    });
  }

  return lines;
};

/**
 * Per-App status lines for the instance row (and the RestorePanel instance row).
 * Returns [] when the capability flag is absent or stale.
 */
export const instanceBackupStatusLines = (opts: {
  instance: Instance;
  engine: Engine | null | undefined;
  disks?: Disk[];
  now?: number;
}): BackupStatusLine[] => {
  if (!engineShowsBackupStatus(opts.engine)) return [];
  const inst = opts.instance;
  const disks = opts.disks ?? [];
  const lines: BackupStatusLine[] = [];

  const clockUntrusted = disks.some((d) => d.clockTrusted === false);
  if (clockUntrusted) {
    lines.push({ id: 'clock', tone: 'unknown', text: CLOCK_UNKNOWN_COPY });
  }

  const result = inst.lastResult;
  if (result) {
    const plain = plainBackupResult(result.result, result.method);
    if (plain) {
      // Avoid repeating the clock-unknown line or doubling disk-only copy
      // when the instance already has a more specific last-result line.
      const prefix = result.time ? `Last backup: ${formatWhen(result.time)}. ` : '';
      // method:none and result lines already stand alone; keep proposal copy exact.
      // Disk status already carries CLEANUP_NEEDS_UPDATE_COPY when the
      // cleanup cap is missing; don't repeat the runtime line as well.
      if (plain.text === HELPER_OUTDATED_COPY
        && !engineHasCapability(opts.engine, BACKUP_CLEANUP_CAPABILITY)) {
        // skip
      } else {
        const text = (plain.text === METHOD_NONE_COPY
          || plain.text === HOOK_FALLBACK_COPY
          || plain.text === DISK_FULL_COPY
          || plain.text === HELPER_OUTDATED_COPY
          || plain.text === APP_DISK_NOT_DOCKED_COPY)
          ? plain.text
          : `${prefix}${plain.text}`.trim();
        lines.push({ id: 'last-result', tone: plain.tone, text });
      }
    }
  }

  for (const disk of disks) {
    const lock = staleLocks(disk).find((l) => l.instanceId === inst.id);
    if (lock && !lines.some((l) => l.id === 'interrupted' || l.tone === 'error' && l.text.includes('interrupted'))) {
      const started = lock.startedAt != null ? ` It started at ${formatWhen(lock.startedAt)}.` : '';
      lines.push({
        id: 'interrupted',
        tone: 'error',
        text: `The backup was interrupted.${started}`,
      });
    }
  }

  if (inst.lastResult?.result === RESULT_INTERRUPTED && !lines.some((l) => l.id === 'interrupted')) {
    lines.push({
      id: 'interrupted',
      tone: 'error',
      text: 'The backup was interrupted.',
    });
  }

  return lines;
};

/** Engine that owns this Backup Disk, from the store (derived, no copy). */
export const engineForDisk = (
  store: Store | null | undefined,
  disk: Disk | null | undefined,
  engineId?: string | null,
): Engine | undefined => {
  if (!store) return undefined;
  const id = engineId || disk?.dockedTo;
  return id ? store.engineDB[id] : undefined;
};
