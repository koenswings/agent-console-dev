/**
 * Backup sizing line: "This Pi's Apps use about X GB" (engine#441 / engine#430).
 *
 * The Engine stores Instance.dataBytes (bytes, rounded to whole MB of
 * 1,000,000 bytes) on each instance. There is no Engine total in the store,
 * so the Console sums the instances that sit on disks docked to this Engine
 * (`Disk.dockedTo === engineId`). Undocked disks and disks docked to another
 * Engine are excluded. Only non-null `dataBytes` values are added.
 *
 * Null rule (documented for the PR):
 *   - no Apps on this Pi: "No Apps on this Pi yet"
 *   - none of those Apps have a measurement: "This Pi's Apps are not measured yet"
 *   - some measured, some null or missing: "This Pi's Apps use about X GB (N Apps not measured yet)"
 *   - all measured: "This Pi's Apps use about X GB"
 *
 * Formatting (decimal GB, 1 GB = 1,000,000,000 bytes, matching Engine DiskSize):
 *   - a small non-zero (or zero) total under 1 GB: "less than 1 GB", never "0 GB"
 *   - under 10 GB: one decimal place
 *   - 10 GB and above: whole numbers
 */
import type { Disk, Instance, Store } from '../types/store';

const GB = 1_000_000_000;

export interface BackupSizing {
  /** Teacher-facing sentence, or null when the Engine is unknown. */
  text: string | null;
  /** Instances on disks docked to this Engine. */
  appCount: number;
  /** How many of those have a numeric dataBytes. */
  measuredCount: number;
  /** How many have null or missing dataBytes. */
  unmeasuredCount: number;
  /** Sum of non-null dataBytes only (bytes). */
  totalBytes: number;
}

const emptySizing = (text: string | null): BackupSizing => ({
  text,
  appCount: 0,
  measuredCount: 0,
  unmeasuredCount: 0,
  totalBytes: 0,
});

/**
 * Format a byte total as a short size phrase (no "about").
 * Never returns "0 GB" for a value under 1 GB.
 */
export const formatAppDataSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < GB) return 'less than 1 GB';
  const gb = bytes / GB;
  if (gb < 10) {
    const one = Math.round(gb * 10) / 10;
    if (one < 10) return `${one.toFixed(1)} GB`;
    return '10 GB';
  }
  return `${Math.round(gb)} GB`;
};

const isMeasured = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const appsWord = (n: number): string => (n === 1 ? '1 App' : `${n} Apps`);

const sizeSentence = (totalBytes: number): string => {
  const size = formatAppDataSize(totalBytes);
  return size === 'less than 1 GB'
    ? `This Pi's Apps use ${size}`
    : `This Pi's Apps use about ${size}`;
};

/**
 * Pure: sum Instance.dataBytes over instances stored on disks docked to
 * `engineId`. Returns text: null when engineId is missing.
 */
export const deriveBackupSizing = (
  store: Pick<Store, 'diskDB' | 'instanceDB'> | null | undefined,
  engineId: string | null | undefined,
): BackupSizing => {
  if (!engineId) return emptySizing(null);
  if (!store) return emptySizing('No Apps on this Pi yet');

  const dockedDiskIds = new Set(
    Object.values(store.diskDB ?? {})
      .filter((disk): disk is Disk => !!disk && String(disk.dockedTo) === String(engineId))
      .map((disk) => String(disk.id)),
  );

  const instances = Object.values(store.instanceDB ?? {}).filter(
    (inst): inst is Instance =>
      !!inst && inst.storedOn != null && dockedDiskIds.has(String(inst.storedOn)),
  );

  if (instances.length === 0) return emptySizing('No Apps on this Pi yet');

  let totalBytes = 0;
  let measuredCount = 0;
  for (const inst of instances) {
    if (isMeasured(inst.dataBytes)) {
      totalBytes += inst.dataBytes;
      measuredCount += 1;
    }
  }
  const unmeasuredCount = instances.length - measuredCount;

  let text: string;
  if (measuredCount === 0) {
    text = "This Pi's Apps are not measured yet";
  } else if (unmeasuredCount > 0) {
    text = `${sizeSentence(totalBytes)} (${appsWord(unmeasuredCount)} not measured yet)`;
  } else {
    text = sizeSentence(totalBytes);
  }

  return {
    text,
    appCount: instances.length,
    measuredCount,
    unmeasuredCount,
    totalBytes,
  };
};
