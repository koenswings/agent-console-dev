import { For, Show, createMemo, type Accessor, type Component } from 'solid-js';
import InstanceRow from './InstanceRow';
import { getInstanceIdsForSelection } from '../store/signals';
import type { Selection } from './NetworkTree';
import type { Instance, Engine, Disk, Store } from '../types/store';
import type { CommandLogStore } from '../types/commandLog';
import type { DragAppData } from '../types/drag';

// ---------------------------------------------------------------------------
// Pure resolvers (operate on store snapshots)
// ---------------------------------------------------------------------------

const selectionLabel = (selection: Selection, store: Store | null): string => {
  if (selection.type === 'network') return 'All apps';
  if (selection.type === 'engine' && store) {
    const engine = store.engineDB[selection.id];
    return engine ? engine.hostname : selection.id;
  }
  if (selection.type === 'disk' && store) {
    const disk = store.diskDB[selection.id];
    return disk ? disk.name : selection.id;
  }
  return selection.id;
};

const resolveEngine = (store: Store | null, instance: Instance | undefined): Engine | undefined => {
  if (!store || !instance?.storedOn) return undefined;
  const disk = store.diskDB[instance.storedOn];
  if (!disk?.dockedTo) return undefined;
  return store.engineDB[disk.dockedTo];
};

/**
 * Find all docked Backup Disks linked to this instance on the same engine.
 * Returns an empty array if no linked backup disks are currently docked.
 */
const resolveBackupDisks = (store: Store | null, instance: Instance | undefined): Disk[] => {
  if (!store || !instance) return [];
  const engineDisk = instance.storedOn ? store.diskDB[instance.storedOn] : undefined;
  const engineId = engineDisk?.dockedTo;
  if (!engineId) return [];
  return Object.values(store.diskDB).filter(
    (d) =>
      String(d.dockedTo) === String(engineId) &&
      d.device !== null &&
      d.diskTypes?.includes('backup') &&
      d.backupConfig?.links.includes(instance.id)
  );
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface InstanceListProps {
  selection: Selection;
  /** Accessor for the raw Store — passed from App to avoid coupling to global signal */
  store: () => Store | null;
  /** Command log store — threaded down to InstanceRow for trace log display. */
  commandLogStore?: Accessor<CommandLogStore | null>;
  /** Called when a drag starts on an app row. */
  onDragStart?: (data: DragAppData) => void;
  /** Called when a drag ends (dropped or cancelled). */
  onDragEnd?:   () => void;
}

const InstanceList: Component<InstanceListProps> = (props) => {
  // List of IDs — Solid's <For> uses string identity to reuse scopes.
  // Only IDs added/removed cause scope creation/destruction; unchanged IDs
  // keep their scopes alive and only the reactive reads inside each row update.
  const instanceIds = createMemo((): string[] => {
    const s = props.store();
    if (!s) return [];
    return getInstanceIdsForSelection(s, props.selection);
  });

  const label = createMemo(() => selectionLabel(props.selection, props.store()));

  return (
    <section class="instance-list" aria-label="Instance list">
      <header class="instance-list__header">
        <span class="instance-list__title">{label()}</span>
        <span class="instance-list__count">{instanceIds().length}</span>
      </header>

      <div class="instance-list__body" role="list">
        <Show
          when={instanceIds().length > 0}
          fallback={
            <p class="instance-list__empty">
              No apps
            </p>
          }
        >
          <For each={instanceIds()}>
            {(id) => {
              // Each accessor reads fresh from the store when called.
              // Solid tracks these reads — only this row updates when its data changes.
              const instance = () => props.store()?.instanceDB[id];
              const app      = () => {
                const inst = instance();
                return inst ? props.store()?.appDB[inst.instanceOf] : undefined;
              };
              const engine      = () => resolveEngine(props.store(), instance());
              const backupDisks = () => resolveBackupDisks(props.store(), instance());

              return (
                <Show when={instance()}>
                  <InstanceRow
                    instance={instance}
                    app={app}
                    engine={engine}
                    backupDisks={backupDisks}
                    instanceId={id}
                    store={props.store}
                    commandLogStore={props.commandLogStore}
                    onDragStart={props.onDragStart}
                    onDragEnd={props.onDragEnd}
                  />
                </Show>
              );
            }}
          </For>
        </Show>
      </div>
    </section>
  );
};

export default InstanceList;
