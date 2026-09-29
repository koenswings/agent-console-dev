/**
 * idea#132 — role badges, canEject, Add Files eligibility, the three
 * "available in" states, Not mounted, low-space wording and the right pane.
 */
import { describe, it, expect } from 'vitest';
import {
  canAddFiles,
  canEject,
  diskBadges,
  filesAvailability,
  filesAvailabilityText,
  filesNotMountedReason,
  lowSpaceWarning,
  rightPanelFor,
} from '../src/store/diskRoles';
import { MOCK_FILES_STORE, FILES_IDS as I } from '../src/mock/filesFixtures';
import type { Disk, DiskType, Store } from '../src/types/store';

const S = MOCK_FILES_STORE;
const d = (id: string): Disk => S.diskDB[id];
const withTypes = (types: DiskType[], over: Partial<Disk> = {}): Disk => ({ ...d(I.FA_FILES), diskTypes: types, ...over });
const GB = 1_000_000_000;

describe('diskBadges — one badge per role, fixed order', () => {
  it('orders app, backup, files whatever order diskTypes has', () => {
    expect(diskBadges(withTypes(['files', 'backup', 'app']), S)).toEqual(['app', 'backup', 'files']);
    expect(diskBadges(withTypes(['files', 'app']), S)).toEqual(['app', 'files']);
    expect(diskBadges(withTypes(['backup', 'files']), S)).toEqual(['backup', 'files']);
  });
  it('combined fixtures', () => {
    expect(diskBadges(d(I.FA_APP_FILES), S)).toEqual(['app', 'files']);
    expect(diskBadges(d(I.FA_ABF), S)).toEqual(['app', 'backup', 'files']);
  });
  it("counts a disk tagged 'empty' with instances as an App Disk", () => {
    expect(diskBadges({ ...d(I.FA_APP), diskTypes: ['empty'] }, S)).toEqual(['app']);
  });
  it('falls back to empty / upgrade; system gets no badge', () => {
    const lone = { ...withTypes(['empty']), id: 'LONE' };
    expect(diskBadges(lone, S)).toEqual(['empty']);
    expect(diskBadges({ ...lone, diskTypes: ['upgrade'] }, S)).toEqual(['upgrade']);
    expect(diskBadges({ ...lone, diskTypes: ['system'] }, S)).toEqual([]);
    expect(diskBadges({ ...lone, diskTypes: [] }, S)).toEqual([]);
  });
});

describe('canEject — hidden only on a pure Backup Disk (and system / no device)', () => {
  it.each<[string, DiskType[], boolean]>([
    ['pure backup', ['backup'], false],
    ['backup + files', ['backup', 'files'], true],
    ['app + backup', ['app', 'backup'], true],
    ['app + backup + files', ['app', 'backup', 'files'], true],
    ['files', ['files'], true],
    ['app', ['app'], true],
    ['empty', ['empty'], true],
    ['system', ['system'], false],
  ])('%s → %s', (_l, types, shown) => {
    expect(canEject(withTypes(types))).toBe(shown);
  });
  it('hidden without a device', () => {
    expect(canEject(withTypes(['files'], { device: null }))).toBe(false);
  });
});

describe('canAddFiles — App/Backup Disks that are not Files Disks yet', () => {
  it.each<[string, DiskType[], boolean]>([
    ['app', ['app'], true],
    ['backup', ['backup'], true],
    ['app + backup', ['app', 'backup'], true],
    ['files', ['files'], false],
    ['app + files', ['app', 'files'], false],
    ['system', ['system'], false],
  ])('%s → %s', (_l, types, offered) => {
    expect(canAddFiles({ ...withTypes(types), id: 'NO_INSTANCES' }, S)).toBe(offered);
  });
  it('empty disk without instances → no (it gets Make this a Files Disk instead)', () => {
    expect(canAddFiles({ ...withTypes(['empty']), id: 'NO_INSTANCES' }, S)).toBe(false);
  });
});

describe('filesAvailability — the three "available in" states', () => {
  it('mounted: instances whose filesMounts contains the disk', () => {
    const a = filesAvailability(d(I.FA_FILES), S);
    expect(a).toEqual({ kind: 'mounted', instances: [{ instanceId: I.INST_NC_A, label: 'Nextcloud (nextcloud-01)' }] });
    expect(filesAvailabilityText(a)).toBe('Available in: Nextcloud (nextcloud-01)');
  });
  it('opted in but not running: an opted-in App on this Engine without the mount', () => {
    const a = filesAvailability(d(I.FB_FILES), S);
    expect(a).toEqual({ kind: 'not-running', apps: ['Nextcloud'] });
    expect(filesAvailabilityText(a)).toBe("Nextcloud supports Files Disks but isn't running");
  });
  it('none: no App on this Engine uses Files Disks', () => {
    const a = filesAvailability(d(I.FC_FILES), S);
    expect(a).toEqual({ kind: 'none' });
    expect(filesAvailabilityText(a)).toBe('No App on this Engine uses Files Disks yet');
  });
  it("another Engine's Nextcloud does not count", () => {
    const store: Store = { ...S, instanceDB: { [I.INST_NC_A]: S.instanceDB[I.INST_NC_A] } };
    expect(filesAvailability(d(I.FC_FILES), store).kind).toBe('none');
  });
});

describe('filesNotMountedReason — Not mounted', () => {
  it('password case (passwordProtected / filesConfig.error)', () => {
    expect(filesNotMountedReason(d(I.FA_PASSWORD))).toBe('password-protected Files Disks are not supported yet');
  });
  it('stuck unmount (unmountError)', () => {
    expect(filesNotMountedReason(d(I.FA_UNMOUNT))).toBe("Stuck Files couldn't be unmounted cleanly. Restart this Pi.");
  });
  it('null for a healthy Files Disk', () => {
    expect(filesNotMountedReason(d(I.FA_FILES))).toBeNull();
  });
});

describe('lowSpaceWarning — combined disks mention the Apps', () => {
  it('combined App + Files disk, low space → says the Apps need space too', () => {
    expect(lowSpaceWarning(d(I.FA_APP_FILES), S)).toBe(
      'Low space: 1.0 GB free of 32.0 GB. The Apps on this disk need space too.'
    );
  });
  it('Files-only disk, low space → plain warning', () => {
    const disk = { ...d(I.FA_FILES), sizeBytes: 32 * GB, freeBytes: 2 * GB };
    expect(lowSpaceWarning(disk, S)).toBe('Low space: 2.0 GB free of 32.0 GB.');
  });
  it('Backup + Files (no Apps) → plain warning', () => {
    const disk = { ...withTypes(['backup', 'files']), id: 'NO_INSTANCES', sizeBytes: 32 * GB, freeBytes: 1 * GB };
    expect(lowSpaceWarning(disk, S)).toBe('Low space: 1.0 GB free of 32.0 GB.');
  });
  it('null with enough space or unknown size', () => {
    expect(lowSpaceWarning(d(I.FA_ABF), S)).toBeNull();
    expect(lowSpaceWarning({ ...d(I.FA_APP_FILES), sizeBytes: null }, S)).toBeNull();
  });
});

describe('rightPanelFor — sections per role instead of one panel', () => {
  const sel = (id: string) => ({ type: 'disk' as const, id });
  it('empty disk without instances → Empty Disk panel', () => {
    const store: Store = { ...S, diskDB: { ...S.diskDB, E: { ...withTypes(['empty']), id: 'E' } } };
    expect(rightPanelFor(sel('E'), store)).toBe('empty-disk');
  });
  it('any role (incl. pure backup and combined) → disk view', () => {
    for (const id of [I.FA_FILES, I.FA_APP_FILES, I.FA_ABF, I.FA_BACKUP, I.FA_APP]) {
      expect(rightPanelFor(sel(id), S)).toBe('disk');
    }
  });
  it('network / engine selections → instances', () => {
    expect(rightPanelFor({ type: 'network', id: '' }, S)).toBe('instances');
    expect(rightPanelFor({ type: 'engine', id: I.ENGINE_A }, S)).toBe('instances');
  });
});
