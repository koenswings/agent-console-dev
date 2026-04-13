import { createSignal, createEffect, Show, onMount, type Component } from 'solid-js';
import Onboarding from './components/Onboarding';
import SettingsPanel from './components/SettingsPanel';
import NetworkTree from './components/NetworkTree';
import InstanceList from './components/InstanceList';
import EmptyDiskPanel from './components/EmptyDiskPanel';
import RestorePanel from './components/RestorePanel';
import OperationProgress from './components/OperationProgress';
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
  createOperator,
  setAuthenticatedUser,
} from './store/auth';
import { createMockConnection } from './mock/mockStore';
import type { StoreConnection } from './mock/mockStore';
import { readStoredHostname, readStoredDemoMode, saveHostnameAndStoreUrl, saveDemoMode } from './components/Onboarding';
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
  const [sessionRestored, setSessionRestored] = createSignal(false);
  const [connection, setConnection] = createSignal<StoreConnection | null>(null);
  const [discovering, setDiscovering] = createSignal(false);
  const [discoveryResults, setDiscoveryResults] = createSignal<DiscoveryResult[]>([]);

  // Derive store and connected from the connection signal reactively.
  // These effects run at the top level — they are created once and track the
  // connection() signal, so when initConnection() sets a new connection they
  // automatically pick up the new one. No more effects created inside async fns.
  createEffect(() => {
    const conn = connection();
    if (!conn) return;
    setStore(conn.store());
    setConnected(conn.connected());
    setSendCommandFn(conn.sendCommand);
  });

  // Separately track live store changes from the current connection
  createEffect(() => {
    const conn = connection();
    if (!conn) return;
    // Subscribe to the store signal on the current connection
    const s = conn.store();
    setStore(s);
  });

  createEffect(() => {
    const conn = connection();
    if (!conn) return;
    setConnected(conn.connected());
  });

  // Restore session when store first becomes available, then mark done.
  // If store never loads (engine offline), still mark restored after 3s so login button works.
  let sessionRestoreRan = false;
  createEffect(() => {
    const conn = connection();
    if (!conn) return;
    const s = conn.store();
    if (s && !sessionRestoreRan) {
      sessionRestoreRan = true;
      restoreSession(s).then(() => setSessionRestored(true)).catch(() => setSessionRestored(true));
    }
  });

  // Auto-provision default operator when real engine store has no users.
  // This runs once per connection when the store first syncs with an empty userDB.
  // Creates admin/admin911! so the operator can log in without first-time setup.
  let provisioningRan = false;
  createEffect(() => {
    const s = store();
    const conn = connection();
    if (!s || !conn || demo() || isOperator() || provisioningRan) return;
    if (!isFirstTimeSetup(s)) return; // userDB already has users
    provisioningRan = true;
    const DEFAULT_USERNAME = 'admin';
    const DEFAULT_PASSWORD = 'admin911!';
    createOperator(DEFAULT_USERNAME, DEFAULT_PASSWORD, s, conn.changeDoc)
      .then((user) => {
        console.log('[app] Auto-provisioned default operator:', DEFAULT_USERNAME);
        return setAuthenticatedUser(user);
      })
      .catch((err) => {
        // Might fail if another tab provisioned at the same time — not fatal
        console.warn('[app] Auto-provision skipped:', err.message);
        provisioningRan = false;
      });
  });

  // Fallback: if store never arrives (engine slow/offline), unblock login after 3s
  createEffect(() => {
    const conn = connection();
    if (!conn) return;
    if (sessionRestored()) return;
    const timer = setTimeout(() => setSessionRestored(true), 3000);
    return () => clearTimeout(timer);
  });

  const initConnection = async () => {
    // Reset session state for new connection
    sessionRestoreRan = false;
    setSessionRestored(false);
    provisioningRan = false;
    setStore(null);
    setConnected(false);

    const isDemo = await readStoredDemoMode();
    setDemo(isDemo);

    let conn: StoreConnection;
    if (isDemo) {
      conn = createMockConnection();
    } else {
      const { createEngineConnection } = await import('./store/engine');
      conn = await createEngineConnection();
    }

    // Setting the connection signal triggers the top-level createEffects above
    setConnection(conn);
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
    } else {
      runDiscovery();
    }
  });

  const runDiscovery = () => {
    setDiscovering(true);
    setDiscoveryResults([]);
    discoverAllEngines().then(async (results) => {
      setDiscovering(false);
      if (results.length === 1) {
        await handleDiscoverySelect(results[0]);
      } else {
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

  const handleConnectionFailure = async () => {
    setHostname('');
    localStorage.removeItem('engineHostname');
    runDiscovery();
  };

  // Watch for disconnection and trigger re-scan after debounce
  createEffect(() => {
    const isConn = connected();
    const host = hostname();
    if (!isConn && host && !demo() && !isProductionWebMode()) {
      const timer = setTimeout(() => {
        if (!connected() && hostname()) handleConnectionFailure();
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

  const handleReconnect = async () => {
    const host = await readStoredHostname();
    setHostname(host);
    await initConnection();
  };

  const handleLogout = async () => {
    await logout();
    setShowOperatorMgmt(false);
  };

  const shouldShowOnboarding = () => {
    if (!ready()) return false;
    return !hostname() && !demo();
  };

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
              ? hostname()
              : demo()
              ? ''
              : discovering()
              ? 'Scanning…'
              : hostname()
              ? 'Connecting…'
              : 'No engine found'
            }
          </span>
        </div>
        <Show when={demo()}>
          <span class="status-bar__demo-badge">DEMO</span>
        </Show>

        <Show when={isOperator()}>
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
        when={!shouldShowOnboarding() && !showSettings()}
        fallback={
          showSettings()
            ? <SettingsPanel
                store={store()}
                connection={connection()}
                hostname={hostname()}
                demo={demo()}
                onClose={() => setShowSettings(false)}
                onComplete={handleOnboardingComplete}
                onConnect={async (h, s) => {
                  await saveDemoMode(false);
                  await saveHostnameAndStoreUrl(h, s);
                  setHostname(h);
                  setShowSettings(false);
                  // Clear any stale session from a previous connection (e.g. demo)
                  await logout();
                  await initConnection();
                }}
                onDemoMode={async () => {
                  await saveDemoMode(true);
                  // Clear any stale session from real engine
                  await logout();
                  await handleReconnect();
                }}
              />
            : <Onboarding
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
                  store={store}
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
            <Show
              when={showOperatorMgmt() && store() && connection()}
              fallback={
                <div class="main-layout">
                  <NetworkTree selection={selection()} onSelect={setSelection} store={store} />
                  <div class="main-layout__right">
                    <OperationProgress store={store} />
                    <Show
                      when={
                        selection().type === 'disk' &&
                        store()?.diskDB[selection().id]?.diskTypes?.includes('empty') === true
                      }
                    >
                      <EmptyDiskPanel
                        disk={() => store()?.diskDB[selection().id]}
                        store={store}
                        engineId={() => store()?.diskDB[selection().id]?.dockedTo ?? undefined}
                      />
                    </Show>
                    <Show
                      when={
                        selection().type === 'disk' &&
                        store()?.diskDB[selection().id]?.diskTypes?.includes('backup') === true
                      }
                    >
                      <RestorePanel
                        disk={() => store()?.diskDB[selection().id]}
                        store={store}
                        engineId={() => store()?.diskDB[selection().id]?.dockedTo ?? undefined}
                      />
                    </Show>
                    <Show
                      when={
                        !(
                          selection().type === 'disk' &&
                          (store()?.diskDB[selection().id]?.diskTypes?.includes('empty') ||
                            store()?.diskDB[selection().id]?.diskTypes?.includes('backup'))
                        )
                      }
                    >
                      <InstanceList selection={selection()} store={store} />
                    </Show>
                  </div>
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
