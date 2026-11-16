/**
 * agent-console-dev#209 — "Make this also a Backup Disk" helpers: offer rule,
 * size grey-out, wording, command shape, step mapping, remote check.
 */
import { describe, it, expect } from 'vitest';
import {
  ADOPT_BACKUP_DISK_SAME_DISK_WARNING,
  ADOPT_BACKUP_DISK_SIZE_UNKNOWN,
  ADOPT_BACKUP_DISK_TOO_SMALL_REASON,
  adoptBackupDiskBlockedReason,
  adoptBackupDiskSizeGate,
  adoptBackupDiskErrorText,
  adoptBackupDiskRemoteCheck,
  adoptBackupDiskTitle,
  canOfferAdoptBackupDisk,
  diskHoldsInstances,
  makeBackupDiskOpIds,
} from '../src/store/adoptBackupDisk';
import { buildMakeBackupDiskCommand } from '../src/store/commands';
import { MAKE_BACKUP_DISK_ERROR_TEXT, makeBackupDiskProgress } from '../src/store/makeBackupDisk';
import { MOCK_FILES_STORE, FILES_IDS as I } from '../src/mock/filesFixtures';
import type { Disk, Engine, Operation, Store } from '../src/types/store';

const GIB = 1024 * 1024 * 1024;

const withFlag = (s: Store, engineId: string, fresh = true): Store => {
  const eng = s.engineDB[engineId] as Engine;
  return {
    ...s,
    engineDB: {
      ...s.engineDB,
      [engineId]: {
        ...eng,
        capabilities: [...(eng.capabilities ?? []), 'makeBackupDisk'],
        capabilitiesBootedAt: fresh ? eng.lastBooted : (eng.lastBooted ?? 1) - 10_000,
      },
    },
  };
};
const withDisk = (s: Store, id: string, patch: Partial<Disk>): Store => ({
  ...s,
  diskDB: { ...s.diskDB, [id]: { ...s.diskDB[id], ...patch } },
});
const engA = (s: Store) => s.engineDB[I.ENGINE_A];

const op = (over: Partial<Operation> = {}): Operation => ({
  id: 'op-new',
  kind: 'makeBackupDisk',
  args: { targetId: I.FA_APP },
  cause: 'console-command',
  subject: { type: 'disk', id: I.FA_APP },
  engineId: I.ENGINE_A,
  status: 'Running',
  progressPercent: 0,
  currentStep: 0,
  totalSteps: 4,
  stepLabel: 'Check',
  startedAt: 1,
  completedAt: null,
  error: null,
  ...over,
});

describe('canOfferAdoptBackupDisk', () => {
  const on = withFlag(MOCK_FILES_STORE, I.ENGINE_A);

  it('flag on: offered on an App Disk and on a Files Disk without the backup role', () => {
    expect(canOfferAdoptBackupDisk(on.diskDB[I.FA_APP], engA(on), on)).toBe(true);
    expect(canOfferAdoptBackupDisk(on.diskDB[I.FA_FILES], engA(on), on)).toBe(true);
    expect(canOfferAdoptBackupDisk(on.diskDB[I.FA_APP_FILES], engA(on), on)).toBe(true);
  });

  it('flag absent or stale: hidden', () => {
    const off = MOCK_FILES_STORE;
    expect(canOfferAdoptBackupDisk(off.diskDB[I.FA_APP], engA(off), off)).toBe(false);
    const stale = withFlag(MOCK_FILES_STORE, I.ENGINE_A, false);
    expect(canOfferAdoptBackupDisk(stale.diskDB[I.FA_APP], engA(stale), stale)).toBe(false);
  });

  it('already a Backup Disk (diskTypes or backupConfig): hidden', () => {
    expect(canOfferAdoptBackupDisk(on.diskDB[I.FA_ABF], engA(on), on)).toBe(false);
    expect(canOfferAdoptBackupDisk(on.diskDB[I.FA_BACKUP], engA(on), on)).toBe(false);
    const cfg = withDisk(on, I.FA_APP, { backupConfig: { mode: 'scheduled' } as Disk['backupConfig'] });
    expect(canOfferAdoptBackupDisk(cfg.diskDB[I.FA_APP], engA(cfg), cfg)).toBe(false);
  });

  it('system, undocked, or no App/Files role: hidden', () => {
    const sys = withDisk(on, I.FA_APP, { diskTypes: ['system'] });
    expect(canOfferAdoptBackupDisk(sys.diskDB[I.FA_APP], engA(sys), sys)).toBe(false);
    const gone = withDisk(on, I.FA_APP, { device: null });
    expect(canOfferAdoptBackupDisk(gone.diskDB[I.FA_APP], engA(gone), gone)).toBe(false);
    const upgrade = withDisk(on, I.FA_FILES, { diskTypes: ['upgrade'] });
    expect(canOfferAdoptBackupDisk(upgrade.diskDB[I.FA_FILES], engA(upgrade), upgrade)).toBe(false);
  });
});

describe('adoptBackupDiskBlockedReason (8 GiB, Disk.sizeBytes)', () => {
  const on = withFlag(MOCK_FILES_STORE, I.ENGINE_A);
  const sized = (n: number | null) => withDisk(on, I.FA_APP, { sizeBytes: n });

  it('under 8 GiB: greyed out with the new wording', () => {
    const s = sized(8 * GIB - 1);
    expect(adoptBackupDiskBlockedReason(engA(s), s, I.FA_APP)).toBe(
      'Too small: needs more than 8 GB. Choose a disk larger than all the App data on this Pi.',
    );
  });
  it('exactly 8 GiB and over: allowed', () => {
    expect(adoptBackupDiskBlockedReason(engA(sized(8 * GIB)), sized(8 * GIB), I.FA_APP)).toBeUndefined();
    expect(adoptBackupDiskBlockedReason(engA(sized(64 * GIB)), sized(64 * GIB), I.FA_APP)).toBeUndefined();
  });
  it('unknown size: allowed (the Engine decides)', () => {
    expect(adoptBackupDiskBlockedReason(engA(sized(null)), sized(null), I.FA_APP)).toBeUndefined();
  });
  it('erase in progress: greyed out', () => {
    const s = { ...on, engineDB: { ...on.engineDB, [I.ENGINE_A]: { ...engA(on), eraseInProgress: { label: 'Stick' } } } } as Store;
    expect(adoptBackupDiskBlockedReason(engA(s), s, I.FA_APP)).toMatch(/erase of Stick is already in progress/);
  });
});

describe('App data against free space (console#219 gate, engine#424 set)', () => {
  const DEC_GB = 1_000_000_000;
  const on = withFlag(MOCK_FILES_STORE, I.ENGINE_A);
  /** Only the instances given; FA_APP sized 500 GiB with the given free space. */
  const withApps = (freeBytes: number | null, instances: Record<string, unknown>): Store => ({
    ...withDisk(on, I.FA_APP, { sizeBytes: 500 * GIB, freeBytes }),
    instanceDB: instances as Store['instanceDB'],
  });
  const inst = (id: string, storedOn: string, dataBytes: number | null, over: Record<string, unknown> = {}) =>
    ({ ...Object.values(MOCK_FILES_STORE.instanceDB)[0], id, storedOn, dataBytes, demo: false, backupMethod: 'stop', ...over });

  it('blocks when 1.5× the other Apps\' data does not fit in the free space (not the total size)', () => {
    const s = withApps(10 * GIB, { x: inst('x', I.FA_FILES, 12 * DEC_GB) });
    expect(adoptBackupDiskBlockedReason(engA(s), s, I.FA_APP)).toBe(
      "This disk is too small for this Pi's Apps. They use about 12 GB, so the Backup Disk needs about 18 GB. Choose a larger disk.",
    );
  });

  it('allows it when the free space is enough', () => {
    const s = withApps(100 * GIB, { x: inst('x', I.FA_FILES, 12 * DEC_GB) });
    expect(adoptBackupDiskBlockedReason(engA(s), s, I.FA_APP)).toBeUndefined();
  });

  it('leaves out the Apps stored on this disk itself, demos and method none (as the Engine does)', () => {
    const s = withApps(10 * GIB, {
      own: inst('own', I.FA_APP, 300 * DEC_GB),
      demo: inst('demo', I.FA_FILES, 300 * DEC_GB, { demo: true }),
      none: inst('none', I.FA_FILES, 300 * DEC_GB, { backupMethod: 'none' }),
      x: inst('x', I.FA_FILES, 1 * DEC_GB),
    });
    const gate = adoptBackupDiskSizeGate(engA(s), s, I.FA_APP);
    expect(gate?.measuredSum).toBe(1 * DEC_GB);
    expect(gate?.blocked).toBe(false);
  });

  it('unknown free space: warns, does not block; the 8 GiB floor still uses total size', () => {
    const s = withApps(null, { x: inst('x', I.FA_FILES, 12 * DEC_GB) });
    const gate = adoptBackupDiskSizeGate(engA(s), s, I.FA_APP);
    expect(gate?.blocked).toBe(false);
    expect(gate?.warning).toMatch(/free space isn't known yet/);
    const small = withDisk(s, I.FA_APP, { sizeBytes: 4 * GIB });
    expect(adoptBackupDiskBlockedReason(engA(small), small, I.FA_APP)).toMatch(/too small/i);
  });

  it('the same-disk note states what the Engine does (engine#424 skips them)', () => {
    expect(ADOPT_BACKUP_DISK_SAME_DISK_WARNING).toBe(
      'Apps stored on this disk are not backed up onto it. Move them to another disk to protect them.',
    );
  });
});

describe('command, title and step mapping', () => {
  it('sends exactly makeBackupDisk <diskId> (no summary, no typed label)', () => {
    expect(buildMakeBackupDiskCommand(I.FA_APP)).toBe(`makeBackupDisk ${I.FA_APP}`);
  });
  it('title names the disk', () => {
    expect(adoptBackupDiskTitle('Kolibri Disk')).toBe('Make Kolibri Disk also a Backup Disk?');
  });
  it.each([
    ['Check', 0, 'Check'],
    ['Erase (skipped)', 1, 'Create'],
    ['Re-dock (skipped)', 2, 'Create'],
    ['Create', 3, 'Create'],
  ] as const)('stepLabel %s → shown step %s', (stepLabel, currentStep, shown) => {
    expect(makeBackupDiskProgress(op({ stepLabel, currentStep }), true).currentId).toBe(shown);
  });
});

describe('adoptBackupDiskErrorText', () => {
  it.each([
    ['ALREADY_BACKUP: X is already a Backup Disk; use setBackupMode to change mode or time.', MAKE_BACKUP_DISK_ERROR_TEXT.ALREADY_BACKUP],
    ['BUSY: try again later: a backup is running on this disk', MAKE_BACKUP_DISK_ERROR_TEXT.BUSY],
    ["NOT_DOCKED: Disk 'X' (X) is not docked to this Engine.", MAKE_BACKUP_DISK_ERROR_TEXT.NOT_DOCKED],
    ['TOO_SMALL: this disk is 2000000000 bytes; a Backup Disk must be at least 8589934592 bytes (8 GiB).', ADOPT_BACKUP_DISK_TOO_SMALL_REASON],
    ["TOO_SMALL: could not read the size of 'X', so it was not turned into a Backup Disk.", ADOPT_BACKUP_DISK_SIZE_UNKNOWN],
    ["SYSTEM_DISK: X is this Pi's system disk and cannot become a Backup Disk.", MAKE_BACKUP_DISK_ERROR_TEXT.SYSTEM_DISK],
    ['WRITE_FAILED: EACCES', MAKE_BACKUP_DISK_ERROR_TEXT.WRITE_FAILED],
  ] as const)('%s', (raw, text) => {
    const out = adoptBackupDiskErrorText(raw);
    expect(out).toBe(text);
    expect(out).not.toMatch(/[A-Z]{3,}_[A-Z]+|borg|YAML|helper|setBackupMode/i);
  });
  it('uses the trace errorCode when given', () => {
    expect(adoptBackupDiskErrorText('a backup is running on this disk', 'BUSY')).toBe(MAKE_BACKUP_DISK_ERROR_TEXT.BUSY);
  });
});

describe('instances and the remote check', () => {
  it('diskHoldsInstances', () => {
    expect(diskHoldsInstances(MOCK_FILES_STORE, I.FA_APP)).toBe(true);
    expect(diskHoldsInstances(MOCK_FILES_STORE, I.FA_FILES)).toBe(false);
  });

  it('ignores an op from before the send, ok on a new Done op with the backup role, error on Failed', () => {
    const old = op({ id: 'op-old', status: 'Failed', error: 'BUSY: try again later' });
    const s0: Store = { ...MOCK_FILES_STORE, operationDB: { [old.id]: old } };
    const baseline = makeBackupDiskOpIds(s0, I.FA_APP);
    expect(baseline.has('op-old')).toBe(true);
    expect(adoptBackupDiskRemoteCheck(s0, I.ENGINE_A, I.FA_APP, baseline)).toBeNull();

    const done = op({ status: 'Done', startedAt: 5, stepLabel: 'Create', currentStep: 3 });
    const notYet: Store = { ...s0, operationDB: { ...s0.operationDB, [done.id]: done } };
    expect(adoptBackupDiskRemoteCheck(notYet, I.ENGINE_A, I.FA_APP, baseline)).toBeNull();
    const withRole = withDisk(notYet, I.FA_APP, { diskTypes: ['app', 'backup'] });
    expect(adoptBackupDiskRemoteCheck(withRole, I.ENGINE_A, I.FA_APP, baseline)).toBe('ok');

    const failed = op({ status: 'Failed', startedAt: 5, error: 'ALREADY_BACKUP: X is already a Backup Disk' });
    const sf: Store = { ...s0, operationDB: { ...s0.operationDB, [failed.id]: failed } };
    expect(adoptBackupDiskRemoteCheck(sf, I.ENGINE_A, I.FA_APP, baseline)).toEqual({
      error: 'ALREADY_BACKUP: X is already a Backup Disk',
      code: 'ALREADY_BACKUP',
    });
  });
});
