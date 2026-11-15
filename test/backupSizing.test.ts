import { describe, it, expect } from 'vitest';
import { deriveBackupSizing, formatAppDataSize } from '../src/store/backupSizing';
import type { Disk, Instance, Store } from '../src/types/store';

const BOOT = 1_700_000_000_000;
const GB = 1_000_000_000;

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

describe('formatAppDataSize', () => {
  it('never shows 0 GB for a small or zero value', () => {
    expect(formatAppDataSize(0)).toBe('less than 1 GB');
    expect(formatAppDataSize(1)).toBe('less than 1 GB');
    expect(formatAppDataSize(500_000_000)).toBe('less than 1 GB');
    expect(formatAppDataSize(GB - 1)).toBe('less than 1 GB');
  });

  it('uses one decimal under 10 GB and whole numbers from 10 GB', () => {
    expect(formatAppDataSize(GB)).toBe('1.0 GB');
    expect(formatAppDataSize(1.5 * GB)).toBe('1.5 GB');
    expect(formatAppDataSize(9.94 * GB)).toBe('9.9 GB');
    expect(formatAppDataSize(9.95 * GB)).toBe('10 GB');
    expect(formatAppDataSize(10 * GB)).toBe('10 GB');
    expect(formatAppDataSize(12.4 * GB)).toBe('12 GB');
    expect(formatAppDataSize(12.5 * GB)).toBe('13 GB');
  });
});

describe('deriveBackupSizing', () => {
  it('returns no text when the Engine is unknown', () => {
    const store = storeOf([disk()], [inst({ dataBytes: 2 * GB })]);
    expect(deriveBackupSizing(store, null).text).toBeNull();
    expect(deriveBackupSizing(store, undefined).text).toBeNull();
    expect(deriveBackupSizing(store, '').text).toBeNull();
  });

  it('says there are no Apps when none sit on this Pi', () => {
    expect(deriveBackupSizing(storeOf([], []), 'eng-1').text).toBe('No Apps on this Pi yet');
    expect(deriveBackupSizing(null, 'eng-1').text).toBe('No Apps on this Pi yet');
  });

  it('sums all measured Apps on this Engine', () => {
    const store = storeOf(
      [disk(), disk({ id: 'app-2', name: 'app-disk-2' })],
      [
        inst({ id: 'a', storedOn: 'app-1', dataBytes: 2 * GB }),
        inst({ id: 'b', storedOn: 'app-2', dataBytes: 3.5 * GB }),
      ],
    );
    const result = deriveBackupSizing(store, 'eng-1');
    expect(result.totalBytes).toBe(5.5 * GB);
    expect(result.measuredCount).toBe(2);
    expect(result.unmeasuredCount).toBe(0);
    expect(result.text).toBe("This Pi's Apps use about 5.5 GB");
  });

  it('shows a partial total when some Apps are not measured yet', () => {
    const store = storeOf(
      [disk()],
      [
        inst({ id: 'a', dataBytes: 2 * GB }),
        inst({ id: 'b', dataBytes: null }),
        inst({ id: 'c' }), // missing field
      ],
    );
    const result = deriveBackupSizing(store, 'eng-1');
    expect(result.totalBytes).toBe(2 * GB);
    expect(result.measuredCount).toBe(1);
    expect(result.unmeasuredCount).toBe(2);
    expect(result.appCount).toBe(3);
    expect(result.text).toBe("This Pi's Apps use about 2.0 GB (2 Apps not measured yet)");
  });

  it('uses the singular App word for one unmeasured instance', () => {
    const store = storeOf(
      [disk()],
      [
        inst({ id: 'a', dataBytes: 4 * GB }),
        inst({ id: 'b', dataBytes: null }),
      ],
    );
    expect(deriveBackupSizing(store, 'eng-1').text).toBe(
      "This Pi's Apps use about 4.0 GB (1 App not measured yet)",
    );
  });

  it('says not measured yet when every App is null or missing', () => {
    const store = storeOf(
      [disk()],
      [
        inst({ id: 'a', dataBytes: null }),
        inst({ id: 'b' }),
      ],
    );
    const result = deriveBackupSizing(store, 'eng-1');
    expect(result.measuredCount).toBe(0);
    expect(result.unmeasuredCount).toBe(2);
    expect(result.totalBytes).toBe(0);
    expect(result.text).toBe("This Pi's Apps haven't been measured yet");
  });

  it('excludes instances on disks docked to another Engine', () => {
    const store = storeOf(
      [
        disk({ id: 'here', dockedTo: 'eng-1' }),
        disk({ id: 'there', dockedTo: 'eng-2', name: 'other-pi' }),
      ],
      [
        inst({ id: 'local', storedOn: 'here', dataBytes: 2 * GB }),
        inst({ id: 'remote', storedOn: 'there', dataBytes: 40 * GB }),
      ],
    );
    const result = deriveBackupSizing(store, 'eng-1');
    expect(result.appCount).toBe(1);
    expect(result.totalBytes).toBe(2 * GB);
    expect(result.text).toBe("This Pi's Apps use about 2.0 GB");
  });

  it('excludes instances on undocked disks', () => {
    const store = storeOf(
      [
        disk({ id: 'docked', dockedTo: 'eng-1' }),
        disk({ id: 'undocked', dockedTo: null, device: null, name: 'away' }),
      ],
      [
        inst({ id: 'here', storedOn: 'docked', dataBytes: 3 * GB }),
        inst({ id: 'away', storedOn: 'undocked', dataBytes: 50 * GB }),
      ],
    );
    const result = deriveBackupSizing(store, 'eng-1');
    expect(result.appCount).toBe(1);
    expect(result.totalBytes).toBe(3 * GB);
    expect(result.text).toBe("This Pi's Apps use about 3.0 GB");
  });

  it('excludes instances with no storedOn disk', () => {
    const store = storeOf(
      [disk()],
      [
        inst({ id: 'on-disk', storedOn: 'app-1', dataBytes: 2 * GB }),
        inst({ id: 'floating', storedOn: null, dataBytes: 8 * GB }),
      ],
    );
    expect(deriveBackupSizing(store, 'eng-1').appCount).toBe(1);
    expect(deriveBackupSizing(store, 'eng-1').totalBytes).toBe(2 * GB);
  });

  it('uses less than 1 GB when the measured total is small', () => {
    const store = storeOf(
      [disk()],
      [inst({ dataBytes: 250_000_000 })],
    );
    expect(deriveBackupSizing(store, 'eng-1').text).toBe("This Pi's Apps use less than 1 GB");
  });

  it('keeps less than 1 GB, with no about, when some Apps are not measured yet', () => {
    const store = storeOf(
      [disk()],
      [
        inst({ id: 'a', dataBytes: 250_000_000 }),
        inst({ id: 'b', dataBytes: null }),
      ],
    );
    expect(deriveBackupSizing(store, 'eng-1').text).toBe(
      "This Pi's Apps use less than 1 GB (1 App not measured yet)",
    );
  });

  it('uses whole numbers from 10 GB and keeps the unmeasured note', () => {
    const store = storeOf(
      [disk()],
      [
        inst({ id: 'a', dataBytes: 12.4 * GB }),
        inst({ id: 'b', dataBytes: null }),
      ],
    );
    expect(deriveBackupSizing(store, 'eng-1').text).toBe(
      "This Pi's Apps use about 12 GB (1 App not measured yet)",
    );
  });
});
