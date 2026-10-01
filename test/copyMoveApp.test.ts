import { describe, it, expect } from 'vitest';
import {
  resolveCopyMovePair,
  pickTargetDiskId,
} from '../e2e/intents/copyMoveApp';
import { DURATION_FIXTURES } from '../e2e/intents/fixtures';

describe('resolveCopyMovePair (idea#168 multi-disk copy)', () => {
  it('defaults: kolibri disk+instance → nextcloud disk (copy)', () => {
    const p = resolveCopyMovePair({}, 'copy', {});
    expect(p.sourceDiskId).toBe(DURATION_FIXTURES.kolibri.diskId);
    expect(p.targetDiskId).toBe(DURATION_FIXTURES.nextcloud.diskId);
    expect(p.instanceId).toBe(DURATION_FIXTURES.kolibri.instanceId);
    expect(p.op).toBe('copy');
  });

  it('when source is nextcloud, target flips to kolibri', () => {
    const p = resolveCopyMovePair(
      { diskId: DURATION_FIXTURES.nextcloud.diskId },
      'move',
      {},
    );
    expect(p.sourceDiskId).toBe(DURATION_FIXTURES.nextcloud.diskId);
    expect(p.targetDiskId).toBe(DURATION_FIXTURES.kolibri.diskId);
    expect(p.instanceId).toBe(DURATION_FIXTURES.nextcloud.instanceId);
    expect(p.op).toBe('move');
  });

  it('env overrides win', () => {
    const p = resolveCopyMovePair(
      {},
      'copy',
      {
        DURATION_COPY_SOURCE_DISK: 'disk-a',
        DURATION_COPY_TARGET_DISK: 'disk-b',
        DURATION_COPY_INSTANCE_ID: 'inst-a',
      },
    );
    expect(p).toEqual({
      sourceDiskId: 'disk-a',
      targetDiskId: 'disk-b',
      instanceId: 'inst-a',
      op: 'copy',
    });
  });
});

describe('pickTargetDiskId (Prefer A r34 after move)', () => {
  const kolibri = DURATION_FIXTURES.kolibri.diskId;
  const nextcloud = DURATION_FIXTURES.nextcloud.diskId;
  const empty = DURATION_FIXTURES.empty.diskId;

  it('after move onto nextcloud, picks kolibri (≠ source)', () => {
    expect(pickTargetDiskId(nextcloud, [nextcloud, kolibri, empty])).toBe(kolibri);
  });

  it('when source is kolibri, prefers nextcloud', () => {
    expect(pickTargetDiskId(kolibri, [kolibri, nextcloud])).toBe(nextcloud);
  });

  it('returns null if only same-disk remains', () => {
    expect(pickTargetDiskId(nextcloud, [nextcloud])).toBeNull();
  });

  it('skips system-ish ids', () => {
    expect(pickTargetDiskId(nextcloud, [nextcloud, 'system-boot'])).toBeNull();
  });
});
