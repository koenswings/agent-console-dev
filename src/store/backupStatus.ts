/**
 * Backup Disk status lines (idea#404, Console PR 1 of 2).
 *
 * Derives operator-facing copy from the idea#400 store summary. Field and
 * capability names follow scheduled-backup-disk.md §3.6 / §3.1 and are
 * provisional until Axle's #400 lands. All new store fields are optional:
 * when the `scheduledBackups` flag is missing or stale, this module returns
 * no lines and the existing UI is unchanged.
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

/** Capability that gates every new status line. From proposal §3.1; pending #400. */
export const SCHEDULED_BACKUPS_CAPABILITY = 'scheduledBackups' as const;

/** Advertised only when root helper v6+ is present (proposal §3.1; pending #400). */
export const BACKUP_CLEANUP_CAPABILITY = 'backupCleanup' as const;

export type BackupStatusTone = 'ok' | 'warn' | 'error' | 'neutral' | 'unknown';

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
export const HOOK_FALLBACK_COPY = 'Backed up, but the App was briefly stopped';
export const METHOD_NONE_COPY = 'Not backed up: its content is on the App Disk';

const RESULT_OK = 'OK';
const RESULT_HOOK_FALLBACK = 'HOOK_FALLBACK';
const RESULT_INTERRUPTED = 'INTERRUPTED';
const RESULT_SKIPPED_LOCKED = 'SKIPPED_LOCKED';
const RESULT_BACKUP_DISK_FULL = 'BACKUP_DISK_FULL';
const RESULT_HELPER_OUTDATED = 'HELPER_OUTDATED';

/** True when the docked Engine advertises a fresh scheduledBackups flag. */
export const engineShowsBackupStatus = (
  engine: Engine | null | undefined,
): boolean => engineHasCapability(engine, SCHEDULED_BACKUPS_CAPABILITY);

export const engineHasBackupCleanup = (
  engine: Engine | null | undefined,
): boolean => engineHasCapability(engine, BACKUP_CLEANUP_CAPABILITY);

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

const scheduleLine = (disk: Disk, now: number, clockTrusted: boolean): BackupStatusLine | null => {
  const when = disk.backupConfig?.schedule?.daily;
  if (!when || disk.backupConfig?.mode !== 'scheduled') return null;
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
      if (method === 'stop') {
        return { text: HOOK_FALLBACK_COPY, tone: 'warn' };
      }
      return {
        text: 'The backup completed.',
        tone: 'ok',
      };
    case RESULT_HOOK_FALLBACK:
      return { text: HOOK_FALLBACK_COPY, tone: 'warn' };
    case RESULT_INTERRUPTED:
      return { text: 'The backup was interrupted.', tone: 'error' };
    case RESULT_SKIPPED_LOCKED:
      return { text: 'Skipped: a backup was already running.', tone: 'neutral' };
    case RESULT_BACKUP_DISK_FULL:
      return { text: DISK_FULL_COPY, tone: 'error' };
    case RESULT_HELPER_OUTDATED:
      return { text: HELPER_OUTDATED_COPY, tone: 'warn' };
    default:
      if (!result) return null;
      return { text: 'The backup did not finish.', tone: 'error' };
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
    consider(inst.lastAttempt, inst.lastResult ?? undefined);
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
  const clockTrusted = disk.clockTrusted !== false;
  const lines: BackupStatusLine[] = [];

  const sched = scheduleLine(disk, now, clockTrusted);
  if (sched) lines.push(sched);

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

  const anyHelper = instances.some((i) => i.lastResult?.result === RESULT_HELPER_OUTDATED)
    || attempt?.result?.result === RESULT_HELPER_OUTDATED;
  // Proposal §3.1: backupCleanup is advertised only with helper v6+. A scheduled
  // Engine without that flag is the HELPER_OUTDATED state.
  const cleanupMissing = !engineHasBackupCleanup(opts.engine)
    && disk.backupConfig?.mode === 'scheduled';
  if (anyHelper || cleanupMissing) {
    lines.push({ id: 'pi-update', tone: 'warn', text: HELPER_OUTDATED_COPY });
  }

  const anyFallback = instances.some((i) => i.lastResult?.result === RESULT_HOOK_FALLBACK);
  if (anyFallback) {
    lines.push({ id: 'hook-fallback', tone: 'warn', text: HOOK_FALLBACK_COPY });
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
      const text = (plain.text === METHOD_NONE_COPY
        || plain.text === HOOK_FALLBACK_COPY
        || plain.text === DISK_FULL_COPY
        || plain.text === HELPER_OUTDATED_COPY)
        ? plain.text
        : `${prefix}${plain.text}`.trim();
      lines.push({ id: 'last-result', tone: plain.tone, text });
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
