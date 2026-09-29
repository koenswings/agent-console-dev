/**
 * Disk roles, eject rule, Files availability and space warnings
 * (files-disk.md §4 and §8, idea#132). Pure functions over store snapshots;
 * components wrap them in derived signals.
 */
import type { Disk, DiskType, Instance, Store } from '../types/store';
import type { Selection } from '../components/NetworkTree';

/** Role badges in their fixed order (app, backup, files). */
export const ROLE_ORDER = ['app', 'backup', 'files'] as const;
export type DiskRole = (typeof ROLE_ORDER)[number];
export type DiskBadge = DiskRole | 'empty' | 'upgrade';

const hasInstancesOn = (disk: Disk, store: Store | null): boolean =>
  !!store && Object.values(store.instanceDB ?? {}).some((i) => String(i.storedOn) === disk.id);

/**
 * One badge per role, in the fixed order app, backup, files. A disk the
 * Engine still tags 'empty' but that holds instances counts as an App Disk.
 * Without any role: 'empty' or 'upgrade' as before; 'system' has no badge.
 */
export const diskBadges = (disk: Disk, store: Store | null): DiskBadge[] => {
  const types: DiskType[] = disk.diskTypes ?? [];
  const roles: DiskRole[] = ROLE_ORDER.filter((r) =>
    types.includes(r) || (r === 'app' && hasInstancesOn(disk, store))
  );
  if (roles.length > 0) return roles;
  if (types.includes('empty')) return ['empty'];
  if (types.includes('upgrade')) return ['upgrade'];
  return [];
};

/** True for a disk with the App role (or instances on it). */
export const hasAppRole = (disk: Disk, store: Store | null): boolean =>
  (disk.diskTypes ?? []).includes('app') || hasInstancesOn(disk, store);

/** A Backup Disk with no other role (no app, no files). */
export const isPureBackupDisk = (disk: Disk): boolean => {
  const types = disk.diskTypes ?? [];
  return types.includes('backup') && !types.includes('app') && !types.includes('files');
};

/**
 * Eject is shown when the disk has a device, is not the Engine's system disk
 * (idea#152) and is not a pure Backup Disk. On combined disks it is shown;
 * the Engine refuses it while a backup is running (files-disk.md §8).
 */
export const canEject = (disk: Disk): boolean => {
  const types = disk.diskTypes ?? [];
  return disk.device !== null && !types.includes('system') && !isPureBackupDisk(disk);
};

/**
 * "Add Files to this disk" is offered on a disk with Apps or backups that
 * isn't a Files Disk yet (files-disk.md §4). Empty disks get "Make this a
 * Files Disk" in the Empty Disk panel instead.
 */
export const canAddFiles = (disk: Disk, store: Store | null): boolean => {
  const types = disk.diskTypes ?? [];
  if (types.includes('files') || types.includes('system')) return false;
  return types.includes('backup') || hasAppRole(disk, store);
};

// ---------------------------------------------------------------------------
// Files availability (three states) and Not mounted
// ---------------------------------------------------------------------------

export interface AppInstanceLabel {
  instanceId: string;
  label: string; // "Nextcloud (nextcloud-01)"
}

export type FilesAvailability =
  | { kind: 'mounted'; instances: AppInstanceLabel[] }
  | { kind: 'not-running'; apps: string[] }
  | { kind: 'none' };

const instancesOnEngine = (store: Store, engineId: string): Instance[] =>
  Object.values(store.instanceDB ?? {}).filter((i) => {
    const d = i.storedOn ? store.diskDB[i.storedOn] : undefined;
    return !!d && String(d.dockedTo) === engineId;
  });

/**
 * Where this Files Disk is available (files-disk.md §8):
 *   mounted     — instances whose filesMounts contains the disk;
 *   not-running — Apps with filesMount that have instances on this Engine,
 *                 none of which has the disk mounted;
 *   none        — no App on this Engine uses Files Disks.
 */
export const filesAvailability = (disk: Disk, store: Store | null): FilesAvailability => {
  if (!store || !disk.dockedTo) return { kind: 'none' };
  const engineId = String(disk.dockedTo);
  const onEngine = instancesOnEngine(store, engineId);
  const appTitle = (i: Instance) => store.appDB[i.instanceOf]?.title ?? i.instanceOf;

  const mounted = onEngine
    .filter((i) => (i.filesMounts ?? []).includes(disk.id))
    .map((i) => ({ instanceId: i.id, label: `${appTitle(i)} (${i.name})` }));
  if (mounted.length > 0) return { kind: 'mounted', instances: mounted };

  const optedIn = onEngine.filter((i) => !!store.appDB[i.instanceOf]?.filesMount);
  if (optedIn.length > 0) {
    return { kind: 'not-running', apps: [...new Set(optedIn.map(appTitle))] };
  }
  return { kind: 'none' };
};

/** The line shown for each availability state (files-disk.md §4). */
export const filesAvailabilityText = (a: FilesAvailability): string => {
  if (a.kind === 'mounted') return `Available in: ${a.instances.map((i) => i.label).join(', ')}`;
  if (a.kind === 'not-running') return `${a.apps.join(', ')} supports Files Disks but isn't running`;
  return 'No App on this Engine uses Files Disks yet';
};

/**
 * Why a Files Disk can't be used, or null: password-protected
 * (filesConfig.passwordProtected / error) or a stuck unmount (unmountError).
 */
export const filesNotMountedReason = (disk: Disk): string | null => {
  const cfg = disk.filesConfig;
  if (cfg?.passwordProtected || cfg?.error) {
    return cfg.error || 'password-protected Files Disks are not supported yet';
  }
  if (disk.unmountError) {
    return `${disk.name} couldn't be unmounted cleanly. Restart this Pi.`;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Size and low space
// ---------------------------------------------------------------------------

/**
 * Low space: less than this fraction of the disk is free. The proposal
 * doesn't fix a threshold (flagged in the idea#132 PR).
 */
export const LOW_SPACE_FRACTION = 0.1;

const GB = 1_000_000_000;
const MB = 1_000_000;

/** Human-readable size (decimal units, as disk vendors use). */
export const formatBytes = (n: number): string => {
  if (n >= 1000 * GB) return `${(n / (1000 * GB)).toFixed(1)} TB`;
  if (n >= GB) return `${(n / GB).toFixed(1)} GB`;
  return `${Math.round(n / MB)} MB`;
};

export const isLowSpace = (disk: Disk): boolean => {
  const size = disk.sizeBytes;
  const free = disk.freeBytes;
  if (size == null || free == null || size <= 0) return false;
  return free / size < LOW_SPACE_FRACTION;
};

/**
 * The low-space warning, or null. On a combined disk (Files and Apps) it adds
 * that the Apps on this disk need space too (files-disk.md §8; Kid, Pixel).
 */
export const lowSpaceWarning = (disk: Disk, store: Store | null): string | null => {
  if (!isLowSpace(disk)) return null;
  const base = `Low space: ${formatBytes(disk.freeBytes!)} free of ${formatBytes(disk.sizeBytes!)}.`;
  const combined = (disk.diskTypes ?? []).includes('files') && hasAppRole(disk, store);
  return combined ? `${base} The Apps on this disk need space too.` : base;
};

// ---------------------------------------------------------------------------
// Right pane for a selection
// ---------------------------------------------------------------------------

export type RightPanel = 'empty-disk' | 'disk' | 'instances';

/**
 * Which panel the right pane shows (files-disk.md §8): the Empty Disk panel
 * for an empty disk without instances, the disk view (one section per role)
 * for any other disk, and the instance list for the network or an Engine.
 * The Engine sometimes tags a disk 'empty' even after instances are
 * installed, so a disk with instances is never treated as empty.
 */
export const rightPanelFor = (selection: Selection, store: Store | null): RightPanel => {
  if (selection.type !== 'disk' || !store) return 'instances';
  const disk = store.diskDB[selection.id];
  if (!disk) return 'instances';
  const types = disk.diskTypes ?? [];
  const roles = types.filter((t) => t === 'app' || t === 'backup' || t === 'files');
  if (roles.length === 0 && types.includes('empty') && !hasInstancesOn(disk, store)) return 'empty-disk';
  return 'disk';
};
