/**
 * idea#404 — makeBackupDisk helpers coded to Engine bc5bd78 (agent-engine-dev#355):
 * command shape, capability, step tokens (0-based, skipped on an adopted disk),
 * result codes and plain wording.
 */
import { describe, it, expect } from 'vitest';
import {
  MAKE_BACKUP_DISK_CAPABILITY,
  MAKE_BACKUP_DISK_COMMAND,
  MAKE_BACKUP_DISK_ERROR_TEXT,
  MAKE_BACKUP_DISK_SKIPPED_ON_ADOPTED,
  MAKE_BACKUP_DISK_STEPS,
  MAKE_BACKUP_DISK_SUCCESS_MESSAGE,
  MAKE_BACKUP_DISK_SUCCESS_HINT,
  MAKE_BACKUP_DISK_EMPTY_CONFIRM,
  MAKE_BACKUP_DISK_BLANK_CONFIRM,
  MAKE_BACKUP_DISK_MIN_BYTES,
  MAKE_BACKUP_DISK_TOO_SMALL_REASON,
  MAKE_BACKUP_DISK_SIZE_NEED,
  findMakeBackupDiskOp,
  isTooSmallForBackupDisk,
  makeBackupDiskBlockedReason,
  makeBackupDiskSizeBytes,
  makeBackupDiskErrorText,
  makeBackupDiskProgress,
  makeBackupDiskStepsFor,
  parseMakeBackupDiskCode,
} from '../src/store/makeBackupDisk';
import { GENERIC_ERROR_TEXT } from '../src/store/plainError';
import { buildMakeBackupDiskCommand } from '../src/store/commands';
import type { Engine, Operation, Store } from '../src/types/store';

const op = (over: Partial<Operation> = {}): Operation => ({
  id: 'op-1',
  kind: 'makeBackupDisk',
  args: { targetId: 'CAND_1', summaryTraceId: 'tr-1', confirmName: 'INTENSO' },
  cause: 'console-command',
  subject: { type: 'disk', id: 'CAND_1' },
  engineId: 'ENGINE_1',
  status: 'Running',
  progressPercent: 0,
  currentStep: 0,
  totalSteps: 4,
  stepLabel: 'Check',
  startedAt: 1,
  completedAt: null,
  error: null,
  ...over,
} as Operation);

/** All 17 codes MakeBackupDisk.ts (bc5bd78) can return. */
const ENGINE_CODES = [
  'BAD_ARGS', 'NOT_FOUND', 'SYSTEM_DISK', 'NOT_DOCKED', 'ALREADY_BACKUP', 'BUSY', 'IN_USE',
  'SUMMARY_STALE', 'CONFIRM_MISMATCH', 'SERIAL_MISMATCH', 'TOO_SMALL', 'UNPLUGGED',
  'REDOCK_TIMEOUT', 'HIDDEN_PARTITIONS', 'OS_ROOTFS', 'INVALID_INSTANCE_ID', 'WRITE_FAILED',
];

describe('makeBackupDisk contract (engine#355 / bc5bd78)', () => {
  it('uses its own capability flag', () => {
    expect(MAKE_BACKUP_DISK_CAPABILITY).toBe('makeBackupDisk');
  });

  it('command: makeBackupDisk <targetId> [<summaryTraceId> <confirmName…>]', () => {
    expect(MAKE_BACKUP_DISK_COMMAND).toBe('makeBackupDisk');
    expect(buildMakeBackupDiskCommand('DISK_EMPTY')).toBe('makeBackupDisk DISK_EMPTY');
    expect(buildMakeBackupDiskCommand('DISK_EMPTY', null)).toBe('makeBackupDisk DISK_EMPTY');
    expect(buildMakeBackupDiskCommand('CAND_1', { summaryTraceId: 'tr-9', confirmName: 'My Stick' }))
      .toBe('makeBackupDisk CAND_1 tr-9 My Stick');
  });

  it('step tokens are exactly Check, Erase, Re-dock, Create', () => {
    expect(MAKE_BACKUP_DISK_STEPS.map((s) => s.id)).toEqual(['Check', 'Erase', 'Re-dock', 'Create']);
  });

  it('an adopted disk skips Erase and Re-dock', () => {
    expect(MAKE_BACKUP_DISK_SKIPPED_ON_ADOPTED).toEqual(['Erase', 'Re-dock']);
    expect(makeBackupDiskStepsFor(true).map((s) => s.id)).toEqual(['Check', 'Create']);
    expect(makeBackupDiskStepsFor(false).map((s) => s.id)).toEqual(['Check', 'Erase', 'Re-dock', 'Create']);
  });

  it('copy names 02:30 and every App on this Pi (Koen, engine#424); no link step, no first-backup promise', () => {
    expect(MAKE_BACKUP_DISK_EMPTY_CONFIRM).toMatch(/02:30/);
    expect(MAKE_BACKUP_DISK_EMPTY_CONFIRM).toMatch(/Nothing on this disk is erased/);
    expect(MAKE_BACKUP_DISK_BLANK_CONFIRM).toMatch(/02:30/);
    const all = `${MAKE_BACKUP_DISK_EMPTY_CONFIRM} ${MAKE_BACKUP_DISK_BLANK_CONFIRM} ${MAKE_BACKUP_DISK_SUCCESS_HINT}`;
    expect(all).not.toMatch(/link|first backup|within a minute/i);
    for (const t of [MAKE_BACKUP_DISK_EMPTY_CONFIRM, MAKE_BACKUP_DISK_BLANK_CONFIRM, MAKE_BACKUP_DISK_SUCCESS_HINT]) {
      expect(t).toMatch(/every day at 02:30 for every App on this Pi\./);
    }
    expect(MAKE_BACKUP_DISK_SUCCESS_HINT).toBe(
      'Backups run every day at 02:30 for every App on this Pi. Apps pause for a moment while a backup runs.',
    );
    expect(MAKE_BACKUP_DISK_SUCCESS_MESSAGE).toBe('This disk is now a Backup Disk.');
  });
});

describe('makeBackupDiskErrorText', () => {
  it.each(ENGINE_CODES)('%s has plain wording without codes or internals', (code) => {
    const text = makeBackupDiskErrorText(`${code}: engine detail`);
    expect(text).toBe(MAKE_BACKUP_DISK_ERROR_TEXT[code]);
    expect(text).toBeTruthy();
    expect(text).not.toMatch(/[A-Z]{3,}_[A-Z]+|borg|YAML|helper/i);
  });

  it('prefers the trace errorCode over the message', () => {
    expect(makeBackupDiskErrorText('something odd', 'UNPLUGGED')).toBe(MAKE_BACKUP_DISK_ERROR_TEXT.UNPLUGGED);
    expect(makeBackupDiskErrorText(null, 'TOO_SMALL')).toBe(MAKE_BACKUP_DISK_TOO_SMALL_REASON);
  });

  it('TOO_SMALL uses the same text as the grey-out', () => {
    expect(makeBackupDiskErrorText('TOO_SMALL: this disk is 4000000000 bytes; …')).toBe(
      'Too small: needs more than 8 GB (16 GB or more recommended)',
    );
  });

  it('INVALID_INSTANCE_ID is the generic text', () => {
    expect(makeBackupDiskErrorText('INVALID_INSTANCE_ID: x')).toBe(GENERIC_ERROR_TEXT);
  });

  it('falls back to plainEngineText for an unknown code or sentence', () => {
    expect(makeBackupDiskErrorText('The stick was unplugged.')).toBe('The stick was unplugged.');
    expect(parseMakeBackupDiskCode('NEW_CODE: later').code).toBeNull();
  });

  it('parses a leading code', () => {
    expect(parseMakeBackupDiskCode('TOO_SMALL: 4 GB min')).toEqual({ code: 'TOO_SMALL', detail: '4 GB min' });
    expect(parseMakeBackupDiskCode('no code here').code).toBeNull();
  });
});

describe('makeBackupDiskProgress', () => {
  it('maps each Engine token to its Console label', () => {
    expect(makeBackupDiskProgress(op({ stepLabel: 'Check' })).label).toBe('Checking the disk');
    expect(makeBackupDiskProgress(op({ stepLabel: 'Erase', currentStep: 1 })).currentId).toBe('Erase');
    expect(makeBackupDiskProgress(op({ stepLabel: 'Re-dock', currentStep: 2 })).label).toBe('Waiting for the disk to come back');
    expect(makeBackupDiskProgress(op({ stepLabel: 'Create', currentStep: 3, progressPercent: 75 }))).toEqual({
      currentId: 'Create', label: 'Setting up the Backup Disk', percent: 75,
    });
  });

  it('falls back to the 0-based currentStep', () => {
    expect(makeBackupDiskProgress(op({ stepLabel: null, currentStep: 0 })).currentId).toBe('Check');
    expect(makeBackupDiskProgress(op({ stepLabel: null, currentStep: 1 })).currentId).toBe('Erase');
    expect(makeBackupDiskProgress(op({ stepLabel: null, currentStep: 3 })).currentId).toBe('Create');
  });

  it('adopted disk: "(skipped)" steps move on to Create', () => {
    expect(makeBackupDiskProgress(op({ stepLabel: 'Check', currentStep: 0 }), true).currentId).toBe('Check');
    expect(makeBackupDiskProgress(op({ stepLabel: 'Erase (skipped)', currentStep: 1 }), true).currentId).toBe('Create');
    expect(makeBackupDiskProgress(op({ stepLabel: 'Re-dock (skipped)', currentStep: 2 }), true).currentId).toBe('Create');
  });

  it('nothing yet → Check', () => {
    expect(makeBackupDiskProgress(null)).toEqual({ currentId: 'Check', label: 'Checking the disk', percent: null });
  });

  it('labels never mention borg, YAML or the helper', () => {
    for (const step of MAKE_BACKUP_DISK_STEPS) expect(step.label).not.toMatch(/borg|YAML|helper/i);
  });
});

describe('findMakeBackupDiskOp', () => {
  const store = (ops: Operation[]): Store =>
    ({ operationDB: Object.fromEntries(ops.map((o) => [o.id, o])) } as unknown as Store);

  it('matches on subject id / args.targetId and prefers an active op', () => {
    const done = op({ id: 'a', status: 'Done', startedAt: 5 });
    const running = op({ id: 'b', status: 'Running', startedAt: 2 });
    expect(findMakeBackupDiskOp(store([done, running]), 'ENGINE_1', 'CAND_1')?.id).toBe('b');
  });

  it('ignores another Engine, another target and other kinds', () => {
    const other = op({ id: 'c', engineId: 'ENGINE_2' });
    const wrongTarget = op({ id: 'd', subject: { type: 'disk', id: 'X' }, args: { targetId: 'X' } });
    const erase = op({ id: 'e', kind: 'eraseDisk' as Operation['kind'] });
    expect(findMakeBackupDiskOp(store([other, wrongTarget, erase]), 'ENGINE_1', 'CAND_1')).toBeNull();
  });
});

describe('size gate (Engine MAKE_BACKUP_DISK_MIN_BYTES, bc5bd78)', () => {
  const GIB = 1024 * 1024 * 1024;
  const engine = (over: Partial<Engine> = {}): Engine => ({
    id: 'ENGINE_1',
    lastBooted: 100,
    capabilities: ['makeBackupDisk'],
    capabilitiesBootedAt: 100,
    unformattedDisks: [],
    diskCandidates: [],
    ...over,
  } as unknown as Engine);
  const storeWith = (disks: Record<string, unknown> = {}): Store =>
    ({ diskDB: disks, operationDB: {} } as unknown as Store);
  const cand = (sizeBytes: number) => ({ candidateId: 'C1', device: 'sdi', sizeBytes, model: null, fsType: null, label: 'Stick' });

  it('is exactly 8 GiB', () => {
    expect(MAKE_BACKUP_DISK_MIN_BYTES).toBe(8 * 1024 ** 3);
    expect(MAKE_BACKUP_DISK_TOO_SMALL_REASON).toBe('Too small: needs more than 8 GB (16 GB or more recommended)');
    expect(MAKE_BACKUP_DISK_SIZE_NEED).toBe('Needs a stick larger than 8 GB (16 GB or more recommended).');
    expect(MAKE_BACKUP_DISK_ERROR_TEXT.TOO_SMALL).toBe(MAKE_BACKUP_DISK_TOO_SMALL_REASON);
  });

  it('under / at / over / unknown', () => {
    expect(isTooSmallForBackupDisk(8 * GIB - 1)).toBe(true);
    expect(isTooSmallForBackupDisk(8 * GIB)).toBe(false);
    expect(isTooSmallForBackupDisk(64 * GIB)).toBe(false);
    // a stick sold as "8 GB" (8·10⁹ bytes) is under 8 GiB, so it is greyed out
    expect(isTooSmallForBackupDisk(8_000_000_000)).toBe(true);
    expect(isTooSmallForBackupDisk(null)).toBe(false);
  });

  it('reads Disk.sizeBytes for a disk docked to this Engine', () => {
    const disk = { id: 'D1', device: 'sde', dockedTo: 'ENGINE_1', sizeBytes: 4 * GIB };
    expect(makeBackupDiskSizeBytes(engine(), storeWith({ D1: disk }), 'D1')).toBe(4 * GIB);
    expect(makeBackupDiskBlockedReason(engine(), storeWith({ D1: disk }), 'D1')).toBe(MAKE_BACKUP_DISK_TOO_SMALL_REASON);
  });

  it('a disk on another Engine or without a device is not this Engine\'s size', () => {
    const elsewhere = { id: 'D1', device: 'sde', dockedTo: 'ENGINE_2', sizeBytes: 4 * GIB };
    const noDevice = { id: 'D1', device: null, dockedTo: 'ENGINE_1', sizeBytes: 4 * GIB };
    expect(makeBackupDiskSizeBytes(engine(), storeWith({ D1: elsewhere }), 'D1')).toBeNull();
    expect(makeBackupDiskSizeBytes(engine(), storeWith({ D1: noDevice }), 'D1')).toBeNull();
  });

  it('reads unformattedDisks[].sizeBytes, then an erasable usbDisk in diskCandidates', () => {
    expect(makeBackupDiskSizeBytes(engine({ unformattedDisks: [cand(2 * GIB)] }), storeWith(), 'C1')).toBe(2 * GIB);
    const dc = { candidateId: 'C1', kind: 'usbDisk', device: 'sdi', sizeBytes: 16 * GIB, actions: ['erase'] };
    expect(makeBackupDiskSizeBytes(engine({ diskCandidates: [dc] } as Partial<Engine>), storeWith(), 'C1')).toBe(16 * GIB);
    const noErase = { ...dc, actions: ['initialise'] };
    expect(makeBackupDiskSizeBytes(engine({ diskCandidates: [noErase] } as Partial<Engine>), storeWith(), 'C1')).toBeNull();
  });

  it('unknown size (null, 0, missing) is never greyed out', () => {
    expect(makeBackupDiskBlockedReason(engine({ unformattedDisks: [cand(0)] }), storeWith(), 'C1')).toBeUndefined();
    const disk = { id: 'D1', device: 'sde', dockedTo: 'ENGINE_1', sizeBytes: null };
    expect(makeBackupDiskBlockedReason(engine(), storeWith({ D1: disk }), 'D1')).toBeUndefined();
    expect(makeBackupDiskBlockedReason(engine(), storeWith(), 'NOPE')).toBeUndefined();
  });

  it('at the limit is allowed; without the capability nothing is greyed', () => {
    expect(makeBackupDiskBlockedReason(engine({ unformattedDisks: [cand(8 * GIB)] }), storeWith(), 'C1')).toBeUndefined();
    expect(makeBackupDiskBlockedReason(engine({ capabilities: [], unformattedDisks: [cand(1)] }), storeWith(), 'C1')).toBeUndefined();
  });

  it('TOO_SMALL stays mapped as a fallback', () => {
    expect(makeBackupDiskErrorText('TOO_SMALL: could not read the size')).toBe(MAKE_BACKUP_DISK_ERROR_TEXT.TOO_SMALL);
  });

  it('the success copy says apps pause while a backup runs (default method stop)', () => {
    expect(MAKE_BACKUP_DISK_SUCCESS_HINT).toMatch(/Apps pause for a moment while a backup runs\.$/);
  });
});
