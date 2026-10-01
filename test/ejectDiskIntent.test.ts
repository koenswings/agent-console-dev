
import { describe, it, expect } from 'vitest';
import { resolveEjectDiskId } from '../e2e/intents/operatorActions';
import { DURATION_FIXTURES } from '../e2e/intents/fixtures';

describe('resolveEjectDiskId (preference only — tree pick is separate)', () => {
  it('defaults to duration-kolibri disk preference', () => {
    expect(resolveEjectDiskId(undefined, {})).toBe(DURATION_FIXTURES.kolibri.diskId);
  });

  it('prefers ctx diskId over default', () => {
    expect(resolveEjectDiskId(DURATION_FIXTURES.nextcloud.diskId, {})).toBe(
      DURATION_FIXTURES.nextcloud.diskId,
    );
  });

  it('DURATION_EJECT_DISK_ID wins', () => {
    expect(
      resolveEjectDiskId(DURATION_FIXTURES.kolibri.diskId, {
        DURATION_EJECT_DISK_ID: 'custom-disk',
      }),
    ).toBe('custom-disk');
  });
});
