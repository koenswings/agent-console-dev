import { createSignal, createEffect, Show, onMount, type Component } from 'solid-js';
import Onboarding from './components/Onboarding';
import NetworkTree from './components/NetworkTree';
import InstanceList from './components/InstanceList';
import AppBrowser from './components/AppBrowser';
import LoginForm from './components/LoginForm';
import FirstTimeSetup from './components/FirstTimeSetup';
import OperatorManagement from './components/OperatorManagement';
import { setStoreSignal } from './store/signals';
import { setSendCommandFn } from './store/commands';
import {
  currentUser,
  isOperator,
  isFirstTimeSetup,
  logout,
  restoreSession,
} from './store/auth';
import { createMockConnection } from './mock/mockStore';
import type { StoreConnection } from './mock/mockStore';
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
  const [showLogin, setShowLogin] = createSignal(false);
  const [showOperatorMgmt, setShowOperatorMgmt] = createSignal(false);
  const [ready, setReady] = createSignal(false);
  const [connection, setConnection] = createSignal<StoreConnection | null>(null);

  const initConnection = async () => {
    const isDemo = await readStoredDemoMode();
    setDemo(isDemo);

    let conn: StoreConnection;
    if (isDemo) {
      conn = createMockConnection();
    } else {
      const { createEngineConnection } = await import('./store/engine');
      conn = await createEngineConnection();
    }

    setConnection(conn);
    setSendCommandFn(conn.sendCommand);

    createEffect(() => {
      const s = conn.store();
      setStore(s);
      setStoreSignal(s);
    });
    createEffect(() => { setConnected(conn.connected()); });

    // Restore session once store is populated
    createEffect(() => {
      const s = conn.store();
      if (s) restoreSession(s);
    });
  };

  onMount(async () => {
    if (isProductionWebMode()) {
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

  const handleLogout = async () => {
    await logout();
    setShowOperatorMgmt(false);
  };

  // Show onboarding if: settings open or (no hostname AND not demo)
  const shouldShowOnboarding = () => {
    if (!ready()) return false;
    return showSettings() || (!hostname() && !demo());
  };

  // Show first-time setup if: store loaded and no operators exist yet
  // Applies in demo mode too — demo starts with empty userDB to show the real first-run flow
  const shouldShowFirstTimeSetup = () => {
    if (!ready()) return false;
    return isFirstTimeSetup(store());
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

        {/* Auth controls */}
        <Show
          when={isOperator()}
          fallback={
            <Show when={!shouldShowOnboarding() && !shouldShowFirstTimeSetup()}>
              {/* Login link shown in user mode — not shown during onboarding/setup */}
            </Show>
          }
        >
          <span class="status-bar__username">{currentUser()?.username}</span>
          <button
            class="status-bar__operator-mgmt-btn"
            title="Manage operators"
            onClick={() => setShowOperatorMgmt((v) => !v)}
          >
            {showOperatorMgmt() ? '✕' : '👥'}
          </button>
          <button class="status-bar__logout-btn" onClick={handleLogout}>
            Log out
          </button>
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
        <Show
          when={!shouldShowFirstTimeSetup()}
          fallback={
            <Show when={store() && connection()}>
              <FirstTimeSetup
                store={store()!}
                connection={connection()!}
                onComplete={() => setShowLogin(false)}
              />
            </Show>
          }
        >
          <Show
            when={isOperator()}
            fallback={
              <>
                <AppBrowser
                  store={store()}
                  onLogin={() => setShowLogin(true)}
                />
                <Show when={showLogin()}>
                  <LoginForm
                    store={store()}
                    onSuccess={() => setShowLogin(false)}
                    onCancel={() => setShowLogin(false)}
                  />
                </Show>
              </>
            }
          >
            {/* Operator mode */}
            <Show
              when={showOperatorMgmt() && store() && connection()}
              fallback={
                <div class="main-layout">
                  <NetworkTree selection={selection()} onSelect={setSelection} />
                  <InstanceList selection={selection()} store={store} />
                </div>
              }
            >
              <OperatorManagement store={store()!} connection={connection()!} />
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  );
};

export default App;
