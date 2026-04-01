import { For, Show, type Component } from 'solid-js';
import type { Store } from '../types/store';
import AppCard from './AppCard';

interface AppBrowserProps {
  store: Store | null;
  onLogin: () => void;
}

const AppBrowser: Component<AppBrowserProps> = (props) => {
  const instances = () => {
    const s = props.store;
    if (!s) return [];
    return Object.values(s.instanceDB);
  };

  // Resolve the engine hostname for an instance via disk → engine chain
  const hostnameForInstance = (instanceId: string): string => {
    const s = props.store;
    if (!s) return 'localhost';
    const inst = s.instanceDB[instanceId];
    if (!inst?.storedOn) return 'localhost';
    const disk = s.diskDB[inst.storedOn];
    if (!disk?.dockedTo) return 'localhost';
    const engine = s.engineDB[disk.dockedTo];
    return engine?.hostname ?? 'localhost';
  };

  return (
    <div class="app-browser">
      <div class="app-browser__header">
        <h1 class="app-browser__title">Apps</h1>
        <button class="app-browser__login-link" onClick={props.onLogin}>
          Log in
        </button>
      </div>

      <Show
        when={instances().length > 0}
        fallback={
          <div class="app-browser__empty">
            No apps available on this network yet.
          </div>
        }
      >
        <div class="app-browser__grid">
          <For each={instances()}>
            {(instance) => (
              <AppCard
                instance={instance}
                app={props.store?.appDB[instance.instanceOf]}
                engineHostname={hostnameForInstance(instance.id)}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default AppBrowser;
