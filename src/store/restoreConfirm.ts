/**
 * Restore confirm wording (agent-engine-dev#191, also #189 / #190). Axle's
 * text, used exactly. Plain strings for tests; RestorePanel renders the same
 * words with the app and disk names in bold.
 */
import type { Disk, Instance, Store } from '../types/store';

export interface RestoreWords { app: string; date: string; target: string; current: string }

/** The backup's date as shown to teachers ("an unknown date" when never recorded). */
export const backupDateText = (ts: number | null | undefined): string =>
  ts ? new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'an unknown date';

/** Name of the disk the instance is on now (its storedOn), or its id. */
export const currentDiskName = (store: Store | null, inst: Instance): string => {
  const id = inst.storedOn ? String(inst.storedOn) : '';
  return (id && (store?.diskDB?.[id] as Disk | undefined)?.name) || id || 'its current disk';
};

/** True when the restore goes back onto the disk the app is on now. */
export const isSameDiskRestore = (inst: Instance, targetDiskId: string): boolean =>
  !!inst.storedOn && String(inst.storedOn) === targetDiskId;

export const sameDiskConfirm = (w: Pick<RestoreWords, 'app' | 'date'>): string =>
  `Restore ${w.app} from the backup of ${w.date}? The app will be stopped and its data replaced with the backup. Changes made since ${w.date} will be lost.`;

export const otherDiskQuestion = (w: Pick<RestoreWords, 'app' | 'date' | 'target'>): string =>
  `Restore ${w.app} from the backup of ${w.date} onto ${w.target}?`;

export const otherDiskPoints = (w: RestoreWords): string[] => [
  `The running copy of ${w.app} on ${w.current} will be stopped.`,
  `From now on, ${w.app} will run from ${w.target}.`,
  `The old copy on ${w.current} is not deleted. It stays there until you remove it.`,
];

export const otherDiskButton = (target: string): string => `Restore to ${target}`;

/**
 * #255: what the app does after a restore onto another disk, read from its live
 * status in the store. The Engine starts the restored copy only when it was
 * Running on a disk docked here (engine#413 / #422); when its old disk is gone it
 * stays stopped. A start still waiting for the app to answer is Error with
 * PORT_NOT_READY while the restore is Done (engine#428), so Starting/Error read
 * as starting.
 */
export type RestoreOutcome = 'running' | 'starting' | 'stopped-disk-gone' | 'stopped';

/** True when the disk the app was on is no longer docked anywhere (the breakdown case). */
export const oldDiskGone = (store: Store | null, inst: Instance): boolean => {
  const id = inst.storedOn ? String(inst.storedOn) : '';
  const d = id ? (store?.diskDB?.[id] as Disk | undefined) : undefined;
  return !d || !d.dockedTo;
};

/**
 * Outcome once the restore is ok. Null until the store shows the instance on the
 * target disk, so the line never reads the status from before the restore.
 */
export const restoreOutcome = (
  inst: Pick<Instance, 'status' | 'storedOn'> | undefined,
  targetDiskId: string,
  diskWasGone: boolean,
): RestoreOutcome | null => {
  if (!inst || String(inst.storedOn) !== targetDiskId) return null;
  if (inst.status === 'Running') return 'running';
  if (inst.status === 'Starting' || inst.status === 'Error') return 'starting';
  return diskWasGone ? 'stopped-disk-gone' : 'stopped';
};

export const otherDiskSummary = (w: RestoreWords, outcome: RestoreOutcome = 'running'): string => {
  switch (outcome) {
    case 'starting':
      return `${w.app} restored from ${w.date} onto ${w.target} and is starting. The old copy on ${w.current} was kept.`;
    case 'stopped-disk-gone':
      return `${w.app} is restored from ${w.date} to ${w.target} but stays stopped because its old disk is gone. Press Start when you're ready.`;
    case 'stopped':
      return `${w.app} is restored from ${w.date} to ${w.target} and stays stopped, as it was before. Press Start when you're ready. The old copy on ${w.current} was kept.`;
    default:
      return `${w.app} restored from ${w.date} and now running from ${w.target}. The old copy on ${w.current} was kept.`;
  }
};
