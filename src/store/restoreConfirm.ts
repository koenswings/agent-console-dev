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

export const otherDiskSummary = (w: RestoreWords): string =>
  `${w.app} restored from ${w.date} and now running from ${w.target}. The old copy on ${w.current} was kept.`;
