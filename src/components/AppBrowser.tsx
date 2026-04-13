import { For, Show, createMemo, type Component } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { Store } from '../types/store';
import AppCard from './AppCard';

interface AppBrowserProps {
  store: Accessor<Store | null>;
  onLogin: () => void;
}

const AppBrowser: Component<AppBrowserProps> = (props) => {
  // Resolve the engine hostname for an instance via disk → engine chain
  const hostnameForInstance = (instanceId: string): string => {
    const store = props.store();
    if (!store) return 'localhost';
    const inst = store.instanceDB[instanceId];
    if (!inst?.storedOn) return 'localhost';
    const disk = store.diskDB[inst.storedOn];
    if (!disk?.dockedTo) return 'localhost';
    const engine = store.engineDB[disk.dockedTo];
    return engine?.hostname ?? 'localhost';
  };

  // ID list of all instances (Running and non-Running alike).
  // AppCard shows non-running apps as greyed-out/unavailable.
  const instanceIds = createMemo(() =>
    Object.keys(props.store()?.instanceDB ?? {})
  );

  return (
    <div class="app-browser">
      <div class="app-browser__header">
        <h1 class="app-browser__title">Apps</h1>
        <button class="app-browser__login-link" onClick={props.onLogin}>
          Log in
        </button>
      </div>

      <Show
        when={instanceIds().length > 0}
        fallback={
          <div class="app-browser__empty">
            No apps available on this network yet.
          </div>
        }
      >
        <div class="app-browser__grid">
          <For each={instanceIds()}>
            {(id) => {
              // Each accessor reads fresh from the store when called.
              // Solid tracks these reads — only this card updates when its data changes.
              const instance = () => props.store()?.instanceDB[id];
              const app = () => {
                const inst = instance();
                return inst ? props.store()?.appDB[inst.instanceOf] : undefined;
              };
              const hostname = () => hostnameForInstance(id);

              return (
                <AppCard
                  instance={instance}
                  app={app}
                  engineHostname={hostname}
                />
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default AppBrowser;
