import { describe, it, expect } from 'vitest';
import {
  CLOCK_UNKNOWN_COPY,
  CLEANING_COPY,
  DISK_FULL_COPY,
  HELPER_OUTDATED_COPY,
  CLEANUP_NEEDS_UPDATE_COPY,
  BACKUP_CLEANUP_CAPABILITY,
  HOOK_FALLBACK_COPY,
  HOOK_POST_WARNING_COPY,
  APP_DISK_NOT_DOCKED_COPY,
  METHOD_NONE_COPY,
  FAILED_COPY,
  SCHEDULE_ERROR_COPY,
  SCHEDULE_ERROR_IDLE_COPY,
  SCHEDULED_BACKUPS_CAPABILITY,
  orphanLinksCopy,
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
    expect(plainBackupResult('HOOK_POST_WARNING')?.text).toBe(HOOK_POST_WARNING_COPY);
    expect(plainBackupResult('HOOK_POST_WARNING')?.text).toBe('Done, with a warning');
    expect(plainBackupResult('APP_DISK_NOT_DOCKED')?.text).toBe(APP_DISK_NOT_DOCKED_COPY);
    expect(plainBackupResult('BACKUP_DISK_FULL')?.text).toBe(DISK_FULL_COPY);
    expect(plainBackupResult('HELPER_OUTDATED')?.text).toBe(HELPER_OUTDATED_COPY);
    expect(plainBackupResult('FAILED')?.text).toBe(FAILED_COPY);
    expect(plainBackupResult('OK')?.text).toBe('The backup completed.');
    expect(plainBackupResult('OK', 'stop')?.text).toBe('The backup completed.');
    expect(plainBackupResult('OK', 'stop')?.tone).toBe('ok');
    expect(plainBackupResult('OK', 'none')?.text).toBe(METHOD_NONE_COPY);
    expect(plainBackupResult('INTERRUPTED')?.text).toMatch(/interrupted/i);
    expect(plainBackupResult('SKIPPED_LOCKED')?.text).toMatch(/already running/i);
    const all = ['OK', 'FAILED', 'HOOK_FALLBACK', 'HOOK_POST_WARNING', 'APP_DISK_NOT_DOCKED', 'INTERRUPTED', 'SKIPPED_LOCKED', 'BACKUP_DISK_FULL', 'HELPER_OUTDATED', 'WEIRD']
      .map((c) => plainBackupResult(c)!.text)
      .join(' ');
    expect(all).not.toMatch(/borg|\bYAML\b|helper/i);
    expect(all).not.toMatch(/HOOK_FALLBACK|HOOK_POST_WARNING|APP_DISK_NOT_DOCKED|BACKUP_DISK_FULL|HELPER_OUTDATED|SKIPPED_LOCKED/);
    expect(all).not.toContain('INTERRUPTED');
    expect(all).not.toContain('FAILED');
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
  const engine = flaggedEngine();

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

  it('shows the runtime "Cleanup paused" line from a HELPER_OUTDATED result when backupCleanup is fresh', () => {
    const fromResult = diskBackupStatusLines({
      disk: disk({ clockTrusted: true, backupConfig: { mode: 'on-demand', links: ['inst-1'] } }),
      engine: flaggedEngine([BACKUP_CLEANUP_CAPABILITY]),
      instances: [inst({ lastResult: result({ result: 'HELPER_OUTDATED' }) })],
      now: NOW,
    });
    expect(fromResult.find((l) => l.id === 'pi-update')?.text).toBe(HELPER_OUTDATED_COPY);
    expect(fromResult.filter((l) => l.text === CLEANUP_NEEDS_UPDATE_COPY)).toEqual([]);
  });

  it('shows scheduleError in plain wording and still schedules the 02:30 default', () => {
    const lines = diskBackupStatusLines({
      disk: disk({
        clockTrusted: true,
        backupConfig: {
          mode: 'scheduled',
          links: ['inst-1'],
          schedule: null,
          scheduleError: 'BAD_TIME: daily "25:00" is not HH:MM',
        },
      }),
      engine,
      now: NOW,
    });
    const err = lines.find((l) => l.id === 'schedule-error');
    expect(err?.text).toBe(SCHEDULE_ERROR_COPY);
    expect(err?.tone).toBe('warn');
    expect(JSON.stringify(lines)).not.toMatch(/BAD_TIME|25:00|YAML/);
    const schedule = lines.find((l) => l.id === 'schedule');
    expect(schedule?.text).toMatch(/Scheduled daily at 02:30/);
    expect(schedule?.text).toMatch(/Next run tomorrow at 02:30/);
  });

  it('shows a shorter scheduleError line in on-demand mode and no next run', () => {
    const lines = diskBackupStatusLines({
      disk: disk({
        clockTrusted: true,
        backupConfig: {
          mode: 'on-demand',
          links: ['inst-1'],
          schedule: null,
          scheduleError: 'BAD_SCHEDULE: daily only',
        },
      }),
      engine,
      now: NOW,
    });
    expect(lines.find((l) => l.id === 'schedule-error')?.text).toBe(SCHEDULE_ERROR_IDLE_COPY);
    expect(lines.find((l) => l.id === 'schedule')).toBeUndefined();
    expect(JSON.stringify(lines)).not.toMatch(/BAD_SCHEDULE/);
  });

  it('does not invent a next run when clockTrusted is unset', () => {
    const lines = diskBackupStatusLines({
      disk: disk({ clockTrusted: undefined }),
      engine,
      now: NOW,
    });
    const schedule = lines.find((l) => l.id === 'schedule');
    expect(schedule?.text).toBe('Scheduled daily at 02:30.');
    expect(schedule?.text).not.toMatch(/Next run/);
    expect(lines.find((l) => l.id === 'clock')).toBeUndefined();
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

  it('shows HOOK_POST_WARNING as “Done, with a warning”', () => {
    const lines = diskBackupStatusLines({
      disk: disk({ clockTrusted: true }),
      engine,
      instances: [inst({ lastResult: result({ result: 'HOOK_POST_WARNING', method: 'hook' }) })],
      now: NOW,
    });
    expect(lines.find((l) => l.id === 'hook-post-warning')?.text).toBe(HOOK_POST_WARNING_COPY);
    expect(lines.find((l) => l.id === 'hook-post-warning')?.text).toBe('Done, with a warning');
    expect(JSON.stringify(lines)).not.toMatch(/HOOK_POST_WARNING/);
  });

  it("shows APP_DISK_NOT_DOCKED as the App's disk isn't plugged in", () => {
    const lines = diskBackupStatusLines({
      disk: disk({ clockTrusted: true }),
      engine,
      instances: [inst({ lastResult: result({ result: 'APP_DISK_NOT_DOCKED' }) })],
      now: NOW,
    });
    expect(lines.find((l) => l.id === 'app-disk-not-docked')?.text).toBe(APP_DISK_NOT_DOCKED_COPY);
    expect(lines.find((l) => l.id === 'app-disk-not-docked')?.text).toBe("This App's disk isn't plugged in.");
    expect(JSON.stringify(lines)).not.toMatch(/APP_DISK_NOT_DOCKED/);
  });

  it('uses lastResult.time for last attempt when Disk.lastAttempt is absent (no Instance.lastAttempt)', () => {
    const lines = diskBackupStatusLines({
      disk: disk({ clockTrusted: true }),
      engine,
      instances: [inst({ lastResult: result({ time: BOOT, result: 'OK', method: 'live' }) })],
      now: NOW,
    });
    const line = lines.find((l) => l.id === 'last-attempt');
    expect(line?.text).toMatch(/^Last attempt:/);
    expect(line?.text).toMatch(/The backup completed/);
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
  const engine = flaggedEngine();

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

  it('shows HOOK_POST_WARNING as “Done, with a warning”, using lastResult.time', () => {
    const lines = instanceBackupStatusLines({
      instance: inst({ lastResult: result({ time: BOOT, result: 'HOOK_POST_WARNING', method: 'hook' }) }),
      engine,
    });
    const line = lines.find((l) => l.id === 'last-result');
    expect(line?.text).toMatch(/Done, with a warning/);
    expect(line?.text).toMatch(/^Last backup:/);
    expect(line?.text).not.toMatch(/HOOK_POST_WARNING/);
    expect(line?.tone).toBe('warn');
  });

  it("shows APP_DISK_NOT_DOCKED as the App's disk isn't plugged in", () => {
    const lines = instanceBackupStatusLines({
      instance: inst({ lastResult: result({ result: 'APP_DISK_NOT_DOCKED' }) }),
      engine,
    });
    expect(lines.find((l) => l.id === 'last-result')?.text).toBe(APP_DISK_NOT_DOCKED_COPY);
    expect(JSON.stringify(lines)).not.toMatch(/APP_DISK_NOT_DOCKED/);
  });
});

describe('diskBackupStatusLines — backupCleanup capability (Engine PR #354)', () => {
  it('shows no pre-run warning when both scheduledBackups and backupCleanup are fresh', () => {
    const lines = diskBackupStatusLines({
      disk: disk({ clockTrusted: true }),
      engine: flaggedEngine([BACKUP_CLEANUP_CAPABILITY]),
      now: NOW,
    });
    expect(lines.find((l) => l.id === 'pi-update')).toBeUndefined();
    expect(lines.filter((l) =>
      l.text === CLEANUP_NEEDS_UPDATE_COPY || l.text === HELPER_OUTDATED_COPY
    )).toEqual([]);
  });

  it('shows the pre-run warning when scheduledBackups is fresh but backupCleanup is not', () => {
    const lines = diskBackupStatusLines({
      disk: disk({ clockTrusted: true }),
      engine: flaggedEngine(),
      now: NOW,
    });
    const warn = lines.filter((l) => l.id === 'pi-update');
    expect(warn).toHaveLength(1);
    expect(warn[0]?.text).toBe(CLEANUP_NEEDS_UPDATE_COPY);
    expect(warn[0]?.tone).toBe('warn');
  });

  it('shows no pre-run warning when capabilities are stale', () => {
    const lines = diskBackupStatusLines({
      disk: disk({ clockTrusted: true }),
      engine: rolledBack,
      now: NOW,
    });
    expect(lines).toEqual([]);
    expect(lines.find((l) => l.id === 'pi-update')).toBeUndefined();
  });

  it('shows the warning only once when a HELPER_OUTDATED result arrives and backupCleanup is missing', () => {
    const lines = diskBackupStatusLines({
      disk: disk({ clockTrusted: true }),
      engine: flaggedEngine(),
      instances: [inst({ lastResult: result({ result: 'HELPER_OUTDATED' }) })],
      now: NOW,
    });
    const warnings = lines.filter((l) =>
      l.id === 'pi-update'
      || l.text === CLEANUP_NEEDS_UPDATE_COPY
      || l.text === HELPER_OUTDATED_COPY
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.text).toBe(CLEANUP_NEEDS_UPDATE_COPY);
  });

  it('shows no pre-run warning when scheduledBackups is missing', () => {
    const lines = diskBackupStatusLines({
      disk: disk({ clockTrusted: true }),
      engine: oldEngine,
      now: NOW,
    });
    expect(lines).toEqual([]);
    expect(lines.find((l) => l.id === 'pi-update')).toBeUndefined();
  });
});

describe('instanceBackupStatusLines — backupCleanup does not double the warning', () => {
  it('omits the runtime HELPER_OUTDATED line when the pre-run warning already applies', () => {
    const lines = instanceBackupStatusLines({
      instance: inst({ lastResult: result({ result: 'HELPER_OUTDATED' }) }),
      engine: flaggedEngine(),
    });
    expect(lines.filter((l) =>
      l.text === HELPER_OUTDATED_COPY || l.text === CLEANUP_NEEDS_UPDATE_COPY
    )).toEqual([]);
  });

  it('keeps the runtime HELPER_OUTDATED line when backupCleanup is fresh', () => {
    const lines = instanceBackupStatusLines({
      instance: inst({ lastResult: result({ result: 'HELPER_OUTDATED' }) }),
      engine: flaggedEngine([BACKUP_CLEANUP_CAPABILITY]),
    });
    expect(lines.find((l) => l.id === 'last-result')?.text).toBe(HELPER_OUTDATED_COPY);
  });
});

describe('diskBackupStatusLines — orphanLinks (Engine #356)', () => {
  const engine = flaggedEngine();

  it('shows nothing when orphanLinks is missing (older Engines)', () => {
    const lines = diskBackupStatusLines({
      disk: disk({ clockTrusted: true }),
      engine,
      now: NOW,
    });
    expect(disk({}).backupConfig?.orphanLinks).toBeUndefined();
    expect(lines.find((l) => l.id === 'orphan-links')).toBeUndefined();
  });

  it('shows nothing when orphanLinks is empty', () => {
    const lines = diskBackupStatusLines({
      disk: disk({
        clockTrusted: true,
        backupConfig: {
          mode: 'scheduled',
          links: ['inst-1'],
          schedule: { daily: '02:30' },
          orphanLinks: [],
        },
      }),
      engine,
      now: NOW,
    });
    expect(lines.find((l) => l.id === 'orphan-links')).toBeUndefined();
  });

  it('uses singular wording for one orphan link', () => {
    const lines = diskBackupStatusLines({
      disk: disk({
        clockTrusted: true,
        backupConfig: {
          mode: 'scheduled',
          links: ['inst-1', 'gone-1'],
          schedule: { daily: '02:30' },
          orphanLinks: ['gone-1'],
        },
      }),
      engine,
      now: NOW,
    });
    const line = lines.find((l) => l.id === 'orphan-links');
    expect(line?.text).toBe(orphanLinksCopy(['gone-1']));
    expect(line?.text).toBe(
      "1 older backup belongs to an app that isn't on this network. It is kept and skipped.",
    );
    expect(line?.tone).toBe('info');
  });

  it('uses plural wording for two or more orphan links', () => {
    const lines = diskBackupStatusLines({
      disk: disk({
        clockTrusted: true,
        backupConfig: {
          mode: 'scheduled',
          links: ['inst-1', 'gone-1', 'gone-2'],
          schedule: { daily: '02:30' },
          orphanLinks: ['gone-1', 'gone-2'],
        },
      }),
      engine,
      now: NOW,
    });
    const line = lines.find((l) => l.id === 'orphan-links');
    expect(line?.text).toBe(orphanLinksCopy(['gone-1', 'gone-2']));
    expect(line?.text).toBe(
      "2 older backups belong to apps that aren't on this network. They are kept and skipped.",
    );
    expect(line?.tone).toBe('info');
  });
});
