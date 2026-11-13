import { describe, it, expect } from 'vitest';
import {
  BACKUP_CLEANUP_CAPABILITY,
  CLOCK_UNKNOWN_COPY,
  CLEANING_COPY,
  DISK_FULL_COPY,
  HELPER_OUTDATED_COPY,
  HOOK_FALLBACK_COPY,
  METHOD_NONE_COPY,
  SCHEDULED_BACKUPS_CAPABILITY,
  diskBackupStatusLines,
  engineShowsBackupStatus,
  instanceBackupStatusLines,
  nextScheduledRun,
  parseDailyTime,
  plainBackupResult,
} from '../src/store/backupStatus';
import type { Disk, Engine, Instance, BackupRunResult } from '../src/types/store';

const BOOT = 1_700_000_000_000;

const flaggedEngine = (extra: string[] = []): Engine => ({
  id: 'eng-1',
  hostname: 'idea03',
  version: '1.0',
  hostOS: 'Linux',
  created: BOOT,
  lastBooted: BOOT,
  lastRun: BOOT,
  lastHalted: null,
  commands: [],
  capabilities: [SCHEDULED_BACKUPS_CAPABILITY, ...extra],
  capabilitiesBootedAt: BOOT,
});

const oldEngine: Engine = {
  ...flaggedEngine(),
  capabilities: ['diskIdArgs'],
  capabilitiesBootedAt: BOOT,
};

const rolledBack: Engine = {
  ...flaggedEngine(),
  lastBooted: BOOT + 1000,
  capabilitiesBootedAt: BOOT,
};

const disk = (over: Partial<Disk> = {}): Disk => ({
  id: 'bak-1',
  name: 'backup-disk',
  device: 'sdb1',
  created: BOOT,
  lastDocked: BOOT,
  dockedTo: 'eng-1',
  diskTypes: ['backup'],
  backupConfig: { mode: 'scheduled', links: ['inst-1'], schedule: { daily: '02:30' } },
  ...over,
});

const inst = (over: Partial<Instance> = {}): Instance => ({
  id: 'inst-1',
  instanceOf: 'app-1',
  name: 'Kolibri',
  status: 'Running',
  port: 8080,
  serviceImages: [],
  created: BOOT,
  lastBackup: BOOT,
  lastStarted: BOOT,
  storedOn: 'app-disk',
  statusCondition: null,
  currentStep: null,
  totalSteps: null,
  stepLabel: null,
  metrics: null,
  ...over,
});

const result = (over: Partial<BackupRunResult> & { result: string }): BackupRunResult => ({
  time: BOOT,
  method: 'live',
  ...over,
});

// 13 Nov 2026 10:00 local — after the 02:30 slot, so next run is tomorrow.
const NOW = new Date(2026, 10, 13, 10, 0, 0).getTime();
const BEFORE_SLOT = new Date(2026, 10, 13, 1, 0, 0).getTime();

describe('parseDailyTime / nextScheduledRun', () => {
  it('parses HH:MM', () => {
    expect(parseDailyTime('02:30')).toEqual({ hours: 2, minutes: 30 });
    expect(parseDailyTime('2:30')).toEqual({ hours: 2, minutes: 30 });
    expect(parseDailyTime('not-a-time')).toBeNull();
  });

  it('returns today when the slot is still ahead, tomorrow when it has passed', () => {
    const today = nextScheduledRun('02:30', BEFORE_SLOT)!;
    expect(today.getHours()).toBe(2);
    expect(today.getMinutes()).toBe(30);
    expect(today.getDate()).toBe(13);
    const tomorrow = nextScheduledRun('02:30', NOW)!;
    expect(tomorrow.getDate()).toBe(14);
  });
});

describe('plainBackupResult', () => {
  it('uses the proposal copy and never returns a result-code token', () => {
    expect(plainBackupResult('HOOK_FALLBACK')?.text).toBe(HOOK_FALLBACK_COPY);
    expect(plainBackupResult('BACKUP_DISK_FULL')?.text).toBe(DISK_FULL_COPY);
    expect(plainBackupResult('HELPER_OUTDATED')?.text).toBe(HELPER_OUTDATED_COPY);
    expect(plainBackupResult('OK', 'none')?.text).toBe(METHOD_NONE_COPY);
    expect(plainBackupResult('INTERRUPTED')?.text).toMatch(/interrupted/i);
    expect(plainBackupResult('SKIPPED_LOCKED')?.text).toMatch(/already running/i);
    const all = ['OK', 'HOOK_FALLBACK', 'INTERRUPTED', 'SKIPPED_LOCKED', 'BACKUP_DISK_FULL', 'HELPER_OUTDATED', 'WEIRD']
      .map((c) => plainBackupResult(c)!.text)
      .join(' ');
    expect(all).not.toMatch(/borg|\bYAML\b|helper/i);
    expect(all).not.toMatch(/HOOK_FALLBACK|BACKUP_DISK_FULL|HELPER_OUTDATED|SKIPPED_LOCKED/);
    expect(all).not.toContain('INTERRUPTED');
  });
});

describe('engineShowsBackupStatus', () => {
  it('is true only with a fresh scheduledBackups flag', () => {
    expect(engineShowsBackupStatus(flaggedEngine())).toBe(true);
    expect(engineShowsBackupStatus(oldEngine)).toBe(false);
    expect(engineShowsBackupStatus(rolledBack)).toBe(false);
    expect(engineShowsBackupStatus(undefined)).toBe(false);
  });
});

describe('diskBackupStatusLines — flag off is a no-op', () => {
  const summaryDisk = disk({
    clockTrusted: false,
    missedRuns: 2,
    cleaning: true,
    freePct: 10,
    lastAttempt: BOOT,
    backupStaleLocks: [{ instanceId: 'inst-1', startedAt: BOOT, detectedAt: BOOT }],
  });
  const summaryInst = inst({
    lastResult: result({ result: 'HOOK_FALLBACK' }),
  });

  it('returns no lines when the flag is absent, even if summary fields are set', () => {
    expect(diskBackupStatusLines({ disk: summaryDisk, engine: oldEngine, instances: [summaryInst], now: NOW })).toEqual([]);
  });

  it('returns no lines when the flag is stale (rolled back)', () => {
    expect(diskBackupStatusLines({ disk: summaryDisk, engine: rolledBack, instances: [summaryInst], now: NOW })).toEqual([]);
  });
});

describe('diskBackupStatusLines — each §5 line from mock data', () => {
  const engine = flaggedEngine([BACKUP_CLEANUP_CAPABILITY]);

  it('shows schedule and next run when the clock is trusted', () => {
    const lines = diskBackupStatusLines({ disk: disk({ clockTrusted: true }), engine, now: NOW });
    const line = lines.find((l) => l.id === 'schedule');
    expect(line?.text).toMatch(/Scheduled daily at 02:30/);
    expect(line?.text).toMatch(/Next run tomorrow at 02:30/);
  });

  it('omits a wall-clock next run when the clock is not trusted', () => {
    const lines = diskBackupStatusLines({
      disk: disk({ clockTrusted: false }),
      engine,
      now: NOW,
    });
    const schedule = lines.find((l) => l.id === 'schedule');
    expect(schedule?.text).toBe('Scheduled daily at 02:30.');
    expect(schedule?.text).not.toMatch(/Next run/);
    const clock = lines.find((l) => l.id === 'clock');
    expect(clock?.text).toBe(CLOCK_UNKNOWN_COPY);
    expect(clock?.tone).toBe('unknown');
  });

  it('shows last attempt and result', () => {
    const lines = diskBackupStatusLines({
      disk: disk({ lastAttempt: BOOT, clockTrusted: true }),
      engine,
      instances: [inst({ lastResult: result({ time: BOOT, result: 'OK', method: 'live' }) })],
      now: NOW,
    });
    const line = lines.find((l) => l.id === 'last-attempt');
    expect(line?.text).toMatch(/^Last attempt:/);
    expect(line?.text).toMatch(/The backup completed/);
    expect(line?.tone).toBe('ok');
  });

  it('shows missed runs', () => {
    const one = diskBackupStatusLines({ disk: disk({ missedRuns: 1, clockTrusted: true }), engine, now: NOW });
    expect(one.find((l) => l.id === 'missed-runs')?.text).toBe('1 scheduled backup was missed.');
    const two = diskBackupStatusLines({ disk: disk({ missedRuns: 2, clockTrusted: true }), engine, now: NOW });
    expect(two.find((l) => l.id === 'missed-runs')?.text).toBe('2 scheduled backups were missed.');
    expect(two.find((l) => l.id === 'missed-runs')?.tone).toBe('warn');
  });

  it('paints missed runs neutral when the clock is not trusted (no red overdue)', () => {
    const lines = diskBackupStatusLines({
      disk: disk({ missedRuns: 2, clockTrusted: false }),
      engine,
      now: NOW,
    });
    expect(lines.find((l) => l.id === 'missed-runs')?.tone).toBe('neutral');
    expect(lines.find((l) => l.id === 'clock')?.text).toBe(CLOCK_UNKNOWN_COPY);
  });

  it('shows cleaning in amber and free space', () => {
    const lines = diskBackupStatusLines({
      disk: disk({ cleaning: true, cleaningStartedAt: BOOT, freePct: 12, clockTrusted: true }),
      engine,
      now: NOW,
    });
    expect(lines.find((l) => l.id === 'cleaning')?.text).toBe(CLEANING_COPY);
    expect(lines.find((l) => l.id === 'cleaning')?.tone).toBe('warn');
    expect(lines.find((l) => l.id === 'free-space')?.text).toBe('12% free');
  });

  it('shows Backup Disk full from the last result, not from a Console size rule', () => {
    const lines = diskBackupStatusLines({
      disk: disk({ freePct: 10, clockTrusted: true }),
      engine,
      instances: [inst({ lastResult: result({ result: 'BACKUP_DISK_FULL' }) })],
      now: NOW,
    });
    expect(lines.find((l) => l.id === 'disk-full')?.text).toBe(DISK_FULL_COPY);
    expect(lines.find((l) => l.id === 'disk-full')?.tone).toBe('error');
    // freePct alone does not invent a "full" warning
    const justSpace = diskBackupStatusLines({
      disk: disk({ freePct: 10, clockTrusted: true }),
      engine,
      now: NOW,
    });
    expect(justSpace.find((l) => l.id === 'disk-full')).toBeUndefined();
  });

  it('shows "Pi needs an update" from HELPER_OUTDATED or a missing cleanup flag', () => {
    const fromResult = diskBackupStatusLines({
      disk: disk({ clockTrusted: true, backupConfig: { mode: 'on-demand', links: ['inst-1'] } }),
      engine,
      instances: [inst({ lastResult: result({ result: 'HELPER_OUTDATED' }) })],
      now: NOW,
    });
    expect(fromResult.find((l) => l.id === 'pi-update')?.text).toBe(HELPER_OUTDATED_COPY);

    const noCleanup = diskBackupStatusLines({
      disk: disk({ clockTrusted: true }),
      engine: flaggedEngine(), // scheduledBackups only
      now: NOW,
    });
    expect(noCleanup.find((l) => l.id === 'pi-update')?.text).toBe(HELPER_OUTDATED_COPY);
  });

  it('shows HOOK_FALLBACK copy when any instance used the fallback', () => {
    const lines = diskBackupStatusLines({
      disk: disk({ clockTrusted: true }),
      engine,
      instances: [inst({ lastResult: result({ result: 'HOOK_FALLBACK', method: 'stop' }) })],
      now: NOW,
    });
    expect(lines.find((l) => l.id === 'hook-fallback')?.text).toBe(HOOK_FALLBACK_COPY);
    expect(lines.find((l) => l.id === 'hook-fallback')?.tone).toBe('warn');
  });

  it('shows interrupted / stale lock copy without saying lock', () => {
    const lines = diskBackupStatusLines({
      disk: disk({
        clockTrusted: true,
        backupStaleLocks: [{ instanceId: 'inst-1', startedAt: BOOT, detectedAt: BOOT + 1 }],
      }),
      engine,
      instances: [inst()],
      now: NOW,
    });
    const line = lines.find((l) => l.id === 'interrupted-inst-1');
    expect(line?.text).toMatch(/A backup of Kolibri was interrupted/);
    expect(line?.text).toMatch(/It started at/);
    expect(line?.text).not.toMatch(/lock|borg|YAML|helper/i);
    expect(line?.tone).toBe('error');
  });

  it('does not show a schedule line in on-demand mode', () => {
    const lines = diskBackupStatusLines({
      disk: disk({
        clockTrusted: true,
        backupConfig: { mode: 'on-demand', links: ['inst-1'], schedule: { daily: '02:30' } },
      }),
      engine,
      now: NOW,
    });
    expect(lines.find((l) => l.id === 'schedule')).toBeUndefined();
  });
});

describe('instanceBackupStatusLines', () => {
  const engine = flaggedEngine([BACKUP_CLEANUP_CAPABILITY]);

  it('returns no lines when the flag is off', () => {
    expect(instanceBackupStatusLines({
      instance: inst({ lastResult: result({ result: 'HOOK_FALLBACK' }) }),
      engine: oldEngine,
      disks: [disk({ clockTrusted: false })],
    })).toEqual([]);
  });

  it('shows last result, fallback, method none, interrupted, and clock copy', () => {
    const fallback = instanceBackupStatusLines({
      instance: inst({ lastResult: result({ result: 'HOOK_FALLBACK' }) }),
      engine,
      disks: [disk({ clockTrusted: true })],
    });
    expect(fallback.find((l) => l.id === 'last-result')?.text).toBe(HOOK_FALLBACK_COPY);

    const none = instanceBackupStatusLines({
      instance: inst({ lastResult: result({ result: 'OK', method: 'none' }) }),
      engine,
    });
    expect(none.find((l) => l.id === 'last-result')?.text).toBe(METHOD_NONE_COPY);
    expect(none.find((l) => l.id === 'last-result')?.tone).toBe('neutral');

    const interrupted = instanceBackupStatusLines({
      instance: inst({ lastResult: result({ result: 'INTERRUPTED' }) }),
      engine,
      disks: [disk({
        backupStaleLocks: [{ instanceId: 'inst-1', startedAt: null, detectedAt: BOOT }],
      })],
    });
    expect(interrupted.some((l) => /interrupted/i.test(l.text))).toBe(true);

    const clock = instanceBackupStatusLines({
      instance: inst(),
      engine,
      disks: [disk({ clockTrusted: false })],
    });
    expect(clock.find((l) => l.id === 'clock')?.text).toBe(CLOCK_UNKNOWN_COPY);
  });
});
