/**
 * Command helpers — write command strings to the engine's commands[] array
 * via the active store connection.
 *
 * Command string format mirrors the Engine's commandUtils.ts sendCommand pattern:
 *   "<commandName> <arg1> <arg2>"
 *
 * The Engine processes these strings from engine.commands[] via its command loop.
 */

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
 * Format: "ejectDisk <diskName>"
 */
export const buildEjectDiskCommand = (diskName: string): string =>
  `ejectDisk ${diskName}`;

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

/** Eject a disk from the given engine. */
export const ejectDisk = (engineId: string, diskName: string): void => {
  _sendCommand(engineId, buildEjectDiskCommand(diskName));
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
 * Format: "createBackupDisk <diskName> <mode> <instanceName1> [instanceName2...]"
 */
export const buildCreateBackupDiskCommand = (
  diskName: string,
  mode: string,
  instanceNames: string[]
): string => `createBackupDisk ${diskName} ${mode} ${instanceNames.join(' ')}`;

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
 * Format: "createFilesDisk <diskName>"
 */
export const buildCreateFilesDiskCommand = (diskName: string): string =>
  `createFilesDisk ${diskName}`;

/** Configure an empty disk as a Backup Disk on the given engine. */
export const createBackupDisk = (
  engineId: string,
  diskName: string,
  mode: string,
  instanceNames: string[]
): void => {
  _sendCommand(engineId, buildCreateBackupDiskCommand(diskName, mode, instanceNames));
};

/** Configure an empty disk as a Files Disk on the given engine. */
export const createFilesDisk = (
  engineId: string,
  diskName: string
): void => {
  _sendCommand(engineId, buildCreateFilesDiskCommand(diskName));
};

// ---------------------------------------------------------------------------
// Copy / Move App commands
// ---------------------------------------------------------------------------

/**
 * Build the "copyApp" command string (pure, no side effects).
 * Format: "copyApp <instanceId> <sourceDiskId> <targetDiskId>"
 */
export const buildCopyAppCommand = (
  instanceId: string,
  sourceDiskId: string,
  targetDiskId: string
): string => `copyApp ${instanceId} ${sourceDiskId} ${targetDiskId}`;

/**
 * Build the "moveApp" command string (pure, no side effects).
 * Format: "moveApp <instanceId> <sourceDiskId> <targetDiskId>"
 */
export const buildMoveAppCommand = (
  instanceId: string,
  sourceDiskId: string,
  targetDiskId: string
): string => `moveApp ${instanceId} ${sourceDiskId} ${targetDiskId}`;

/** Duplicate an instance onto a target disk (new InstanceID). */
export const copyApp = (
  engineId: string,
  instanceId: string,
  sourceDiskId: string,
  targetDiskId: string
): void => {
  _sendCommand(engineId, buildCopyAppCommand(instanceId, sourceDiskId, targetDiskId));
};

/** Move an instance to a target disk (same InstanceID). */
export const moveApp = (
  engineId: string,
  instanceId: string,
  sourceDiskId: string,
  targetDiskId: string
): void => {
  _sendCommand(engineId, buildMoveAppCommand(instanceId, sourceDiskId, targetDiskId));
};

// ---------------------------------------------------------------------------
// Install App command
// ---------------------------------------------------------------------------

/**
 * Build the "installApp" command string (pure, no side effects).
 * Format: "installApp <appId> <targetDiskName> [--source <sourceDiskName>] [--name <instanceName>]"
 */
export const buildInstallAppCommand = (
  appId: string,
  targetDiskName: string,
  opts?: { source?: string; name?: string }
): string => {
  let cmd = `installApp ${appId} ${targetDiskName}`;
  if (opts?.source) cmd += ` --source ${opts.source}`;
  if (opts?.name)   cmd += ` --name ${opts.name}`;
  return cmd;
};

/** Install an app from the appDB onto a target disk. */
export const installApp = (
  engineId: string,
  appId: string,
  targetDiskName: string,
  opts?: { source?: string; name?: string }
): void => {
  _sendCommand(engineId, buildInstallAppCommand(appId, targetDiskName, opts));
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
