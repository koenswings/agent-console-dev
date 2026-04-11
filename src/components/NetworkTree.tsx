import { For, Show, createMemo, createSignal, type Component } from 'solid-js';
import { isEngineOnline } from '../store/signals';
import { ejectDisk, copyApp, moveApp } from '../store/commands';
import { isDiskLocked } from '../store/operations';
import type { Disk, DiskType, Store } from '../types/store';

// ---------------------------------------------------------------------------
// Disk type badge helpers
// ---------------------------------------------------------------------------
const DISK_TYPE_LABEL: Record<DiskType, string> = {
  app: 'app',
  backup: 'backup',
  empty: 'empty',
  upgrade: 'upgrade',
  files: 'files',
};

/** Returns the primary display label for a disk based on its diskTypes array. */
const diskTypeLabel = (disk: Disk): string | null => {
  if (!disk.diskTypes || disk.diskTypes.length === 0) return null;
  return DISK_TYPE_LABEL[disk.diskTypes[0]] ?? null;
};

/** Returns true when the eject button should be shown (never on backup disks). */
const canEject = (disk: Disk): boolean =>
  disk.device !== null && !(disk.diskTypes ?? []).includes('backup');

// ---------------------------------------------------------------------------
// Drag data shape
// ---------------------------------------------------------------------------
interface DragInstanceData {
  instanceId: string;
  instanceName: string;
  sourceDiskId: string;
  sourceDiskName: string;
}

const DRAG_TYPE = 'application/x-idea-instance';

// ---------------------------------------------------------------------------
// Copy/Move modal
// ---------------------------------------------------------------------------
interface CopyMoveModalProps {
  instanceName: string;
  sourceDiskName: string;
  targetDiskName: string;
  onChoice: (op: 'copy' | 'move') => void;
  onCancel: () => void;
}

const CopyMoveModal: Component<CopyMoveModalProps> = (props) => (
  <div class="copy-move-modal-overlay" role="dialog" aria-modal="true" aria-label="Copy or Move">
    <div class="copy-move-modal">
      <div class="copy-move-modal__title">Copy or Move?</div>
      <p class="copy-move-modal__desc">
        <strong>{props.instanceName}</strong> from <em>{props.sourceDiskName}</em> → <em>{props.targetDiskName}</em>
      </p>
      <div class="copy-move-modal__actions">
        <button class="btn" onClick={props.onCancel}>Cancel</button>
        <button class="btn" onClick={() => props.onChoice('move')}>Move</button>
        <button class="btn btn--primary" onClick={() => props.onChoice('copy')}>Copy</button>
      </div>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Selection type
// ---------------------------------------------------------------------------
export interface Selection {
  type: 'network' | 'engine' | 'disk';
  id: string;
}

interface NetworkTreeProps {
  selection: Selection;
  onSelect: (selection: Selection) => void;
  /** Reactive store accessor — passed from App.tsx */
  store: () => Store | null;
}

// ---------------------------------------------------------------------------
// NetworkTree component
// ---------------------------------------------------------------------------
const NetworkTree: Component<NetworkTreeProps> = (props) => {
  const isSelected = (type: Selection['type'], id: string): boolean =>
    props.selection.type === type && props.selection.id === id;

  // ID list — stable strings so <For> reuses scopes on store updates
  const engineIds = createMemo(() =>
    Object.keys(props.store()?.engineDB ?? {})
  );

  // ── Drag state ────────────────────────────────────────────────────────────
  const [dragData, setDragData] = createSignal<DragInstanceData | null>(null);
  const [dropTargetDiskId, setDropTargetDiskId] = createSignal<string | null>(null);

  // Pending copy/move modal state
  interface PendingOp {
    data: DragInstanceData;
    targetDisk: Disk;
    targetEngineId: string;
  }
  const [pendingOp, setPendingOp] = createSignal<PendingOp | null>(null);

  const handleDrop = (targetDiskId: string) => {
    const data = dragData();
    const s = props.store();
    if (!data || !s) return;

    const targetDisk = s.diskDB[targetDiskId];
    if (!targetDisk || !targetDisk.dockedTo) return;

    // Don't drop onto the same disk
    if (targetDiskId === data.sourceDiskId) return;

    setPendingOp({ data, targetDisk, targetEngineId: targetDisk.dockedTo });
    setDropTargetDiskId(null);
    setDragData(null);
  };

  const handleCopyMoveChoice = (op: 'copy' | 'move') => {
    const pending = pendingOp();
    if (!pending) return;
    const { data, targetDisk, targetEngineId } = pending;
    if (op === 'copy') {
      copyApp(targetEngineId, data.instanceName, data.sourceDiskName, targetDisk.name);
    } else {
      moveApp(targetEngineId, data.instanceName, data.sourceDiskName, targetDisk.name);
    }
    setPendingOp(null);
  };

  return (
    <nav class="network-tree" aria-label="Network tree">
      <div class="network-tree__header">Network</div>

      {/* ── All-instances "Network" row ─────────────────────────── */}
      <div
        class={`tree-item tree-item--network ${isSelected('network', '') ? 'tree-item--selected' : ''}`}
        role="treeitem"
        tabIndex={0}
        aria-selected={isSelected('network', '')}
        onClick={() => props.onSelect({ type: 'network', id: '' })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            props.onSelect({ type: 'network', id: '' });
          }
        }}
      >
        <span class="tree-item__icon">🌐</span>
        <span class="tree-item__label">All instances</span>
      </div>

      {/* ── Per-engine rows ──────────────────────────────────────── */}
      <For each={engineIds()}>
        {(engineId) => {
          // Fine-grained accessor — only re-reads when this engine's data changes
          const engine = () => props.store()?.engineDB[engineId];
          const online = () => {
            const e = engine();
            return e ? isEngineOnline(e) : false;
          };

          // Disk IDs for this engine — only changes when disks are added/removed
          const diskIds = createMemo(() =>
            Object.keys(props.store()?.diskDB ?? {}).filter(
              (id) => props.store()?.diskDB[id]?.dockedTo === engineId
            )
          );

          return (
            <Show when={engine()}>
              <div
                class={`tree-item tree-item--engine ${isSelected('engine', engineId) ? 'tree-item--selected' : ''}`}
                role="treeitem"
                tabIndex={0}
                aria-selected={isSelected('engine', engineId)}
                onClick={() => props.onSelect({ type: 'engine', id: engineId })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    props.onSelect({ type: 'engine', id: engineId });
                  }
                }}
              >
                <span class="tree-item__icon">🖥</span>
                <span class="tree-item__label">{engine()?.hostname}</span>
                <span class={`tree-item__badge ${online() ? 'tree-item__badge--online' : 'tree-item__badge--offline'}`}>
                  {online() ? 'online' : 'offline'}
                </span>
              </div>

              {/* ── Per-disk sub-rows ────────────────────────────── */}
              <For each={diskIds()}>
                {(diskId) => {
                  const disk = () => props.store()?.diskDB[diskId] as Disk | undefined;
                  const isDragOver = () => dropTargetDiskId() === diskId;

                  // ── Instance rows for this disk (draggable) ──────
                  const instancesOnDisk = createMemo(() => {
                    const s = props.store();
                    if (!s) return [];
                    return Object.values(s.instanceDB).filter(
                      (inst) => inst.storedOn === diskId
                    );
                  });

                  return (
                    <Show when={disk()}>
                      {/* Disk row — droppable */}
                      <div
                        class={`tree-item tree-item--disk ${isSelected('disk', diskId) ? 'tree-item--selected' : ''} ${isDragOver() ? 'tree-item--drag-over' : ''}`}
                        role="treeitem"
                        tabIndex={0}
                        aria-selected={isSelected('disk', diskId)}
                        onClick={() => props.onSelect({ type: 'disk', id: diskId })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            props.onSelect({ type: 'disk', id: diskId });
                          }
                        }}
                        onDragOver={(e) => {
                          if (dragData()) {
                            e.preventDefault();
                            setDropTargetDiskId(diskId);
                          }
                        }}
                        onDragLeave={() => {
                          if (dropTargetDiskId() === diskId) setDropTargetDiskId(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          handleDrop(diskId);
                        }}
                      >
                        <span class="tree-item__icon">💾</span>
                        <span class="tree-item__label">{disk()?.name}</span>
                        <Show when={diskTypeLabel(disk()!)}>
                          <span class={`tree-item__type-badge tree-item__type-badge--${diskTypeLabel(disk()!)}`}>
                            {diskTypeLabel(disk()!)}
                          </span>
                        </Show>
                        <Show when={canEject(disk()!)}>
                          <button
                            class="tree-item__eject-btn"
                            disabled={isDiskLocked(props.store(), diskId)}
                            title={
                              isDiskLocked(props.store(), diskId)
                                ? 'Operation in progress — cannot eject'
                                : `Eject ${disk()?.name}`
                            }
                            aria-label={`Eject disk ${disk()?.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              const eng = engine();
                              const d = disk();
                              if (eng && d) ejectDisk(eng.id, d.name);
                            }}
                          >
                            ⏏
                          </button>
                        </Show>
                      </div>

                      {/* Instance rows — draggable */}
                      <For each={instancesOnDisk()}>
                        {(inst) => {
                          const d = disk();
                          return (
                            <div
                              class="tree-item tree-item--instance"
                              draggable={true}
                              title={`Drag to copy/move ${inst.name}`}
                              onDragStart={(e) => {
                                if (!d) return;
                                const data: DragInstanceData = {
                                  instanceId: inst.id,
                                  instanceName: inst.name,
                                  sourceDiskId: diskId,
                                  sourceDiskName: d.name,
                                };
                                e.dataTransfer?.setData(DRAG_TYPE, JSON.stringify(data));
                                setDragData(data);
                              }}
                              onDragEnd={() => {
                                setDragData(null);
                                setDropTargetDiskId(null);
                              }}
                            >
                              <span class="tree-item__icon tree-item__icon--instance">📦</span>
                              <span class="tree-item__label">{inst.name}</span>
                            </div>
                          );
                        }}
                      </For>
                    </Show>
                  );
                }}
              </For>
            </Show>
          );
        }}
      </For>

      {/* ── Copy/Move modal ─────────────────────────────────────── */}
      <Show when={pendingOp()}>
        {(op) => (
          <CopyMoveModal
            instanceName={op().data.instanceName}
            sourceDiskName={op().data.sourceDiskName}
            targetDiskName={op().targetDisk.name}
            onChoice={handleCopyMoveChoice}
            onCancel={() => setPendingOp(null)}
          />
        )}
      </Show>
    </nav>
  );
};

export default NetworkTree;
