import type { Status } from '../types/store';

/** Returns true when the Start button should be disabled. */
export const isStartDisabled = (status: Status): boolean =>
  status === 'Running' || status === 'Starting' || status === 'Missing';

/** Returns true when the Backup button should be disabled. */
export const isBackupDisabled = (status: Status): boolean =>
  status !== 'Running';

/** Returns true when the Stop button should be disabled. */
export const isStopDisabled = (status: Status): boolean =>
  status === 'Stopped' || status === 'Docked' || status === 'Undocked' || status === 'Missing';
