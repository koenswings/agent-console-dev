import { For, Show, createMemo, createSignal, onCleanup, type Component } from 'solid-js';
import { isEngineOnline } from '../store/signals';

// Reactive clock — ticks every 15 s so online badges flip promptly
const [now, setNow] = createSignal(Date.now());
const _clockInterval = setInterval(() => setNow(Date.now()), 15_000);
import { ejectDisk, rebootEngine } from '../store/commands';
import { isDiskLocked } from '../store/operations';
import type { Disk, DiskType, Store } from '../types/store';
import type { DragAppData } from '../types/drag';
import { DRAG_TYPE } from '../types/drag';

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

/**
 * Returns the primary display label for a disk.
 * Disks tagged 'empty' that actually have instances are shown as 'app' instead.
 */
const diskTypeLabel = (disk: Disk, store: Store | null): string | null => {
  if (!disk.diskTypes || disk.diskTypes.length === 0) return null;
  const raw = DISK_TYPE_LABEL[disk.diskTypes[0]] ?? null;
  if (raw === 'empty' && store) {
    const hasInstances = Object.values(store.instanceDB ?? {}).some(
      (inst) => String(inst.storedOn) === disk.id
    );
    if (hasInstances) return 'app';
  }
  return raw;
};

/** Returns true when the eject button should be shown (never on backup disks). */
const canEject = (disk: Disk): boolean =>
  disk.device !== null && !(disk.diskTypes ?? []).includes('backup');

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
  /** Current drag payload — set by App when a row drag starts. */
  dragData: () => DragAppData | null;
  /** Called when an app is dropped onto a disk. */
  onDrop: (data: DragAppData, targetDiskId: string) => void;
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

  // Local drop-target highlight state
  const [dropTargetDiskId, setDropTargetDiskId] = createSignal<string | null>(null);

  return (
    <nav class="network-tree" aria-label="Network tree">
      <div class="network-tree__header">Network</div>

      {/* ── "All apps" row ──────────────────────────────────────── */}
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
        <span class="tree-item__label">All apps</span>
      </div>

      {/* ── Per-engine rows ──────────────────────────────────────── */}
      <For each={engineIds()}>
        {(engineId) => {
          const engine = () => props.store()?.engineDB[engineId];
          const online = () => {
            const e = engine();
            return e ? isEngineOnline(e, now()) : false;
          };

          // Disk IDs docked to this engine
          const diskIds = createMemo(() =>
            Object.keys(props.store()?.diskDB ?? {}).filter(
              (id) => String(props.store()?.diskDB[id]?.dockedTo) === engineId
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
                <span class="tree-item__icon tree-item__icon--engine">
                  <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13" aria-hidden="true" style="display:block">
                    <rect x="1" y="2" width="14" height="4" rx="1"/>
                    <rect x="1" y="8" width="14" height="4" rx="1"/>
                    <circle cx="12.5" cy="4" r="0.9"/>
                    <circle cx="12.5" cy="10" r="0.9"/>
                  </svg>
                </span>
                <span class="tree-item__label">{engine()?.hostname}</span>
                <span class={`tree-item__badge ${online() ? 'tree-item__badge--online' : 'tree-item__badge--offline'}`}>
                  {online() ? 'online' : 'offline'}
                </span>
                <button
                  class="tree-item__reboot-btn"
                  title={`Reboot ${engine()?.hostname}`}
                  aria-label={`Reboot engine ${engine()?.hostname}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    const eng = engine();
                    if (eng && confirm(`Reboot ${eng.hostname}?`)) {
                      rebootEngine(eng.id);
                    }
                  }}
                >
                  ↺
                </button>
              </div>

              {/* ── Per-disk sub-rows ────────────────────────────── */}
              <For each={diskIds()}>
                {(diskId) => {
                  const disk = () => props.store()?.diskDB[diskId] as Disk | undefined;

                  const isDragOver = () => dropTargetDiskId() === diskId;
                  const isDragTarget = () => props.dragData() !== null
                    && props.dragData()!.sourceDiskId !== diskId;

                  return (
                    <Show when={disk()}>
                      <div
                        class={`tree-item tree-item--disk ${isSelected('disk', diskId) ? 'tree-item--selected' : ''} ${isDragOver() && isDragTarget() ? 'tree-item--drag-over' : ''}`}
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
                          if (props.dragData() && isDragTarget()) {
                            e.preventDefault();
                            setDropTargetDiskId(diskId);
                          }
                        }}
                        onDragLeave={() => {
                          if (dropTargetDiskId() === diskId) setDropTargetDiskId(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDropTargetDiskId(null);
                          const data = props.dragData();
                          if (data && data.sourceDiskId !== diskId) {
                            props.onDrop(data, diskId);
                          }
                        }}
                      >
                        <span class="tree-item__icon">💾</span>
                        <span class="tree-item__label">{disk()?.name}</span>
                        <Show when={diskTypeLabel(disk()!, props.store())}>
                          <span class={`tree-item__type-badge tree-item__type-badge--${diskTypeLabel(disk()!, props.store())}`}>
                            {diskTypeLabel(disk()!, props.store())}
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
                    </Show>
                  );
                }}
              </For>
            </Show>
          );
        }}
      </For>
    </nav>
  );
};

export default NetworkTree;
