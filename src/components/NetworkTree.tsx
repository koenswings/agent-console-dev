import { For, Show, createMemo, type Component } from 'solid-js';
import { isEngineOnline } from '../store/signals';
import { ejectDisk } from '../store/commands';
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
  const dt = (disk as any).diskTypes as DiskType[] | undefined;
  if (!dt || dt.length === 0) return null;
  return DISK_TYPE_LABEL[dt[0]] ?? null;
};

/** Returns true when the eject button should be shown (never on backup disks). */
const canEject = (disk: Disk): boolean =>
  disk.device !== null && !((disk as any).diskTypes ?? []).includes('backup');

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

const NetworkTree: Component<NetworkTreeProps> = (props) => {
  const isSelected = (type: Selection['type'], id: string): boolean =>
    props.selection.type === type && props.selection.id === id;

  // ID list — stable strings so <For> reuses scopes on store updates
  const engineIds = createMemo(() =>
    Object.keys(props.store()?.engineDB ?? {})
  );

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
                  return (
                    <Show when={disk()}>
                      <div
                        class={`tree-item tree-item--disk ${isSelected('disk', diskId) ? 'tree-item--selected' : ''}`}
                        role="treeitem"
                        tabIndex={0}
                        aria-selected={isSelected('disk', diskId)}
                        onClick={() => props.onSelect({ type: 'disk', id: diskId })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            props.onSelect({ type: 'disk', id: diskId });
                          }
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
                            title={`Eject ${disk()?.name}`}
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
