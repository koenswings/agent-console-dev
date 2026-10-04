import { describe, it, expect } from 'vitest';
import { buildInstallAppCommand } from '../src/store/commands';
import {
  lessonInstallForDisk,
  lessonInstanceStoredOnDisk,
} from '../src/store/lessonInstall';

describe('lessonInstallForDisk', () => {
  it('matches both lesson disks by id and by name', () => {
    expect(lessonInstallForDisk({ id: 'duration-kolibri-grade5a-001', name: 'other' })).toEqual({
      appId: 'kolibri-1.0',
      instanceName: 'kolibri-grade5a-001',
      version: '1.0',
    });
    expect(lessonInstallForDisk({ id: 'disk-uuid', name: 'duration-kolibri-grade5a-001' })?.instanceName)
      .toBe('kolibri-grade5a-001');
    expect(lessonInstallForDisk({ id: 'duration-kolibri-form3-001', name: 'Form 3' })).toEqual({
      appId: 'kolibri-1.0',
      instanceName: 'kolibri-form3-001',
      version: '1.0',
    });
    expect(lessonInstallForDisk({ id: 'x', name: 'duration-kolibri-form3-001' })?.instanceName)
      .toBe('kolibri-form3-001');
  });

  it('returns null for an unrelated disk', () => {
    expect(lessonInstallForDisk({ id: 'DISK001', name: 'kolibri' })).toBeNull();
    expect(lessonInstallForDisk({ id: 'duration-nextcloud-grade5a-001', name: 'nc' })).toBeNull();
  });
});

describe('lessonInstanceStoredOnDisk', () => {
  it('is true only when that name is stored on this disk id', () => {
    const instances = {
      a: { name: 'kolibri-grade5a-001', storedOn: 'duration-kolibri-grade5a-001' },
      b: { name: 'kolibri-grade5a-001', storedOn: 'other-disk' },
      c: { name: 'other', storedOn: 'duration-kolibri-grade5a-001' },
    };
    expect(lessonInstanceStoredOnDisk(instances, 'duration-kolibri-grade5a-001', 'kolibri-grade5a-001')).toBe(true);
    expect(lessonInstanceStoredOnDisk(instances, 'duration-kolibri-form3-001', 'kolibri-form3-001')).toBe(false);
    expect(lessonInstanceStoredOnDisk({}, 'duration-kolibri-grade5a-001', 'kolibri-grade5a-001')).toBe(false);
  });
});

describe('lesson installApp command (no --source)', () => {
  it('names the grade5a and form3 instances and omits --source', () => {
    const g5 = lessonInstallForDisk({ id: 'duration-kolibri-grade5a-001', name: 'duration-kolibri-grade5a-001' })!;
    const f3 = lessonInstallForDisk({ id: 'duration-kolibri-form3-001', name: 'duration-kolibri-form3-001' })!;
    const g5cmd = buildInstallAppCommand(g5.appId, 'duration-kolibri-grade5a-001', { name: g5.instanceName });
    const f3cmd = buildInstallAppCommand(f3.appId, 'duration-kolibri-form3-001', { name: f3.instanceName });
    expect(g5cmd).toBe('installApp kolibri-1.0 duration-kolibri-grade5a-001 --name kolibri-grade5a-001');
    expect(f3cmd).toBe('installApp kolibri-1.0 duration-kolibri-form3-001 --name kolibri-form3-001');
    expect(g5cmd).not.toContain('--source');
    expect(f3cmd).not.toContain('--source');
  });
});
