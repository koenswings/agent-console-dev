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
export type EngineCapability = 'diskIdArgs' | 'filesDisk' | 'eraseDisk';

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
 * Format: "startInstance <instanceName> <diskId>"
 *
 * Sends the disk ID (the instance's `storedOn`), never the display name. The
 * Engine splits multi-argument commands on spaces (commandUtils.ts), so a
 * name like "Duration Tests — Add Files App" is refused with "Too many
 * arguments" (r29@97). Engine 8d98718's startInstance/stopInstance wrappers
 * find the disk via `instance.storedOn` first, so the ID always works.
 */
export const buildStartInstanceCommand = (instanceName: string, diskId: string): string =>
  `startInstance ${instanceName} ${diskId}`;

/**
 * Build the "stopInstance" command string (pure, no side effects).
 * Format: "stopInstance <instanceName> <diskId>" — disk ID, see buildStartInstanceCommand.
 */
export const buildStopInstanceCommand = (instanceName: string, diskId: string): string =>
  `stopInstance ${instanceName} ${diskId}`;

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

/** Start a named instance stored on disk `diskId` (its storedOn), addressed to the given engine. */
export const startInstance = (
  engineId: string,
  instanceName: string,
  diskId: string
): void => {
  _sendCommand(engineId, buildStartInstanceCommand(instanceName, diskId));
};

/** Stop a named instance stored on disk `diskId` (its storedOn), addressed to the given engine. */
export const stopInstance = (
  engineId: string,
  instanceName: string,
  diskId: string
): void => {
  _sendCommand(engineId, buildStopInstanceCommand(instanceName, diskId));
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
 * Format: "backupApp <instanceId> <backupDiskId>"
 *
 * IDs, never display names (r29@97): names may contain spaces, which the
 * Engine's space-split refuses, and two instances can share a name
 * ("kolibri"). Axle's Engine fix resolves both arguments id-first
 * (resolveInstanceArg / resolveDiskArg). Fleet Engine 8d98718 matches the
 * instance and disk by NAME only and refuses this form until the fix is
 * deployed; the panels show that refusal (CommandFeedback).
 */
export const buildBackupAppCommand = (instanceId: string, backupDiskId: string): string =>
  `backupApp ${instanceId} ${backupDiskId}`;

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

/** Trigger an on-demand backup of an instance (by ID) to a backup disk (by ID). */
export const backupApp = (
  engineId: string,
  instanceId: string,
  backupDiskId: string
): void => {
  _sendCommand(engineId, buildBackupAppCommand(instanceId, backupDiskId));
};

/**
 * Build the "createFilesDisk" command string (pure, no side effects).
 * Format: "createFilesDisk <diskId> [<shareName…>]" — ID only; only offered
 * when the Engine advertises 'filesDisk' (idea#129, idea#132). The share name
 * is free text and goes last (it takes the rest of the line on the Engine).
 */
export const buildCreateFilesDiskCommand = (diskId: string, shareName?: string): string =>
  shareName ? `createFilesDisk ${diskId} ${shareName}` : `createFilesDisk ${diskId}`;

/** Default share name for a new Files Disk (files-disk.md §7.1, E6). */
export const DEFAULT_SHARE_NAME = 'School Files';

/**
 * Validate a Files Disk share name as the operator types (same rule as the
 * Engine, files-disk.md §7.1): 1–16 characters (ASCII, so bytes = characters),
 * only A–Z a–z 0–9, space, hyphen, underscore and parentheses, no leading or
 * trailing space. Returns an error message, or null when valid.
 */
export const validateShareName = (name: string): string | null => {
  if (name.length === 0) return 'Enter a share name.';
  if (!/^[A-Za-z0-9 _()-]*$/.test(name)) {
    return 'Use only letters, digits, spaces, hyphens, underscores and parentheses.';
  }
  if (name.length > 16) return 'At most 16 characters.';
  if (name !== name.trim()) return 'No space at the start or end.';
  return null;
};

/** Configure an empty disk as a Backup Disk on the given engine. */
export const createBackupDisk = (
  engineId: string,
  diskArg: string,
  mode: string,
  instanceNames: string[]
): void => {
  _sendCommand(engineId, buildCreateBackupDiskCommand(diskArg, mode, instanceNames));
};

/** Add the Files role to a disk (empty, App or Backup Disk) on the given engine. */
export const createFilesDisk = (
  engineId: string,
  diskId: string,
  shareName?: string
): void => {
  _sendCommand(engineId, buildCreateFilesDiskCommand(diskId, shareName));
};

/**
 * Build "summariseDisk <targetId>" (idea#136). targetId is a disk ID or an
 * unformattedDisks[].candidateId. ID only — no name form.
 */
export const buildSummariseDiskCommand = (targetId: string): string =>
  `summariseDisk ${targetId}`;

/**
 * Build "eraseDisk <targetId> <summaryTraceId> <confirmName…>" (idea#136).
 * confirmName is the exact label from the summary (rest of the line).
 */
export const buildEraseDiskCommand = (
  targetId: string,
  summaryTraceId: string,
  confirmName: string
): string => `eraseDisk ${targetId} ${summaryTraceId} ${confirmName}`;

/** Ask the Engine for a content summary of a disk or unformatted candidate. */
export const summariseDisk = (engineId: string, targetId: string): void => {
  _sendCommand(engineId, buildSummariseDiskCommand(targetId));
};

/** Erase a disk (or unformatted candidate) after a fresh summary and typed label. */
export const eraseDisk = (
  engineId: string,
  targetId: string,
  summaryTraceId: string,
  confirmName: string
): void => {
  _sendCommand(engineId, buildEraseDiskCommand(targetId, summaryTraceId, confirmName));
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
 * Format: "restoreApp <instanceId> <targetDiskId>"
 *
 * IDs, never display names — see buildBackupAppCommand. A disk name with
 * spaces was refused with "Too many arguments" (r29@97). Needs Axle's Engine
 * fix (resolveInstanceArg / resolveDiskArg); fleet Engine 8d98718 refuses it.
 */
export const buildRestoreAppCommand = (instanceId: string, targetDiskId: string): string =>
  `restoreApp ${instanceId} ${targetDiskId}`;

/** Restore a backed-up instance (by ID) onto a target disk (by ID). */
export const restoreApp = (
  engineId: string,
  instanceId: string,
  targetDiskId: string
): void => {
  _sendCommand(engineId, buildRestoreAppCommand(instanceId, targetDiskId));
};
