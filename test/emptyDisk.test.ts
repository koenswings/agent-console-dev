
import { describe, it, expect } from 'vitest';
import {
  resolveEmptyDiskIdPreference,
  SUGGESTED_EMPTY_DISK_ID,
} from '../e2e/intents/emptyDisk';
import { DURATION_FIXTURES } from '../e2e/intents/fixtures';

describe('resolveEmptyDiskIdPreference (Prefer A EmptyDiskPanel)', () => {
  it('defaults to suggested duration-empty-001', () => {
    expect(resolveEmptyDiskIdPreference({}, {})).toBe(SUGGESTED_EMPTY_DISK_ID);
    expect(DURATION_FIXTURES.empty.diskId).toBe('duration-empty-001');
  });

  it('DURATION_EMPTY_DISK_ID wins over ctx', () => {
    expect(
      resolveEmptyDiskIdPreference(
        { diskId: 'ctx-disk' },
        { DURATION_EMPTY_DISK_ID: 'fleet-empty-usb' },
      ),
    ).toBe('fleet-empty-usb');
  });

  it('ctx diskId used when env unset', () => {
    expect(resolveEmptyDiskIdPreference({ diskId: 'ctx-empty' }, {})).toBe('ctx-empty');
  });
});
