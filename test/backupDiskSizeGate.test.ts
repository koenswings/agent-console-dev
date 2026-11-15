import { describe, it, expect } from 'vitest';
import {
  BACKUP_DISK_MIN_BYTES,
  BACKUP_DISK_HEADROOM,
  BACKUP_DISK_TOO_SMALL_MIN,
  BACKUP_DISK_SIZE_UNKNOWN_WARN,
  BACKUP_DISK_FREE_UNKNOWN_WARN,
  assessBackupDiskSize,
  instancesForLinkedBackup,
  instancesForAllAppsOnPi,
  usableDiskBytes,
  appDataSizePhrase,
} from '../src/store/backupDiskSizeGate';
import type { Disk, Instance, Store } from '../src/types/store';

const BOOT = 1_700_000_000_000;
const GB = 1_000_000_000;
const GIB = 1024 * 1024 * 1024;

const disk = (over: Partial<Disk> = {}): Disk => ({
  id: 'app-1',
  name: 'app-disk',
  device: 'sda1',
  created: BOOT,
  lastDocked: BOOT,
  dockedTo: 'eng-1',
  diskTypes: ['app'],
  backupConfig: null,
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
  storedOn: 'app-1',
  statusCondition: null,
  currentStep: null,
  totalSteps: null,
  stepLabel: null,
  metrics: null,
  ...over,
});

const storeOf = (disks: Disk[], instances: Instance[]): Pick<Store, 'diskDB' | 'instanceDB'> => ({
  diskDB: Object.fromEntries(disks.map((d) => [d.id, d])),
  instanceDB: Object.fromEntries(instances.map((i) => [i.id, i])),
});

describe('usableDiskBytes', () => {
  it('rejects missing, zero, and non-finite values', () => {
    expect(usableDiskBytes(null)).toBeNull();
    expect(usableDiskBytes(undefined)).toBeNull();
    expect(usableDiskBytes(0)).toBeNull();
    expect(usableDiskBytes(-1)).toBeNull();
    expect(usableDiskBytes(Number.NaN)).toBeNull();
    expect(usableDiskBytes(8 * GIB)).toBe(8 * GIB);
  });
});

describe('assessBackupDiskSize — 8 GiB floor', () => {
  it('BACKUP_DISK_MIN_BYTES is 8 GiB, the same as the Engine', () => {
    expect(BACKUP_DISK_MIN_BYTES).toBe(8 * GIB);
    expect(BACKUP_DISK_HEADROOM).toBe(1.5);
  });

  it('blocks just under 8 GiB even when no App is measured', () => {
    const gate = assessBackupDiskSize({
      instances: [inst({ dataBytes: null })],
      totalSizeBytes: 8 * GIB - 1,
      wording: 'thisPi',
    });
    expect(gate.blocked).toBe(true);
    expect(gate.blockReason).toBe(BACKUP_DISK_TOO_SMALL_MIN);
    expect(gate.warning).toBeUndefined();
  });

  it('allows exactly 8 GiB when App data does not demand more', () => {
    const gate = assessBackupDiskSize({
      instances: [inst({ dataBytes: 1 * GB })],
      totalSizeBytes: 8 * GIB,
      wording: 'thisPi',
    });
    expect(1.5 * GB).toBeLessThan(8 * GIB);
    expect(gate.blocked).toBe(false);
    expect(gate.blockReason).toBeUndefined();
  });

  it('uses the 8 GiB wording when both rules fail but 1.5× data is still under 8 GiB', () => {
    // 2 GB data → 3 GB needed, both under 8 GiB; a 2 GiB disk fails the floor first.
    const gate = assessBackupDiskSize({
      instances: [inst({ dataBytes: 2 * GB })],
      totalSizeBytes: 2 * GIB,
      wording: 'selected',
    });
    expect(gate.blocked).toBe(true);
    expect(gate.blockReason).toBe(BACKUP_DISK_TOO_SMALL_MIN);
  });
});

describe('assessBackupDiskSize — 1.5× App data', () => {
  it('blocks a disk smaller than 1.5× the measured data, with selected-Apps wording', () => {
    const gate = assessBackupDiskSize({
      instances: [inst({ dataBytes: 12 * GB })],
      totalSizeBytes: 16 * GB,
      wording: 'selected',
    });
    expect(gate.neededForApps).toBe(18 * GB);
    expect(gate.blocked).toBe(true);
    expect(gate.blockReason).toBe(
      'This disk is too small for the Apps you chose. They use about 12 GB, so the Backup Disk needs about 18 GB. Choose a larger disk.',
    );
  });

  it('allows a disk that is at least 1.5× the measured data', () => {
    const gate = assessBackupDiskSize({
      instances: [inst({ dataBytes: 12 * GB })],
      totalSizeBytes: 20 * GB,
      wording: 'selected',
    });
    expect(gate.blocked).toBe(false);
    expect(gate.blockReason).toBeUndefined();
    expect(gate.warning).toBeUndefined();
  });

  it('uses this-Pi wording when there is no instance picker', () => {
    const gate = assessBackupDiskSize({
      instances: [inst({ dataBytes: 12 * GB })],
      totalSizeBytes: 16 * GB,
      wording: 'thisPi',
    });
    expect(gate.blockReason).toBe(
      "This disk is too small for this Pi's Apps. They use about 12 GB, so the Backup Disk needs about 18 GB. Choose a larger disk.",
    );
  });

  it('prefers App-data wording when both rules fail and 1.5× data is above 8 GiB', () => {
    const gate = assessBackupDiskSize({
      instances: [inst({ dataBytes: 12 * GB })],
      totalSizeBytes: 7 * GIB,
      wording: 'thisPi',
    });
    expect(18 * GB).toBeGreaterThan(BACKUP_DISK_MIN_BYTES);
    expect(gate.blocked).toBe(true);
    expect(gate.blockReason).toMatch(/too small for this Pi's Apps/);
    expect(gate.blockReason).not.toBe(BACKUP_DISK_TOO_SMALL_MIN);
  });

  it('keeps 1.5× in bytes when the measured total is under 1 GB', () => {
    const gate = assessBackupDiskSize({
      instances: [inst({ dataBytes: 800_000_000 })],
      totalSizeBytes: 20 * GB,
      wording: 'selected',
    });
    expect(gate.neededForApps).toBe(1.2 * GB);
    expect(gate.blocked).toBe(false);
    expect(appDataSizePhrase(800_000_000)).toBe('less than 1 GB');
    expect(appDataSizePhrase(1.2 * GB)).toBe('about 1.2 GB');
  });

  it('includes unmeasured Apps in the block sentence when the measured part already does not fit', () => {
    const gate = assessBackupDiskSize({
      instances: [
        inst({ id: 'a', dataBytes: 12 * GB }),
        inst({ id: 'b', dataBytes: null }),
      ],
      totalSizeBytes: 16 * GB,
      wording: 'selected',
    });
    expect(gate.blocked).toBe(true);
    expect(gate.blockReason).toBe(
      'This disk is too small for the Apps you chose. They use about 12 GB (1 App not measured yet), so the Backup Disk needs about 18 GB. Choose a larger disk.',
    );
  });
});

describe('assessBackupDiskSize — warn, do not block', () => {
  it('warns and does not block when every dataBytes is null, unless under 8 GiB', () => {
    const ok = assessBackupDiskSize({
      instances: [inst({ dataBytes: null }), inst({ id: 'b', dataBytes: undefined })],
      totalSizeBytes: 32 * GB,
      wording: 'thisPi',
    });
    expect(ok.blocked).toBe(false);
    expect(ok.warning).toBe(
      "This Pi's Apps haven't been measured yet, so we can't check whether this disk is big enough. You can continue, or wait until the sizes appear.",
    );

    const selected = assessBackupDiskSize({
      instances: [inst({ dataBytes: null })],
      totalSizeBytes: 32 * GB,
      wording: 'selected',
    });
    expect(selected.warning).toMatch(/^The Apps you chose haven't been measured yet/);
  });

  it('warns and does not block when some Apps are unmeasured and the measured 1.5× fits', () => {
    const gate = assessBackupDiskSize({
      instances: [
        inst({ id: 'a', dataBytes: 2 * GB }),
        inst({ id: 'b', dataBytes: null }),
      ],
      totalSizeBytes: 32 * GB,
      wording: 'thisPi',
    });
    expect(gate.blocked).toBe(false);
    expect(gate.warning).toBe(
      "This Pi's Apps use about 2.0 GB (1 App not measured yet). This disk looks large enough for the measured Apps, but we can't check the App that hasn't been measured.",
    );
  });

  it('uses the plural unmeasured clause for two or more unmeasured Apps', () => {
    const gate = assessBackupDiskSize({
      instances: [
        inst({ id: 'a', dataBytes: 2 * GB }),
        inst({ id: 'b', dataBytes: null }),
        inst({ id: 'c', dataBytes: null }),
      ],
      totalSizeBytes: 32 * GB,
      wording: 'selected',
    });
    expect(gate.warning).toBe(
      "The Apps you chose use about 2.0 GB (2 Apps not measured yet). This disk looks large enough for the measured Apps, but we can't check the Apps that haven't been measured.",
    );
  });

  it('warns and does not block when the disk size is unknown', () => {
    const gate = assessBackupDiskSize({
      instances: [inst({ dataBytes: 12 * GB })],
      totalSizeBytes: null,
      wording: 'selected',
    });
    expect(gate.blocked).toBe(false);
    expect(gate.warning).toBe(BACKUP_DISK_SIZE_UNKNOWN_WARN);
  });

  it('treats a zero or missing size as unknown', () => {
    expect(assessBackupDiskSize({
      instances: [inst({ dataBytes: 12 * GB })],
      totalSizeBytes: 0,
      wording: 'thisPi',
    }).warning).toBe(BACKUP_DISK_SIZE_UNKNOWN_WARN);
  });

  it('with an explicit null capacity (freeBytes later), warns and does not block the 1.5× part', () => {
    const gate = assessBackupDiskSize({
      instances: [inst({ dataBytes: 12 * GB })],
      totalSizeBytes: 32 * GB,
      capacityBytes: null,
      wording: 'thisPi',
    });
    expect(gate.blocked).toBe(false);
    expect(gate.warning).toBe(BACKUP_DISK_FREE_UNKNOWN_WARN);
  });

  it('still blocks on the 8 GiB floor when freeBytes is missing', () => {
    const gate = assessBackupDiskSize({
      instances: [inst({ dataBytes: 12 * GB })],
      totalSizeBytes: 7 * GIB,
      capacityBytes: null,
      wording: 'thisPi',
    });
    expect(gate.blocked).toBe(true);
    // 1.5× of 12 GB is above 8 GiB, but capacity is unknown so only the floor applies.
    expect(gate.blockReason).toBe(BACKUP_DISK_TOO_SMALL_MIN);
  });

  it('compares 1.5× against an explicit capacity (freeBytes) while the 8 GiB floor uses total size', () => {
    const blocked = assessBackupDiskSize({
      instances: [inst({ dataBytes: 12 * GB })],
      totalSizeBytes: 64 * GB,
      capacityBytes: 16 * GB,
      wording: 'thisPi',
    });
    expect(blocked.blocked).toBe(true);
    expect(blocked.blockReason).toMatch(/needs about 18 GB/);

    const allowed = assessBackupDiskSize({
      instances: [inst({ dataBytes: 12 * GB })],
      totalSizeBytes: 64 * GB,
      capacityBytes: 20 * GB,
      wording: 'thisPi',
    });
    expect(allowed.blocked).toBe(false);
  });
});

describe('instancesForLinkedBackup', () => {
  it('returns the ticked instances and omits backupMethod none', () => {
    const store = storeOf(
      [disk()],
      [
        inst({ id: 'a', dataBytes: 2 * GB }),
        inst({ id: 'b', dataBytes: 3 * GB, backupMethod: 'none' }),
        inst({ id: 'c', dataBytes: 1 * GB, backupMethod: 'stop' }),
      ],
    );
    const list = instancesForLinkedBackup(store, ['a', 'b', 'c', 'missing']);
    expect(list.map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('returns nothing for an empty selection or a missing store', () => {
    expect(instancesForLinkedBackup(storeOf([disk()], [inst()]), [])).toEqual([]);
    expect(instancesForLinkedBackup(null, ['a'])).toEqual([]);
  });
});

describe('instancesForAllAppsOnPi', () => {
  it('includes instances on disks docked to this Engine, and omits demos, method none, other Engines, and the target disk', () => {
    const store = storeOf(
      [
        disk({ id: 'app-1', dockedTo: 'eng-1', device: 'sda1' }),
        disk({ id: 'app-2', dockedTo: 'eng-1', device: 'sdb1' }),
        disk({ id: 'remote', dockedTo: 'eng-2', device: 'sdc1' }),
        disk({ id: 'undocked', dockedTo: 'eng-1', device: null }),
        disk({ id: 'target', dockedTo: 'eng-1', device: 'sdd1', diskTypes: ['empty'] }),
      ],
      [
        inst({ id: 'keep', storedOn: 'app-1', dataBytes: 2 * GB }),
        inst({ id: 'also', storedOn: 'app-2', dataBytes: 1 * GB }),
        inst({ id: 'demo', storedOn: 'app-1', demo: true, dataBytes: 9 * GB }),
        inst({ id: 'none', storedOn: 'app-1', backupMethod: 'none', dataBytes: 9 * GB }),
        inst({ id: 'away', storedOn: 'remote', dataBytes: 9 * GB }),
        inst({ id: 'loose', storedOn: 'undocked', dataBytes: 9 * GB }),
        inst({ id: 'on-target', storedOn: 'target', dataBytes: 9 * GB }),
      ],
    );
    const list = instancesForAllAppsOnPi(store, 'eng-1', 'target');
    expect(list.map((i) => i.id).sort()).toEqual(['also', 'keep']);
  });

  it('returns nothing without a store or Engine', () => {
    expect(instancesForAllAppsOnPi(null, 'eng-1')).toEqual([]);
    expect(instancesForAllAppsOnPi(storeOf([disk()], [inst()]), null)).toEqual([]);
  });
});
