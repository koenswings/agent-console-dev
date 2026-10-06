/**
 * Drag-and-drop copy/move controller (extracted from App.tsx so the exact App
 * path can be component-tested): an app dragged onto a disk opens the
 * Copy-or-Move modal; the choice sends copyApp/moveApp to the SOURCE Engine
 * (it runs the rsync) and tracks the answer in one CommandResult that App
 * shows above the right pane / in the mobile layout.
 *
 * Cross-engine (remoteConfirm.ts): when the source Engine isn't the connected
 * one, the result shows "Sent to <engine>, waiting for confirmation" and
 * resolves from the store (new op Done / Failed, or the copied instance on the
 * target disk / the moved instance's storedOn).
 */
import { createSignal, type Accessor } from 'solid-js';
import type { Store } from '../types/store';
import type { DragAppData } from '../types/drag';
import type { CommandLogState } from './commandLog';
import { createCommandResult, type CommandResult } from './commandResult';
import { confirmNewOperation, instanceStoredOn, newInstanceOnDisk, remoteWatchFor } from './remoteConfirm';
import { copyApp, moveApp } from './commands';

export interface PendingMove {
  data: DragAppData;
  targetDiskId: string;
  targetDiskName: string;
  targetEngineHostname: string;
}

export interface DragCopyMove {
  dragData: Accessor<DragAppData | null>;
  setDragData: (d: DragAppData | null) => void;
  pendingMove: Accessor<PendingMove | null>;
  cancel: () => void;
  handleDrop: (data: DragAppData, targetDiskId: string) => void;
  choose: (op: 'copy' | 'move') => void;
  result: CommandResult;
  subject: Accessor<string>;
}

export const createDragCopyMove = (
  store: Accessor<Store | null>,
  commandLog: Accessor<CommandLogState>,
): DragCopyMove => {
  const [dragData, setDragData] = createSignal<DragAppData | null>(null);
  const [pendingMove, setPendingMove] = createSignal<PendingMove | null>(null);
  const result = createCommandResult({ commandLog, argKey: 'instanceName', longRunning: true });
  const [subject, setSubject] = createSignal('');

  const handleDrop = (data: DragAppData, targetDiskId: string) => {
    const s = store();
    if (!s) return;
    const targetDisk = s.diskDB[targetDiskId];
    if (!targetDisk?.dockedTo) return;
    const targetEngine = s.engineDB[String(targetDisk.dockedTo)];
    setPendingMove({
      data,
      targetDiskId,
      targetDiskName: String(targetDisk.name),
      targetEngineHostname: targetEngine ? String(targetEngine.hostname) : String(targetDisk.dockedTo),
    });
  };

  const choose = (op: 'copy' | 'move') => {
    const pending = pendingMove();
    if (!pending) return;
    const s = store();
    // Command must go to the SOURCE engine — it is the one running rsync
    const sourceDisk = s?.diskDB[pending.data.sourceDiskId];
    if (!sourceDisk?.dockedTo) return;
    const engineId = String(sourceDisk.dockedTo);
    const { instanceId, instanceName, sourceDiskId } = pending.data;
    const targetDiskId = pending.targetDiskId;
    setSubject(instanceName);
    // Instance by NAME: copyApp/moveApp resolve the instance by name on every
    // Engine (8d98718 and Axle's fix); the disks go by ID.
    if (op === 'copy') {
      const instanceOf = s?.instanceDB[instanceId]?.instanceOf;
      const instanceOfStr = instanceOf === undefined ? undefined : String(instanceOf);
      result.start(instanceName, () => copyApp(engineId, instanceName, sourceDiskId, targetDiskId), {
        command: 'copyApp',
        engineId,
        remote: remoteWatchFor(store, engineId, 'copyApp', confirmNewOperation(store, 'copyApp', instanceId, {
          engineId,
          args: { targetDiskId },
          // copyApp keeps the app and the name; the copy gets a fresh id.
          fallbackOk: newInstanceOnDisk(store, targetDiskId, { instanceOf: instanceOfStr, name: instanceName, engineId }),
        })),
      });
    } else {
      result.start(instanceName, () => moveApp(engineId, instanceName, sourceDiskId, targetDiskId), {
        command: 'moveApp',
        engineId,
        remote: remoteWatchFor(store, engineId, 'moveApp', confirmNewOperation(store, 'moveApp', instanceId, {
          engineId,
          args: { targetDiskId },
          fallbackOk: instanceStoredOn(store, instanceId, targetDiskId),
        })),
      });
    }
    setPendingMove(null);
    setDragData(null);
  };

  return { dragData, setDragData, pendingMove, cancel: () => setPendingMove(null), handleDrop, choose, result, subject };
};
