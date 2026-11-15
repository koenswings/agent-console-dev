import { describe, it, expect } from 'vitest';
import { sel } from '../e2e/intents/selectors';
import {
  backupDiskSizeBlockError,
  sizeGateDecision,
} from '../e2e/intents/backupDisk';

describe('make_backup_disk size gate (console#220)', () => {
  it('selectors target the block and warn banners once', () => {
    expect(sel.backupDiskSizeBlock).toBe('[data-testid="backup-disk-size-block"]');
    expect(sel.backupDiskSizeWarn).toBe('[data-testid="backup-disk-size-warn"]');
    const keys = Object.keys(sel);
    expect(keys.filter((k) => k === 'backupDiskSizeBlock')).toHaveLength(1);
    expect(keys.filter((k) => k === 'backupDiskSizeWarn')).toHaveLength(1);
  });

  it('fails immediately with the gate text when the block banner is visible', () => {
    const err = backupDiskSizeBlockError(
      'make_backup_disk',
      'Too small: needs more than 8 GB. Choose a disk larger than all the App data on this Pi.',
    );
    expect(err.message).toContain('console#220');
    expect(err.message).toContain('Too small: needs more than 8 GB');
    expect(err.message).toContain('No soft-pass');
    expect(err.message).toContain('make_backup_disk');

    const decision = sizeGateDecision(
      { blocked: 'This disk is too small for the Apps you chose.', warn: null },
      'make_backup_disk',
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) throw new Error('expected a block');
    expect(decision.error.message).toContain('This disk is too small for the Apps you chose.');
  });

  it('does not fail on a visible size-warn; returns it as a note without logging', () => {
    const decision = sizeGateDecision(
      { blocked: null, warn: 'This disk is close to the size of this Pi’s Apps.' },
      'make_backup_disk',
    );
    expect(decision.ok).toBe(true);
    if (!decision.ok) throw new Error('warn must not block');
    expect(decision.warn).toContain('close to the size');
  });

  it('allows Configure when neither banner is visible', () => {
    expect(sizeGateDecision({ blocked: null, warn: null }, 'make_backup_disk')).toEqual({
      ok: true,
    });
  });
});
