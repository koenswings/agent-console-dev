/**
 * idea#404 — makeBackupDisk helpers: agreed command, flag, step tokens and
 * plain failure wording (Steve / idea#400).
 */
import { describe, it, expect } from 'vitest';
import {
  MAKE_BACKUP_DISK_CAPABILITY,
  MAKE_BACKUP_DISK_COMMAND,
  MAKE_BACKUP_DISK_ERROR_TEXT,
  MAKE_BACKUP_DISK_SKIP_ERASE_ON_ADOPTED,
  MAKE_BACKUP_DISK_STEPS,
  MAKE_BACKUP_DISK_SUCCESS_MESSAGE,
  buildMakeBackupDiskCommand,
  makeBackupDiskErrorText,
  makeBackupDiskProgress,
  makeBackupDiskStepsFor,
  parseMakeBackupDiskCode,
} from '../src/store/makeBackupDisk';
import { GENERIC_ERROR_TEXT } from '../src/store/plainError';
import { buildMakeBackupDiskCommand as buildFromCommands } from '../src/store/commands';
import type { Operation } from '../src/types/store';

const op = (over: Partial<Operation> = {}): Operation => ({
  id: 'op-1',
  kind: 'makeBackupDisk',
  args: { diskId: 'DISK_1' },
  cause: 'console-command',
  subject: { type: 'disk', id: 'DISK_1' },
  engineId: 'ENGINE_1',
  status: 'Running',
  progressPercent: 25,
  currentStep: 1,
  totalSteps: 4,
  stepLabel: 'Check',
  startedAt: 1,
  completedAt: null,
  error: null,
  ...over,
});

describe('agreed makeBackupDisk names (idea#400 / Steve)', () => {
  it('uses its own capability flag, not scheduledBackups', () => {
    expect(MAKE_BACKUP_DISK_CAPABILITY).toBe('makeBackupDisk');
    expect(MAKE_BACKUP_DISK_CAPABILITY).not.toBe('scheduledBackups');
  });

  it('command and operation kind are makeBackupDisk <diskOrCandidateId>', () => {
    expect(MAKE_BACKUP_DISK_COMMAND).toBe('makeBackupDisk');
    expect(buildMakeBackupDiskCommand('CAND_1')).toBe('makeBackupDisk CAND_1');
    expect(buildFromCommands('DISK_1')).toBe('makeBackupDisk DISK_1');
  });

  it('step tokens are exactly Check, Erase, Re-dock, Create, with plain Console labels', () => {
    expect(MAKE_BACKUP_DISK_STEPS.map((s) => s.id)).toEqual(['Check', 'Erase', 'Re-dock', 'Create']);
    expect(MAKE_BACKUP_DISK_STEPS.map((s) => s.label)).toEqual([
      'Checking the stick',
      'Erasing the disk',
      'Waiting for the disk to come back',
      'Setting up the Backup Disk',
    ]);
  });

  it('skips the Erase step on an adopted empty IDEA stick', () => {
    expect(MAKE_BACKUP_DISK_SKIP_ERASE_ON_ADOPTED).toBe('Erase');
    expect(makeBackupDiskStepsFor(true).map((s) => s.id)).toEqual(['Check', 'Re-dock', 'Create']);
    expect(makeBackupDiskStepsFor(false).map((s) => s.id)).toEqual(['Check', 'Erase', 'Re-dock', 'Create']);
  });
});

describe('makeBackupDiskErrorText', () => {
  it.each([
    ['TOO_SMALL: 2 GB', 'This stick is too small to be a Backup Disk'],
    ['TOO_SMALL', 'This stick is too small to be a Backup Disk'],
    ['NOT_DOCKED: undocked', 'This disk is not plugged into this Pi.'],
    ['SYSTEM_DISK: root', "This is the Pi's own system disk, so it cannot be a Backup Disk."],
    ['NOT_EMPTY: has files', 'This disk is not empty, so it cannot be prepared as a Backup Disk this way.'],
    ['UNKNOWN: explode', GENERIC_ERROR_TEXT],
    ['BUSY: wait', 'Another operation is running on this Pi. Wait for it to finish.'],
  ] as const)('%s → plain wording, no code', (raw, expected) => {
    expect(makeBackupDiskErrorText(raw)).toBe(expected);
    expect(makeBackupDiskErrorText(raw)).not.toMatch(/TOO_SMALL|NOT_DOCKED|SYSTEM_DISK|NOT_EMPTY|UNKNOWN|BUSY/);
    expect(makeBackupDiskErrorText(raw)).not.toMatch(/borg|YAML|helper/i);
  });

  it('falls back to plainEngineText for an unknown sentence', () => {
    expect(makeBackupDiskErrorText('The stick was unplugged.')).toBe('The stick was unplugged.');
  });

  it('parses a leading code', () => {
    expect(parseMakeBackupDiskCode('TOO_SMALL: 4 GB min')).toEqual({ code: 'TOO_SMALL', detail: '4 GB min' });
    expect(parseMakeBackupDiskCode('no code here').code).toBeNull();
  });
});

describe('makeBackupDiskProgress', () => {
  it('maps Engine tokens to Console labels', () => {
    expect(makeBackupDiskProgress(op({ stepLabel: 'Check' })).label).toBe('Checking the stick');
    expect(makeBackupDiskProgress(op({ stepLabel: 'Erase' })).currentId).toBe('Erase');
    expect(makeBackupDiskProgress(op({ stepLabel: 'Erase' })).label).toBe('Erasing the disk');
    expect(makeBackupDiskProgress(op({ stepLabel: 'Re-dock' })).label).toBe('Waiting for the disk to come back');
    expect(makeBackupDiskProgress(op({ stepLabel: 'Create', progressPercent: 90 })).label).toBe(
      'Setting up the Backup Disk',
    );
  });

  it('does not mention borg or YAML in any label', () => {
    for (const step of MAKE_BACKUP_DISK_STEPS) {
      expect(step.label).not.toMatch(/borg|YAML|helper/i);
    }
  });
});

describe('MAKE_BACKUP_DISK_ERROR_TEXT coverage', () => {
  it('has wording for every agreed failure code', () => {
    for (const code of ['TOO_SMALL', 'NOT_DOCKED', 'SYSTEM_DISK', 'NOT_EMPTY', 'UNKNOWN']) {
      expect(MAKE_BACKUP_DISK_ERROR_TEXT[code]).toBeTruthy();
    }
    expect(MAKE_BACKUP_DISK_SUCCESS_MESSAGE).toBe('This disk is now a Backup Disk.');
  });
});
