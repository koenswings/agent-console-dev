/**
 * idea#157 — eject impact on combined disks, the stuck-unmount warning lookup
 * and the "running but not yet recreated with the Files mount" wording.
 */
import { describe, it, expect } from 'vitest';
import {
  ejectImpact,
  filesAvailability,
  filesAvailabilityText,
  filesNotMountedReason,
  isCombinedDisk,
  rolesSentence,
  unmountWarningDiskIds,
  unmountWarningText,
} from '../src/store/diskRoles';
import { MOCK_FILES_STORE, FILES_IDS as I } from '../src/mock/filesFixtures';
import type { Disk, Instance, Store } from '../src/types/store';

const S = MOCK_FILES_STORE;
const d = (id: string): Disk => S.diskDB[id];
const texts = (items: { text: string }[]) => items.map((x) => x.text);
const withInstance = (s: Store, id: string, patch: Partial<Instance>): Store => ({
  ...s,
  instanceDB: { ...s.instanceDB, [id]: { ...s.instanceDB[id], ...patch } },
});

describe('isCombinedDisk', () => {
  it('is true for two or more roles', () => {
    expect(isCombinedDisk(d(I.FA_ABF), S)).toBe(true);
    expect(isCombinedDisk(d(I.FA_APP_FILES), S)).toBe(true);
  });
  it('is false for a single role or no role', () => {
    expect(isCombinedDisk(d(I.FA_FILES), S)).toBe(false);
    expect(isCombinedDisk(d(I.FA_APP), S)).toBe(false);
    expect(isCombinedDisk(d(I.FA_BACKUP), S)).toBe(false);
    expect(isCombinedDisk(d(I.FA_GONE), S)).toBe(false);
  });
});

describe('rolesSentence', () => {
  it('joins roles with articles', () => {
    expect(rolesSentence(['app', 'backup', 'files'])).toBe('an App Disk, a Backup Disk and a Files Disk');
    expect(rolesSentence(['app', 'files'])).toBe('an App Disk and a Files Disk');
    expect(rolesSentence(['backup'])).toBe('a Backup Disk');
    expect(rolesSentence([])).toBe('');
  });
});

describe('ejectImpact', () => {
  it('App + Backup + Files: instances stop, Apps lose files, backups become unavailable', () => {
    const imp = ejectImpact(d(I.FA_ABF), S);
    expect(imp.roles).toEqual(['app', 'backup', 'files']);
    expect(texts(imp.stopping)).toEqual(['Kolibri (wiki-01)']);
    expect(texts(imp.losingFiles)).toEqual(['Nextcloud (nextcloud-01) loses Shared']);
    expect(texts(imp.unavailableBackups)).toEqual(['Kolibri (kolibri-01)']);
    expect(imp.stopping.map((x) => x.id)).toEqual([I.INST_WIKI_A]);
    expect(imp.losingFiles.map((x) => x.id)).toEqual([I.INST_NC_A]);
    expect(imp.unavailableBackups.map((x) => x.id)).toEqual([I.INST_KOLIBRI_A]);
  });

  it('App + Files: the instance on the disk is listed once, under stopping', () => {
    const imp = ejectImpact(d(I.FA_APP_FILES), S);
    expect(imp.roles).toEqual(['app', 'files']);
    expect(texts(imp.stopping)).toEqual(['Nextcloud (nextcloud-01)']);
    expect(imp.losingFiles).toEqual([]);
    expect(imp.unavailableBackups).toEqual([]);
  });

  it('uses the share name for the lost files', () => {
    const imp = ejectImpact(d(I.FA_FILES), S);
    expect(texts(imp.losingFiles)).toEqual(['Nextcloud (nextcloud-01) loses School Files']);
    expect(imp.stopping).toEqual([]);
  });

  it('falls back to the disk name when there is no share name', () => {
    const disk = { ...d(I.FA_FILES), filesConfig: null };
    expect(texts(ejectImpact(disk, S).losingFiles)).toEqual([`Nextcloud (nextcloud-01) loses ${disk.name}`]);
  });

  it('lists no backups when the disk is not a Backup Disk', () => {
    const disk = { ...d(I.FA_ABF), diskTypes: ['app', 'files'] as Disk['diskTypes'] };
    expect(ejectImpact(disk, S).unavailableBackups).toEqual([]);
  });

  it('handles a null store', () => {
    const imp = ejectImpact(d(I.FA_ABF), null);
    expect(imp.stopping).toEqual([]);
    expect(imp.losingFiles).toEqual([]);
    expect(imp.unavailableBackups.map((x) => x.id)).toEqual([I.INST_KOLIBRI_A]);
  });
});

describe('unmountWarningDiskIds / unmountWarningText', () => {
  it('finds stuck unmounts by unmountError.engineId, including an undocked disk', () => {
    expect(unmountWarningDiskIds(S, I.ENGINE_A).sort()).toEqual([I.FA_GONE, I.FA_UNMOUNT].sort());
  });
  it('does not list another Engine’s disks', () => {
    expect(unmountWarningDiskIds(S, I.ENGINE_B)).toEqual([]);
    expect(unmountWarningDiskIds(null, I.ENGINE_A)).toEqual([]);
  });
  it('uses the §4 wording and Not mounted reuses it', () => {
    expect(unmountWarningText(d(I.FA_UNMOUNT))).toBe("Stuck Files couldn't be unmounted cleanly. Restart this Pi.");
    expect(filesNotMountedReason(d(I.FA_UNMOUNT))).toBe(unmountWarningText(d(I.FA_UNMOUNT)));
  });
});

describe("Files availability — running but not yet recreated (idea#157)", () => {
  it('a Running opted-in instance without the mount gets the "doesn\'t show these files yet" line', () => {
    const a = filesAvailability(d(I.FD_FILES), S);
    expect(a).toEqual({ kind: 'not-yet-mounted', instances: [{ instanceId: I.INST_NC_D, label: 'Nextcloud (nextcloud-04)' }] });
    expect(filesAvailabilityText(a)).toBe(
      "Nextcloud (nextcloud-04) is running but doesn't show these files yet. They appear after it restarts.",
    );
  });
  it('a stopped opted-in instance keeps "isn\'t running"', () => {
    const stopped = withInstance(S, I.INST_NC_D, { status: 'Stopped' });
    expect(filesAvailabilityText(filesAvailability(d(I.FD_FILES), stopped))).toBe(
      "Nextcloud supports Files Disks but isn't running",
    );
    expect(filesAvailability(d(I.FB_FILES), S).kind).toBe('not-running');
  });
  it('mounted still wins over not-yet-mounted', () => {
    const mounted = withInstance(S, I.INST_NC_D, { filesMounts: [I.FD_FILES] });
    expect(filesAvailabilityText(filesAvailability(d(I.FD_FILES), mounted))).toBe('Available in: Nextcloud (nextcloud-04)');
  });
});
