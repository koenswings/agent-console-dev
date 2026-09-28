/**
 * idea#129 (Files Disk step 0b, Console) — per-Engine capability helper and
 * disk arguments for installApp and createBackupDisk (ejectDisk always sends
 * the disk ID and is not gated).
 *
 * Contract (Engine #128, PR pending): the Engine rewrites
 * `capabilities: ['diskIdArgs']` at every startup with
 * `capabilitiesBootedAt === lastBooted` (ms). The Console sends disk IDs only
 * when the flag is present and the stamp matches; otherwise a unique name,
 * otherwise the action is greyed out.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  UPDATE_ENGINE_TOOLTIP,
  buildCreateBackupDiskCommand,
  buildCreateFilesDiskCommand,
  buildEjectDiskCommand,
  buildInstallAppCommand,
  createBackupDisk,
  diskArgFor,
  ejectDisk,
  engineHasCapability,
  installApp,
  setSendCommandFn,
  type DiskArg,
} from '../src/store/commands';
import { MOCK_ENGINE_VARIANTS } from '../src/mock/mockStore';
import type { Disk, Engine } from '../src/types/store';

const ENGINE_ID = 'ENGINE_IDEA03';
const BOOT = 1_700_000_000_000;

const baseEngine: Engine = {
  id: ENGINE_ID,
  hostname: 'idea03',
  version: '0.0.1',
  hostOS: 'Linux',
  created: 1,
  lastBooted: BOOT,
  lastRun: BOOT + 1000,
  lastHalted: null,
  commands: [],
};

const fresh: Engine = { ...baseEngine, capabilities: ['diskIdArgs'], capabilitiesBootedAt: BOOT };
const stale: Engine = { ...baseEngine, lastBooted: BOOT + 60_000, capabilities: ['diskIdArgs'], capabilitiesBootedAt: BOOT };
const flagMissing: Engine = { ...baseEngine, capabilities: [], capabilitiesBootedAt: BOOT };
const fieldMissing: Engine = { ...baseEngine };

const disk = (id: string, name: string, over: Partial<Disk> = {}): Disk => ({
  id,
  name,
  device: 'sdb1',
  created: 1,
  lastDocked: 1,
  dockedTo: ENGINE_ID,
  diskTypes: ['empty'],
  backupConfig: null,
  ...over,
});

// idea03 system-boot case: a stale undocked record and the live disk share a name
const STALE = disk('DISK_STALE_BOOT', 'system-boot', { device: null, diskTypes: [] });
const LIVE = disk('DISK_LIVE_BOOT', 'system-boot');
const UNIQUE = disk('DISK_UNIQUE_01', 'school-disk');
const ELSEWHERE = disk('DISK_OTHER_ENGINE', 'school-disk', { dockedTo: 'ENGINE_OTHER' });

const db = (...disks: Disk[]) => Object.fromEntries(disks.map((d) => [d.id, d]));

// ---------------------------------------------------------------------------
describe('engineHasCapability — truth table', () => {
  it('flag present and fresh (stamp === lastBooted) → true', () => {
    expect(engineHasCapability(fresh, 'diskIdArgs')).toBe(true);
  });
  it('flag present but stale (stamp ≠ lastBooted, rolled back) → false', () => {
    expect(engineHasCapability(stale, 'diskIdArgs')).toBe(false);
  });
  it('flag missing from the list → false', () => {
    expect(engineHasCapability(flagMissing, 'diskIdArgs')).toBe(false);
  });
  it('capabilities field missing (pre-0b Engine) → false', () => {
    expect(engineHasCapability(fieldMissing, 'diskIdArgs')).toBe(false);
  });
  it('stamp missing while the flag is present → false', () => {
    expect(engineHasCapability({ ...fresh, capabilitiesBootedAt: undefined }, 'diskIdArgs')).toBe(false);
  });
  it('no Engine record → false', () => {
    expect(engineHasCapability(undefined, 'diskIdArgs')).toBe(false);
    expect(engineHasCapability(null, 'diskIdArgs')).toBe(false);
  });
  it('is generic: checks the named flag only', () => {
    expect(engineHasCapability(fresh, 'filesDisk')).toBe(false);
    const withFiles: Engine = { ...fresh, capabilities: ['diskIdArgs', 'filesDisk'] };
    expect(engineHasCapability(withFiles, 'filesDisk')).toBe(true);
    expect(engineHasCapability({ ...withFiles, lastBooted: BOOT + 1 }, 'filesDisk')).toBe(false);
  });
  it('mock store variants: current / old / rolledBack', () => {
    expect(engineHasCapability(MOCK_ENGINE_VARIANTS.current, 'diskIdArgs')).toBe(true);
    expect(engineHasCapability(MOCK_ENGINE_VARIANTS.old, 'diskIdArgs')).toBe(false);
    expect(engineHasCapability(MOCK_ENGINE_VARIANTS.rolledBack, 'diskIdArgs')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('diskArgFor — one test per path', () => {
  it('flag present with a matching stamp → disk ID (even when the name is shared)', () => {
    expect(diskArgFor(fresh, LIVE, db(STALE, LIVE))).toEqual({ ok: true, arg: LIVE.id, byId: true });
  });
  it('capabilities missing → unique name', () => {
    expect(diskArgFor(fieldMissing, UNIQUE, db(UNIQUE))).toEqual({ ok: true, arg: 'school-disk', byId: false });
  });
  it('flag present but stamp mismatch (rolled back) → unique name', () => {
    expect(diskArgFor(stale, UNIQUE, db(UNIQUE))).toEqual({ ok: true, arg: 'school-disk', byId: false });
  });
  it('ambiguous name on an old Engine → greyed out with the update message', () => {
    expect(diskArgFor(fieldMissing, LIVE, db(STALE, LIVE))).toEqual({ ok: false, reason: UPDATE_ENGINE_TOOLTIP });
    expect(diskArgFor(stale, LIVE, db(STALE, LIVE))).toEqual({ ok: false, reason: UPDATE_ENGINE_TOOLTIP });
    expect(UPDATE_ENGINE_TOOLTIP).toBe('Update this Engine to manage this disk');
  });
  it('a same-name disk docked to another Engine does not make the name ambiguous', () => {
    expect(diskArgFor(fieldMissing, UNIQUE, db(UNIQUE, ELSEWHERE))).toEqual({ ok: true, arg: 'school-disk', byId: false });
  });
});

// ---------------------------------------------------------------------------
// Each command: ID when the flag is on, unique name when off, greyed out
// (nothing sent) when the name is ambiguous. Strings pinned per §7.6.
// ---------------------------------------------------------------------------
const send = (arg: DiskArg, fn: (a: string) => void): boolean => {
  if (!arg.ok) return false;
  fn(arg.arg);
  return true;
};

describe('command strings by disk argument (idea#129, §7.6)', () => {
  let sent: ReturnType<typeof vi.fn>;
  beforeEach(() => { sent = vi.fn(); setSendCommandFn(sent); });

  describe('installApp <appId> <targetDiskId> [--source <sourceDiskId>] [--name <instanceName>]', () => {
    it('pins the ID string with --source and --name', () => {
      expect(buildInstallAppCommand('kolibri', 'DISK_T', { source: 'DISK_S', name: 'my-kolibri' }))
        .toBe('installApp kolibri DISK_T --source DISK_S --name my-kolibri');
    });
    it('flag on → sends the target disk ID', () => {
      expect(send(diskArgFor(fresh, LIVE, db(STALE, LIVE)), (a) => installApp(ENGINE_ID, 'kolibri', a))).toBe(true);
      expect(sent).toHaveBeenCalledWith(ENGINE_ID, `installApp kolibri ${LIVE.id}`);
    });
    it('flag off → sends the unique name', () => {
      send(diskArgFor(stale, UNIQUE, db(UNIQUE)), (a) => installApp(ENGINE_ID, 'kolibri', a));
      expect(sent).toHaveBeenCalledWith(ENGINE_ID, 'installApp kolibri school-disk');
    });
    it('ambiguous name on an old Engine → greyed out, nothing sent', () => {
      expect(send(diskArgFor(fieldMissing, LIVE, db(STALE, LIVE)), (a) => installApp(ENGINE_ID, 'kolibri', a))).toBe(false);
      expect(sent).not.toHaveBeenCalled();
    });
  });

  describe('createBackupDisk <diskId> <mode> <instanceName…>', () => {
    it('pins the ID string, instance names last', () => {
      expect(buildCreateBackupDiskCommand('DISK_B', 'on-demand', ['kolibri', 'nextcloud']))
        .toBe('createBackupDisk DISK_B on-demand kolibri nextcloud');
    });
    it('flag on → sends the disk ID', () => {
      send(diskArgFor(fresh, LIVE, db(STALE, LIVE)), (a) => createBackupDisk(ENGINE_ID, a, 'immediate', ['kolibri']));
      expect(sent).toHaveBeenCalledWith(ENGINE_ID, `createBackupDisk ${LIVE.id} immediate kolibri`);
    });
    it('flag off → sends the unique name', () => {
      send(diskArgFor(fieldMissing, UNIQUE, db(UNIQUE)), (a) => createBackupDisk(ENGINE_ID, a, 'immediate', ['kolibri']));
      expect(sent).toHaveBeenCalledWith(ENGINE_ID, 'createBackupDisk school-disk immediate kolibri');
    });
    it('ambiguous name on an old Engine → greyed out, nothing sent', () => {
      expect(send(diskArgFor(stale, LIVE, db(STALE, LIVE)), (a) => createBackupDisk(ENGINE_ID, a, 'immediate', ['kolibri']))).toBe(false);
      expect(sent).not.toHaveBeenCalled();
    });
  });

  describe('ejectDisk <diskId> — not gated (Lead decision on idea#129)', () => {
    it('pins the ID string', () => {
      expect(buildEjectDiskCommand('DISK_E')).toBe('ejectDisk DISK_E');
    });
    it('sends the disk ID whatever the Engine advertises', () => {
      ejectDisk(ENGINE_ID, LIVE.id);
      expect(sent).toHaveBeenCalledWith(ENGINE_ID, `ejectDisk ${LIVE.id}`);
    });
  });

  it('createFilesDisk <diskId> — ID only', () => {
    expect(buildCreateFilesDiskCommand('DISK_F')).toBe('createFilesDisk DISK_F');
  });
});
