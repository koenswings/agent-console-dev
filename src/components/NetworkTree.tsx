import { For, type Component } from 'solid-js';
import { engines, disksForEngine, isEngineOnline } from '../store/signals';
import { ejectDisk } from '../store/commands';

export interface Selection {
  type: 'network' | 'engine' | 'disk';
  id: string;
}

interface NetworkTreeProps {
  selection: Selection;
  onSelect: (selection: Selection) => void;
}

const NetworkTree: Component<NetworkTreeProps> = (props) => {
  const isSelected = (type: Selection['type'], id: string): boolean =>
    props.selection.type === type && props.selection.id === id;

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
      <For each={engines()}>
        {(engine) => {
          const online = () => isEngineOnline(engine);
          const disks = () => disksForEngine(engine.id);

          return (
            <>
              <div
                class={`tree-item tree-item--engine ${isSelected('engine', engine.id) ? 'tree-item--selected' : ''}`}
                role="treeitem"
                tabIndex={0}
                aria-selected={isSelected('engine', engine.id)}
                onClick={() => props.onSelect({ type: 'engine', id: engine.id })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    props.onSelect({ type: 'engine', id: engine.id });
                  }
                }}
              >
                <span class="tree-item__icon">🖥</span>
                <span class="tree-item__label">{engine.hostname}</span>
                <span class={`tree-item__badge ${online() ? 'tree-item__badge--online' : 'tree-item__badge--offline'}`}>
                  {online() ? 'online' : 'offline'}
                </span>
              </div>

              {/* ── Per-disk sub-rows ────────────────────────────── */}
              <For each={disks()}>
                {(disk) => (
                  <div
                    class={`tree-item tree-item--disk ${isSelected('disk', disk.id) ? 'tree-item--selected' : ''}`}
                    role="treeitem"
                    tabIndex={0}
                    aria-selected={isSelected('disk', disk.id)}
                    onClick={() => props.onSelect({ type: 'disk', id: disk.id })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        props.onSelect({ type: 'disk', id: disk.id });
                      }
                    }}
                  >
                    <span class="tree-item__icon">💾</span>
                    <span class="tree-item__label">{disk.name}</span>
                    <button
                      class="tree-item__eject-btn"
                      title={`Eject ${disk.name}`}
                      aria-label={`Eject disk ${disk.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        ejectDisk(engine.id, disk.name);
                      }}
                    >
                      ⏏
                    </button>
                  </div>
                )}
              </For>
            </>
          );
        }}
      </For>
    </nav>
  );
};

export default NetworkTree;
