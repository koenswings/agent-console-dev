import { For, Show, createMemo, createSignal, type Component } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { Engine, Store } from '../types/store';
import AppCard from './AppCard';
import { buildAppUrl, appHostContextFor } from '../store/appUrl';
import { sharedHiddenInstances, type HiddenInstancesLoader } from '../store/hiddenInstances';

interface AppBrowserProps {
  store: Accessor<Store | null>;
  connected: () => boolean;
  onLogin?: () => void;
  /** Hide-list loader (idea#212); injectable for tests. */
  loadHidden?: HiddenInstancesLoader;
}

const AppBrowser: Component<AppBrowserProps> = (props) => {
  // Page context (engine count, page Engine id) — shared by every card.
  const hostCtx = createMemo(() => appHostContextFor(props.store()));

  // Engine of an instance via disk → engine chain.
  const engineForInstance = (instanceId: string): Engine | undefined => {
    const store = props.store();
    const inst = store?.instanceDB[instanceId];
    const disk = inst?.storedOn ? store?.diskDB[inst.storedOn] : undefined;
    return disk?.dockedTo ? store?.engineDB[disk.dockedTo] : undefined;
  };

  // Open link for an instance; null = button disabled.
  const urlForInstance = (instanceId: string): string | null => {
    const inst = props.store()?.instanceDB[instanceId];
    const engine = engineForInstance(instanceId);
    if (!inst || !engine) return null;
    return buildAppUrl(engine, inst.port, hostCtx());
  };

  // ID list of all instances (Running and non-Running alike).
  // AppCard shows non-running apps as greyed-out/unavailable.
  // Instances on the optional hide list (idea#212) are left out.
  const [hidden, setHidden] = createSignal<ReadonlySet<string>>(new Set());
  void (props.loadHidden ?? sharedHiddenInstances)().then((ids) => setHidden(new Set(ids)));
  const instanceIds = createMemo(() =>
    Object.keys(props.store()?.instanceDB ?? {}).filter((id) => !hidden().has(id))
  );

  return (
    <div class="app-browser" data-testid="console-overview">
      <div class="app-browser__header">
        <h1 class="app-browser__title">Apps</h1>
      </div>

      <Show
        when={instanceIds().length > 0}
        fallback={
          <Show when={props.connected()}>
            <div class="app-browser__empty">
              No apps available on this network yet.
            </div>
          </Show>
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
              const url = () => urlForInstance(id);
              const engine = () => engineForInstance(id);

              return (
                <AppCard
                  instance={instance}
                  app={app}
                  appUrl={url}
                  engine={engine}
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
