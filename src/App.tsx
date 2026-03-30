import { createSignal, createEffect, Show, onMount, type Component } from 'solid-js';
import Onboarding from './components/Onboarding';
import NetworkTree from './components/NetworkTree';
import InstanceList from './components/InstanceList';
import { setStoreSignal } from './store/signals';
import { setSendCommandFn } from './store/commands';
import { createMockConnection } from './mock/mockStore';
import type { Selection } from './components/NetworkTree';
import type { Store } from './types/store';

const STORAGE_KEY_HOSTNAME = 'engineHostname';

// ---------------------------------------------------------------------------
// Detect whether a hostname has been configured
// ---------------------------------------------------------------------------
const getStoredHostname = (): string => localStorage.getItem(STORAGE_KEY_HOSTNAME) ?? '';

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------
const App: Component = () => {
  const [hostname, setHostname] = createSignal(getStoredHostname());
  const [store, setStore] = createSignal<Store | null>(null);
  const [connected, setConnected] = createSignal(false);
  const [selection, setSelection] = createSignal<Selection>({ type: 'network', id: '' });

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

    // Bridge connection signals to the module-level signals
    setSendCommandFn(connection.sendCommand);

    // Keep module-level signals in sync with the connection
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
    // Also try chrome.storage.local (extension mode)
    let host = getStoredHostname();
    if (!host) {
      try {
        const result = await chrome.storage.local.get(STORAGE_KEY_HOSTNAME);
        host = (result[STORAGE_KEY_HOSTNAME] as string) ?? '';
        if (host) setHostname(host);
      } catch {
        // Not in extension context
      }
    }

    if (host) {
      await initConnection(host);
    }
  });

  const handleOnboardingComplete = async () => {
    const host = getStoredHostname();
    setHostname(host);
    await initConnection(host);
  };

  const displayHostname = () => {
    const host = hostname();
    return host || 'Not connected';
  };

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
              ? displayHostname()
              : hostname()
              ? 'Connecting…'
              : 'Not configured'}
          </span>
        </div>
      </div>

      {/* ── Main content ──────────────────────────────────────────── */}
      <Show
        when={hostname()}
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
