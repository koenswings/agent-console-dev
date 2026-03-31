import { createSignal, createEffect, Show, onMount, type Component } from 'solid-js';
import Onboarding from './components/Onboarding';
import NetworkTree from './components/NetworkTree';
import InstanceList from './components/InstanceList';
import { setStoreSignal } from './store/signals';
import { setSendCommandFn } from './store/commands';
import { createMockConnection } from './mock/mockStore';
import { readStoredHostname, readStoredDemoMode } from './components/Onboarding';
import { isProductionWebMode } from './store/engine';
import type { Selection } from './components/NetworkTree';
import type { Store } from './types/store';

const App: Component = () => {
  const [hostname, setHostname] = createSignal('');
  const [store, setStore] = createSignal<Store | null>(null);
  const [connected, setConnected] = createSignal(false);
  const [demo, setDemo] = createSignal(false);
  const [selection, setSelection] = createSignal<Selection>({ type: 'network', id: '' });
  const [showSettings, setShowSettings] = createSignal(false);
  const [ready, setReady] = createSignal(false); // true once storage has been read

  const initConnection = async () => {
    const isDemo = await readStoredDemoMode();
    setDemo(isDemo);

    let connection;
    if (isDemo) {
      connection = createMockConnection();
    } else {
      const { createEngineConnection } = await import('./store/engine');
      connection = await createEngineConnection();
    }

    setSendCommandFn(connection.sendCommand);
    createEffect(() => { const s = connection.store(); setStore(s); setStoreSignal(s); });
    createEffect(() => { setConnected(connection.connected()); });
  };

  onMount(async () => {
    if (isProductionWebMode()) {
      // Served from the Engine — hostname is the URL hostname, no config needed
      const host = window.location.hostname;
      setHostname(host);
      setDemo(false);
      setReady(true);
      await initConnection();
      return;
    }

    const host = await readStoredHostname();
    setHostname(host);
    setReady(true);

    const isDemo = await readStoredDemoMode();
    if (isDemo || host) {
      await initConnection();
    }
  });

  const handleOnboardingComplete = async () => {
    const host = await readStoredHostname();
    setHostname(host);
    setShowSettings(false);
    await initConnection();
  };

  // Show onboarding if: not ready yet, or (no hostname AND not demo), or settings open
  const shouldShowOnboarding = () => {
    if (!ready()) return false; // wait until storage is read
    return showSettings() || (!hostname() && !demo());
  };

  return (
    <div class="app">
      {/* Status bar */}
      <div class="status-bar">
        <span class="status-bar__title">IDEA Console</span>
        <div class="status-bar__indicator">
          <span class={`status-bar__dot ${connected() ? 'status-bar__dot--connected' : 'status-bar__dot--disconnected'}`} />
          <span>
            {demo()
              ? 'Demo mode'
              : connected()
              ? hostname()
              : hostname()
              ? 'Connecting…'
              : 'Not configured'}
          </span>
        </div>
        <Show when={demo()}>
          <span class="status-bar__demo-badge">DEMO</span>
        </Show>
        <button
          class="status-bar__settings-btn"
          title="Settings"
          onClick={() => setShowSettings((v) => !v)}
        >
          {showSettings() ? '✕' : '⚙'}
        </button>
      </div>

      {/* Main content */}
      <Show
        when={!shouldShowOnboarding()}
        fallback={<Onboarding onComplete={handleOnboardingComplete} />}
      >
        <div class="main-layout">
          <NetworkTree selection={selection()} onSelect={setSelection} />
          <InstanceList selection={selection()} store={store} />
        </div>
      </Show>
    </div>
  );
};

export default App;
