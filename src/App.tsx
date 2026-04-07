import { createSignal, createEffect, Show, onMount, type Component } from 'solid-js';
import Onboarding from './components/Onboarding';
import NetworkTree from './components/NetworkTree';
import InstanceList from './components/InstanceList';
import AppBrowser from './components/AppBrowser';
import LoginForm from './components/LoginForm';
import FirstTimeSetup from './components/FirstTimeSetup';
import OperatorManagement from './components/OperatorManagement';
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
import { readStoredHostname, readStoredDemoMode, saveHostnameAndStoreUrl } from './components/Onboarding';
import { isProductionWebMode } from './store/engine';
import { discoverAllEngines, type DiscoveryResult } from './store/discovery';
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
  const [discovering, setDiscovering] = createSignal(false);
  const [discoveryResults, setDiscoveryResults] = createSignal<DiscoveryResult[]>([]);

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
      // Has memory of a previous connection (or demo mode) — connect directly
      await initConnection();
    } else {
      // No previous connection — show onboarding and scan in background
      runDiscovery();
    }
  });

  const runDiscovery = () => {
    setDiscovering(true);
    setDiscoveryResults([]);
    discoverAllEngines().then(async (results) => {
      setDiscovering(false);
      if (results.length === 1) {
        // Single engine found — auto-connect silently
        await handleDiscoverySelect(results[0]);
      } else {
        // 0 = form, 2+ = picker (passed to Onboarding via signal)
        setDiscoveryResults(results);
      }
    });
  };

  const handleDiscoverySelect = async (result: DiscoveryResult) => {
    await saveHostnameAndStoreUrl(result.hostname, result.storeUrl);
    setHostname(result.hostname);
    setDiscoveryResults([]);
    await initConnection();
  };

  // Reconnect after failure: clear hostname and re-scan
  const handleConnectionFailure = async () => {
    setHostname('');
    localStorage.removeItem('engineHostname');
    try { await (window as any).chrome?.storage?.local?.remove('engineHostname'); } catch {}
    runDiscovery();
  };

  // Watch for disconnection after initial connect and trigger re-scan
  createEffect(() => {
    const isConn = connected();
    const host = hostname();
    // Only re-scan if we had a hostname, lost connection, and are not in demo/production mode
    if (!isConn && host && !demo() && !isProductionWebMode()) {
      // Debounce: wait 15s before re-scanning to avoid flapping on brief blips
      const timer = setTimeout(() => {
        if (!connected() && hostname()) {
          handleConnectionFailure();
        }
      }, 15_000);
      return () => clearTimeout(timer);
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
          <span class={`status-bar__dot ${
            connected()
              ? 'status-bar__dot--connected'
              : (discovering() || (hostname() && !demo()))
              ? 'status-bar__dot--searching'
              : 'status-bar__dot--disconnected'
          }`} />
          <span>
            {connected()
              ? hostname()          // connected: show hostname
              : demo()
              ? ''                  // demo: badge already shows it, no duplicate text
              : discovering()
              ? 'Scanning…'        // scanning the network
              : hostname()
              ? 'Connecting…'      // hostname known, waiting for sync
              : 'No engine found'   // scan done, nothing responded
            }
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
        fallback={
          <Onboarding
            onComplete={handleOnboardingComplete}
            discovering={discovering()}
            discoveryResults={discoveryResults()}
            onDiscoverySelect={handleDiscoverySelect}
          />
        }
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
                  <NetworkTree selection={selection()} onSelect={setSelection} store={store} />
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
