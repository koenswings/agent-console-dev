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
