/**
 * Command helpers — write command strings to the engine's commands[] array
 * via the active store connection.
 *
 * Command string format mirrors the Engine's commandUtils.ts sendCommand pattern:
 *   "<commandName> <arg1> <arg2>"
 *
 * The Engine processes these strings from engine.commands[] via its command loop.
 */
import type { Disk, Engine } from '../types/store';

// ---------------------------------------------------------------------------
// Module-level sendCommand fn — set by App.tsx after connection is initialised
// ---------------------------------------------------------------------------
let _sendCommand: (engineId: string, command: string) => void = (e, c) => {
  console.warn(`[commands] No connection — command dropped: '${c}' → engine '${e}'`);
};

export function setSendCommandFn(fn: (engineId: string, command: string) => void): void {
  _sendCommand = fn;
}

/** Access the raw sendCommand for testing purposes. */
export function getSendCommandFn(): (engineId: string, command: string) => void {
  return _sendCommand;
}

// ---------------------------------------------------------------------------
// Per-Engine capabilities and disk arguments (Files Disk step 0b, idea#129)
// ---------------------------------------------------------------------------

/** Capability flags the Console knows about (written by the Engine, idea#128). */
export type EngineCapability = 'diskIdArgs' | 'filesDisk';

/** Tooltip for an action an old Engine can't be sent safely. */
export const UPDATE_ENGINE_TOOLTIP = 'Update this Engine to manage this disk';

/**
 * True when `engine` advertises `flag` for its current boot: the flag is in
 * `capabilities` and `capabilitiesBootedAt === lastBooted`. A rolled-back
 * Engine rewrites `lastBooted` but not the stamp, so it counts as old.
 * Always evaluate against the target Engine (the disk's `dockedTo`).
 */
export const engineHasCapability = (
  engine: Engine | null | undefined,
  flag: EngineCapability
): boolean =>
  !!engine
  && engine.capabilities?.includes(flag) === true
  && engine.capabilitiesBootedAt === engine.lastBooted;

/** Result of choosing a disk argument: send `arg`, or grey the action out. */
export type DiskArg =
  | { ok: true; arg: string; byId: boolean }
  | { ok: false; reason: string };

/**
 * Chooses the disk argument for `installApp` and `createBackupDisk` on the
 * target Engine (idea#129). `ejectDisk` always sends the disk ID instead.
 *   - Engine has 'diskIdArgs' for this boot → the disk ID;
 *   - otherwise the disk name, only if no other disk docked to that Engine
 *     has it (the Engine's name lookup would be ambiguous);
 *   - otherwise not ok, with UPDATE_ENGINE_TOOLTIP as the reason.
 */
export const diskArgFor = (
  engine: Engine | null | undefined,
  disk: Disk,
  diskDB: Record<string, Disk> | null | undefined
): DiskArg => {
  if (engineHasCapability(engine, 'diskIdArgs')) return { ok: true, arg: disk.id, byId: true };
  const engineId = engine?.id ?? disk.dockedTo;
  const sameName = Object.values(diskDB ?? {}).filter(
    (d) => d.name === disk.name && String(d.dockedTo) === String(engineId)
  );
  const unique = sameName.length === 0 || (sameName.length === 1 && sameName[0].id === disk.id);
  if (unique) return { ok: true, arg: disk.name, byId: false };
  return { ok: false, reason: UPDATE_ENGINE_TOOLTIP };
};

// ---------------------------------------------------------------------------
// Exported command builders
// ---------------------------------------------------------------------------

/**
 * Build the "startInstance" command string (pure, no side effects).
 * Format: "startInstance <instanceName> <diskName>"
 */
export const buildStartInstanceCommand = (instanceName: string, diskName: string): string =>
  `startInstance ${instanceName} ${diskName}`;

/**
 * Build the "stopInstance" command string (pure, no side effects).
 * Format: "stopInstance <instanceName> <diskName>"
 */
export const buildStopInstanceCommand = (instanceName: string, diskName: string): string =>
  `stopInstance ${instanceName} ${diskName}`;

/**
 * Build the "ejectDisk" command string (pure, no side effects).
 * Format: "ejectDisk <diskId>"
 *
 * Sends the disk ID, not the display name: names are not unique (a stale
 * undocked record can share a name with the docked disk — idea#152).
 * Always the ID, on every Engine — not gated by 'diskIdArgs' (idea#129):
 * an Engine that can't resolve it refuses, so eject fails safe.
 */
export const buildEjectDiskCommand = (diskId: string): string =>
  `ejectDisk ${diskId}`;

// ---------------------------------------------------------------------------
// Dispatching commands
// ---------------------------------------------------------------------------

/** Start a named instance on a named disk, addressed to the given engine. */
export const startInstance = (
  engineId: string,
  instanceName: string,
  diskName: string
): void => {
  _sendCommand(engineId, buildStartInstanceCommand(instanceName, diskName));
};

/** Stop a named instance on a named disk, addressed to the given engine. */
export const stopInstance = (
  engineId: string,
  instanceName: string,
  diskName: string
): void => {
  _sendCommand(engineId, buildStopInstanceCommand(instanceName, diskName));
};

/** Eject a disk (by disk ID) from the given engine. */
export const ejectDisk = (engineId: string, diskId: string): void => {
  _sendCommand(engineId, buildEjectDiskCommand(diskId));
};

// ---------------------------------------------------------------------------
// Reboot engine
// ---------------------------------------------------------------------------

/**
 * Send the "reboot" command to the given engine.
 * The engine will reboot the host OS.
 */
export const rebootEngine = (engineId: string): void => {
  _sendCommand(engineId, 'reboot');
};

// ---------------------------------------------------------------------------
// Cancel operation
// ---------------------------------------------------------------------------

/**
 * Cancel a Pending or Running operation (also releases the resource lock on
 * Failed ops). Sent to the engine that owns the operation.
 * Format: "cancelOperation <operationId>"
 */
export const cancelOperation = (engineId: string, operationId: string): void => {
  _sendCommand(engineId, `cancelOperation ${operationId}`);
};

// ---------------------------------------------------------------------------
// Backup commands
// ---------------------------------------------------------------------------

/**
 * Build the "backupApp" command string (pure, no side effects).
 * Format: "backupApp <instanceName> <backupDiskName>"
 */
export const buildBackupAppCommand = (instanceName: string, backupDiskName: string): string =>
  `backupApp ${instanceName} ${backupDiskName}`;

/**
 * Build the "createBackupDisk" command string (pure, no side effects).
 * Format: "createBackupDisk <diskId> <mode> <instanceName1> [instanceName2...]"
 * `diskArg` comes from diskArgFor (ID on a 0b Engine, unique name otherwise).
 */
export const buildCreateBackupDiskCommand = (
  diskArg: string,
  mode: string,
  instanceNames: string[]
): string => `createBackupDisk ${diskArg} ${mode} ${instanceNames.join(' ')}`;

/** Trigger an on-demand backup of an instance to a named backup disk. */
export const backupApp = (
  engineId: string,
  instanceName: string,
  backupDiskName: string
): void => {
  _sendCommand(engineId, buildBackupAppCommand(instanceName, backupDiskName));
};

/**
 * Build the "createFilesDisk" command string (pure, no side effects).
 * Format: "createFilesDisk <diskId>" — ID only; only offered when the Engine
 * advertises 'filesDisk' (idea#129).
 */
export const buildCreateFilesDiskCommand = (diskId: string): string =>
  `createFilesDisk ${diskId}`;

/** Configure an empty disk as a Backup Disk on the given engine. */
export const createBackupDisk = (
  engineId: string,
  diskArg: string,
  mode: string,
  instanceNames: string[]
): void => {
  _sendCommand(engineId, buildCreateBackupDiskCommand(diskArg, mode, instanceNames));
};

/** Configure an empty disk as a Files Disk on the given engine. */
export const createFilesDisk = (
  engineId: string,
  diskId: string
): void => {
  _sendCommand(engineId, buildCreateFilesDiskCommand(diskId));
};

// ---------------------------------------------------------------------------
// Copy / Move App commands
// ---------------------------------------------------------------------------

/**
 * Build the "copyApp" command string (pure, no side effects).
 * Format: "copyApp <instanceName> <sourceDiskId> <targetDiskId>"
 */
export const buildCopyAppCommand = (
  instanceName: string,
  sourceDiskId: string,
  targetDiskId: string
): string => `copyApp ${instanceName} ${sourceDiskId} ${targetDiskId}`;

/**
 * Build the "moveApp" command string (pure, no side effects).
 * Format: "moveApp <instanceName> <sourceDiskId> <targetDiskId>"
 */
export const buildMoveAppCommand = (
  instanceName: string,
  sourceDiskId: string,
  targetDiskId: string
): string => `moveApp ${instanceName} ${sourceDiskId} ${targetDiskId}`;

/** Duplicate an instance onto a target disk (new InstanceID). */
export const copyApp = (
  engineId: string,
  instanceName: string,
  sourceDiskId: string,
  targetDiskId: string
): void => {
  _sendCommand(engineId, buildCopyAppCommand(instanceName, sourceDiskId, targetDiskId));
};

/** Move an instance to a target disk (same InstanceID). */
export const moveApp = (
  engineId: string,
  instanceName: string,
  sourceDiskId: string,
  targetDiskId: string
): void => {
  _sendCommand(engineId, buildMoveAppCommand(instanceName, sourceDiskId, targetDiskId));
};

// ---------------------------------------------------------------------------
// Install App command
// ---------------------------------------------------------------------------

/**
 * Build the "installApp" command string (pure, no side effects).
 * Format: "installApp <appId> <targetDiskId> [--source <sourceDiskId>] [--name <instanceName>]"
 * Disk arguments come from diskArgFor (IDs on a 0b Engine, unique names otherwise).
 */
export const buildInstallAppCommand = (
  appId: string,
  targetDiskArg: string,
  opts?: { source?: string; name?: string }
): string => {
  let cmd = `installApp ${appId} ${targetDiskArg}`;
  if (opts?.source) cmd += ` --source ${opts.source}`;
  if (opts?.name)   cmd += ` --name ${opts.name}`;
  return cmd;
};

/** Install an app from the appDB onto a target disk. */
export const installApp = (
  engineId: string,
  appId: string,
  targetDiskArg: string,
  opts?: { source?: string; name?: string }
): void => {
  _sendCommand(engineId, buildInstallAppCommand(appId, targetDiskArg, opts));
};

// ---------------------------------------------------------------------------
// Restore App command
// ---------------------------------------------------------------------------

/**
 * Build the "restoreApp" command string (pure, no side effects).
 * Format: "restoreApp <instanceName> <targetDiskName>"
 */
export const buildRestoreAppCommand = (instanceName: string, targetDiskName: string): string =>
  `restoreApp ${instanceName} ${targetDiskName}`;

/** Restore a backed-up instance onto a target disk. */
export const restoreApp = (
  engineId: string,
  instanceName: string,
  targetDiskName: string
): void => {
  _sendCommand(engineId, buildRestoreAppCommand(instanceName, targetDiskName));
};
