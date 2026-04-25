import type { Store, Operation } from '../types/store';

const ACTIVE_STATUSES = new Set<string>(['Pending', 'Running']);

/** Returns all active (Pending | Running) operations for a given instanceId. */
export function getActiveOpsForInstance(store: Store | null, instanceId: string): Operation[] {
  if (!store) return [];
  return Object.values(store.operationDB ?? {}).filter(
    (op) => ACTIVE_STATUSES.has(op.status) && op.args['instanceId'] === instanceId
  );
}

/** Returns all active operations that reference a given diskId (sourceDiskId, targetDiskId, backupDiskId). */
export function getActiveOpsForDisk(store: Store | null, diskId: string): Operation[] {
  if (!store) return [];
  return Object.values(store.operationDB ?? {}).filter(
    (op) =>
      ACTIVE_STATUSES.has(op.status) &&
      (op.args['sourceDiskId'] === diskId ||
        op.args['targetDiskId'] === diskId ||
        op.args['backupDiskId'] === diskId)
  );
}

/** Returns true if there is any active operation locking this instance. */
export function isInstanceLocked(store: Store | null, instanceId: string): boolean {
  return getActiveOpsForInstance(store, instanceId).length > 0;
}

/** Returns true if there is any active operation locking this disk. */
export function isDiskLocked(store: Store | null, diskId: string): boolean {
  return getActiveOpsForDisk(store, diskId).length > 0;
}
