import { For, Show, createMemo, type Component } from 'solid-js';
import InstanceRow from './InstanceRow';
import { getInstanceIdsForSelection } from '../store/signals';
import type { Selection } from './NetworkTree';
import type { Instance, Engine, Disk, Store } from '../types/store';

// ---------------------------------------------------------------------------
// Pure resolvers (operate on store snapshots)
// ---------------------------------------------------------------------------

const selectionLabel = (selection: Selection, store: Store | null): string => {
  if (selection.type === 'network') return 'All instances';
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
 * Find a docked Backup Disk linked to this instance on the same engine.
 * Returns undefined if no linked backup disk is currently docked.
 */
const resolveBackupDisk = (store: Store | null, instance: Instance | undefined): Disk | undefined => {
  if (!store || !instance) return undefined;
  const engineDisk = instance.storedOn ? store.diskDB[instance.storedOn] : undefined;
  const engineId = engineDisk?.dockedTo;
  if (!engineId) return undefined;
  return Object.values(store.diskDB).find(
    (d) =>
      d.dockedTo === engineId &&
      d.device !== null &&
      (d as any).diskTypes?.includes('backup') &&
      (d as any).backupConfig?.links.includes(instance.id)
  );
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface InstanceListProps {
  selection: Selection;
  /** Accessor for the raw Store — passed from App to avoid coupling to global signal */
  store: () => Store | null;
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
              No instances
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
              const engine     = () => resolveEngine(props.store(), instance());
              const backupDisk = () => resolveBackupDisk(props.store(), instance());

              return (
                <Show when={instance()}>
                  <InstanceRow
                    instance={instance}
                    app={app}
                    engine={engine}
                    backupDisk={backupDisk}
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
