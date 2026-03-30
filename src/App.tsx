import { createSignal, createEffect, Show, onMount, type Component } from 'solid-js';
import Onboarding from './components/Onboarding';
import NetworkTree from './components/NetworkTree';
import InstanceList from './components/InstanceList';
import { setStoreSignal } from './store/signals';
import { setSendCommandFn } from './store/commands';
import { createMockConnection } from './mock/mockStore';
import { readStoredHostname } from './components/Onboarding';
import type { Selection } from './components/NetworkTree';
import type { Store } from './types/store';

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------
const App: Component = () => {
  const [hostname, setHostname] = createSignal(readStoredHostname());
  const [store, setStore] = createSignal<Store | null>(null);
  const [connected, setConnected] = createSignal(false);
  const [selection, setSelection] = createSignal<Selection>({ type: 'network', id: '' });
  const [showSettings, setShowSettings] = createSignal(false);

  // Initialise store connection once the hostname is known
  const initConnection = async (host: string) => {
    if (!host) return;

    let connection;

    if (import.meta.env.DEV) {
      // Dev mode: always use mock store
      connection = createMockConnection();
    } else {
      // Production: use real Automerge connection
      const { createEngineConnection } = await import('./store/engine');
      connection = await createEngineConnection();
    }

    setSendCommandFn(connection.sendCommand);

    createEffect(() => {
      const s = connection.store();
      setStore(s);
      setStoreSignal(s);
    });

    createEffect(() => {
      setConnected(connection.connected());
    });
  };

  onMount(async () => {
    // Also check chrome.storage.local in extension mode
    let host = readStoredHostname();
    if (!host) {
      try {
        const result = await chrome.storage.local.get('engineHostname');
        host = (result['engineHostname'] as string) ?? '';
        if (host) setHostname(host);
      } catch {
        // not in extension context
      }
    }

    if (host) {
      await initConnection(host);
    }
  });

  const handleOnboardingComplete = async () => {
    const host = readStoredHostname();
    setHostname(host);
    setShowSettings(false);
    await initConnection(host);
  };

  // Show onboarding if: no hostname configured, OR settings explicitly opened
  const shouldShowOnboarding = () => !hostname() || showSettings();

  return (
    <div class="app">
      {/* ── Connection status bar ─────────────────────────────────── */}
      <div class="status-bar">
        <span class="status-bar__title">IDEA Console</span>
        <div class="status-bar__indicator">
          <span
            class={`status-bar__dot ${
              connected() ? 'status-bar__dot--connected' : 'status-bar__dot--disconnected'
            }`}
          />
          <span>
            {connected()
              ? hostname()
              : hostname()
              ? 'Connecting…'
              : 'Not configured'}
          </span>
        </div>
        {/* Settings button — always visible once a hostname is configured */}
        <Show when={hostname()}>
          <button
            class="status-bar__settings-btn"
            title="Change engine settings"
            onClick={() => setShowSettings((v) => !v)}
          >
            {showSettings() ? '✕' : '⚙'}
          </button>
        </Show>
      </div>

      {/* ── Main content ──────────────────────────────────────────── */}
      <Show
        when={!shouldShowOnboarding()}
        fallback={<Onboarding onComplete={handleOnboardingComplete} />}
      >
        <div class="main-layout">
          <NetworkTree
            selection={selection()}
            onSelect={setSelection}
          />
          <InstanceList
            selection={selection()}
            store={store}
          />
        </div>
      </Show>
    </div>
  );
};

export default App;
