import { For, Show, createMemo, type Component } from 'solid-js';
import InstanceRow from './InstanceRow';
import { setStoreSignal } from '../store/signals';
import { engines as enginesSignal } from '../store/signals';
import type { Selection } from './NetworkTree';
import type { Instance, Engine, App, Store } from '../types/store';
import { getInstancesForSelection } from '../store/signals';

// We need to read the raw store to resolve engines for instances
// Import the module-level store signal directly
import { createSignal } from 'solid-js';

// Re-import to avoid circular dep — pull the store signal via a lazy import pattern
let _getStore: () => Store | null = () => null;
export function setStoreGetter(fn: () => Store | null): void {
  _getStore = fn;
}

interface InstanceListProps {
  selection: Selection;
  /** Accessor for the raw Store — passed from App to avoid coupling to global signal */
  store: () => Store | null;
}

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

const findEngine = (store: Store, instance: Instance): Engine | undefined => {
  if (!instance.storedOn) return undefined;
  const disk = store.diskDB[instance.storedOn];
  if (!disk?.dockedTo) return undefined;
  return store.engineDB[disk.dockedTo];
};

const InstanceList: Component<InstanceListProps> = (props) => {
  const instances = createMemo((): Instance[] => {
    const s = props.store();
    if (!s) return [];
    return getInstancesForSelection(s, props.selection);
  });

  const label = createMemo(() => selectionLabel(props.selection, props.store()));

  return (
    <section class="instance-list" aria-label="Instance list">
      <header class="instance-list__header">
        <span class="instance-list__title">{label()}</span>
        <span class="instance-list__count">{instances().length}</span>
      </header>

      <div class="instance-list__body" role="list">
        <Show
          when={instances().length > 0}
          fallback={
            <p class="instance-list__empty">
              No instances
            </p>
          }
        >
          <For each={instances()}>
            {(instance) => {
              const s = props.store();
              const app: App | undefined = s ? s.appDB[instance.instanceOf] : undefined;
              const engine: Engine | undefined = s ? findEngine(s, instance) : undefined;
              return (
                <InstanceRow
                  instance={instance}
                  app={app}
                  engine={engine}
                />
              );
            }}
          </For>
        </Show>
      </div>
    </section>
  );
};

export default InstanceList;
