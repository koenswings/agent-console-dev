import { createSignal, createEffect, Show, Switch, Match, onMount, onCleanup, batch, type Component } from 'solid-js';
import pkg from '../package.json';
import Onboarding from './components/Onboarding';
import SettingsPanel from './components/SettingsPanel';
import NetworkTree from './components/NetworkTree';
import InstanceList from './components/InstanceList';
import EmptyDiskPanel from './components/EmptyDiskPanel';
import RestorePanel from './components/RestorePanel';
import OperationProgress from './components/OperationProgress';
import HistoryPanel from './components/HistoryPanel';
import AppBrowser from './components/AppBrowser';
import MobileLayout from './components/MobileLayout';
import LoginForm from './components/LoginForm';
import FirstTimeSetup from './components/FirstTimeSetup';
import OperatorManagement from './components/OperatorManagement';
import { setSendCommandFn, copyApp, moveApp } from './store/commands';
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
import { discoverAllEngines, DISCOVERY_REFRESH_INTERVAL_MS, type DiscoveryResult } from './store/discovery';
import type { Selection } from './components/NetworkTree';
import type { Store } from './types/store';
import type { CommandLogState } from './store/commandLog';
import type { DragAppData } from './types/drag';

// ---------------------------------------------------------------------------
// Which panel to show in the right-hand main content pane.
// ---------------------------------------------------------------------------
type RightPanel = 'empty-disk' | 'backup-disk' | 'instances';

function rightPanelFor(selection: Selection, store: Store | null): RightPanel {
  if (selection.type !== 'disk' || !store) return 'instances';
  const disk = store.diskDB[selection.id];
  // backup disks always show the restore panel
  if (disk?.diskTypes?.includes('backup')) return 'backup-disk';
  // Only treat as empty if there are genuinely no instances stored on it.
  // The Engine sometimes tags a disk 'empty' even after instances are installed.
  const hasInstances = Object.values(store.instanceDB ?? {}).some(
    (inst) => String(inst.storedOn) === selection.id
  );
  if (!hasInstances && disk?.diskTypes?.includes('empty')) return 'empty-disk';
  return 'instances';
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const App: Component = () => {
  // ── Connection state ──────────────────────────────────────────────────────
  const [hostname, setHostname] = createSignal('');
  const [store, setStore] = createSignal<Store | null>(null);
  const [connected, setConnected] = createSignal(false);
  const [commandLogStore, setCommandLogStore] = createSignal<CommandLogState>(null);
  const [demo, setDemo] = createSignal(false);
  const [connection, setConnection] = createSignal<StoreConnection | null>(null);
  const [discovering, setDiscovering] = createSignal(false);
  const [discoveryResults, setDiscoveryResults] = createSignal<DiscoveryResult[]>([]);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [ready, setReady] = createSignal(false);
  const [selection, setSelection] = createSignal<Selection>({ type: 'network', id: '' });
  const [showSettings, setShowSettings] = createSignal(false);
  const [showHistory, setShowHistory] = createSignal(false);
  const [showLogin, setShowLogin] = createSignal(false);
  const [showOperatorMgmt, setShowOperatorMgmt] = createSignal(false);
  const [sessionRestored, setSessionRestored] = createSignal(false);

  // ── Mobile breakpoint ─────────────────────────────────────────────────────
  const [isMobile, setIsMobile] = createSignal(window.innerWidth <= 600);
  onMount(() => {
    const handler = () => setIsMobile(window.innerWidth <= 600);
    window.addEventListener('resize', handler);
    onCleanup(() => window.removeEventListener('resize', handler));
  });

  // ── Drag-and-drop state (lifted here so NetworkTree and InstanceList share it)
  const [dragData, setDragData] = createSignal<DragAppData | null>(null);

  interface PendingMove {
    data: DragAppData;
    targetDiskId: string;
    targetDiskName: string;
    targetEngineHostname: string;
  }
  const [pendingMove, setPendingMove] = createSignal<PendingMove | null>(null);

  const handleDrop = (data: DragAppData, targetDiskId: string) => {
    const s = store();
    if (!s) return;
    const targetDisk = s.diskDB[targetDiskId];
    if (!targetDisk?.dockedTo) return;
    const targetEngine = s.engineDB[String(targetDisk.dockedTo)];
    setPendingMove({
      data,
      targetDiskId,
      targetDiskName: String(targetDisk.name),
      targetEngineHostname: targetEngine ? String(targetEngine.hostname) : String(targetDisk.dockedTo),
    });
  };

  const handleCopyMoveChoice = (op: 'copy' | 'move') => {
    const pending = pendingMove();
    if (!pending) return;
    const s = store();
    // Command must go to the SOURCE engine — it is the one running rsync
    const sourceDisk = s?.diskDB[pending.data.sourceDiskId];
    if (!sourceDisk?.dockedTo) return;
    const engineId = String(sourceDisk.dockedTo);
    if (op === 'copy') {
      copyApp(engineId, pending.data.instanceName, pending.data.sourceDiskId, pending.targetDiskId);
    } else {
      moveApp(engineId, pending.data.instanceName, pending.data.sourceDiskId, pending.targetDiskId);
    }
    setPendingMove(null);
    setDragData(null);
  };

  // ── Reactive sync from connection → store / connected signals ─────────────
  createEffect(() => {
    const conn = connection();
    if (!conn) return;
    setStore(conn.store());
    setConnected(conn.connected());
    setSendCommandFn(conn.sendCommand);
    setCommandLogStore(conn.commandLogStore());
  });

  createEffect(() => {
    const conn = connection();
    if (!conn) return;
    setStore(conn.store());
  });

  createEffect(() => {
    const conn = connection();
    if (!conn) return;
    setConnected(conn.connected());
  });

  createEffect(() => {
    const conn = connection();
    if (!conn) return;
    setCommandLogStore(conn.commandLogStore());
  });

  // ── Session restore (once per connection, when store first arrives) ───────
  let sessionRestoreRan = false;
  createEffect(() => {
    const conn = connection();
    if (!conn) return;
    const s = conn.store();
    if (s && !sessionRestoreRan) {
      sessionRestoreRan = true;
      restoreSession(s)
        .then(() => setSessionRestored(true))
        .catch(() => setSessionRestored(true));
    }
  });

  // Fallback: unblock login button if store never arrives (engine offline)
  createEffect(() => {
    const conn = connection();
    if (!conn || sessionRestored()) return;
    const timer = setTimeout(() => setSessionRestored(true), 3000);
    return () => clearTimeout(timer);
  });

  // ── Auto-provision admin on fresh engine with empty userDB ───────────────
  let provisioningRan = false;
  createEffect(() => {
    const s = store();
    const conn = connection();
    if (!s || !conn || demo() || isOperator() || provisioningRan) return;
    if (!isFirstTimeSetup(s)) return;
    provisioningRan = true;
    createOperator('admin', 'admin911!', s, conn.changeDoc)
      .then((user) => {
        console.log('[app] auto-provisioned default operator');
        setAuthenticatedUser(user);
      })
      .catch((err) => {
        console.warn('[app] auto-provision skipped:', err.message);
        provisioningRan = false;
      });
  });

  // ── Connection management ─────────────────────────────────────────────────
  const initConnection = async () => {
    sessionRestoreRan = false;
    provisioningRan = false;
    setSessionRestored(false);
    setStore(null);
    setConnected(false);

    const isDemo = await readStoredDemoMode();
    setDemo(isDemo);

    const conn = isDemo
      ? createMockConnection()
      : await (await import('./store/engine')).createEngineConnection();

    setConnection(conn);
  };

  const runDiscovery = () => {
    setDiscovering(true);
    setDiscoveryResults([]);
    discoverAllEngines().then(async (results) => {
      setDiscovering(false);
      // Always show results — OnboardingCard handles the picker; no auto-connect
      setDiscoveryResults(results);
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

  // While the picker is visible (2+ results, no hostname selected), re-probe
  // every DISCOVERY_REFRESH_INTERVAL_MS so engines that were slow or came back
  // online appear automatically. Merges new results with existing ones.
  createEffect(() => {
    const showing = discoveryResults().length > 0 && !hostname();
    if (!showing) return;

    const interval = setInterval(() => {
      discoverAllEngines().then((fresh) => {
        if (discoveryResults().length === 0 || hostname()) return; // picker closed in the meantime
        // Merge: keep existing order, append any new hostnames found
        setDiscoveryResults((prev) => {
          const known = new Set(prev.map((r) => r.hostname));
          const merged = [...prev];
          for (const r of fresh) {
            if (!known.has(r.hostname)) merged.push(r);
          }
          return merged;
        });
      });
    }, DISCOVERY_REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  });

  // Reconnect after 15s of disconnection (not in demo / production mode)
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

  onMount(async () => {
    if (isProductionWebMode()) {
      setHostname(window.location.hostname);
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

  // ── Settings / reconnect helpers ─────────────────────────────────────────
  const handleOnboardingComplete = async () => {
    setHostname(await readStoredHostname());
    setShowSettings(false);
    await initConnection();
  };

  const handleLogout = async () => {
    await logout();
    setShowOperatorMgmt(false);
  };

  // ── Computed screen conditions ────────────────────────────────────────────
  const showOnboarding   = () => ready() && !hostname() && !demo();
  const showFirstSetup   = () => ready() && isFirstTimeSetup(store());
  const showMainLayout   = () => isOperator() && !showOperatorMgmt();
  const rightPanel       = () => rightPanelFor(selection(), store());

  // ── Status-bar dot ────────────────────────────────────────────────────────
  const dotClass = () => {
    if (connected()) return 'status-bar__dot--connected';
    if (discovering() || (hostname() && !demo())) return 'status-bar__dot--searching';
    return 'status-bar__dot--disconnected';
  };

  const statusLabel = () => {
    if (connected()) return hostname();
    if (demo()) return '';
    if (discovering()) return 'Scanning…';
    if (hostname()) return 'Connecting…';
    return 'No engine found';
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div class="app">

      {/* ── Status bar ────────────────────────────────────────────────────── */}
      <div class="status-bar">
        <span class="status-bar__title">IDEA Console <span class="status-bar__version">v{pkg.version}</span></span>
        <div class="status-bar__indicator">
          <span class={`status-bar__dot ${dotClass()}`} />
          <span>{statusLabel()}</span>
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

        <Show when={!isOperator() && !demo() && !!hostname()}>
          <button class="status-bar__logout-btn" onClick={() => setShowLogin(true)}>
            Log in
          </button>
        </Show>

        <button
          class="status-bar__history-btn"
          title="Command History"
          onClick={() => { setShowHistory((v) => !v); setShowSettings(false); }}
        >
          {showHistory() ? '✕' : '📋'}
        </button>

        <button
          class="status-bar__settings-btn"
          title="Settings"
          onClick={() => { setShowSettings((v) => !v); setShowHistory(false); }}
        >
          {showSettings() ? '✕' : '⚙'}
        </button>
      </div>

      {/* ── Page content — exactly one Match renders at a time ────────────── */}
      <Switch>

        {/* History panel */}
        <Match when={showHistory()}>
          <HistoryPanel
            commandLogStore={commandLogStore}
            onClose={() => setShowHistory(false)}
          />
        </Match>

        {/* Settings panel */}
        <Match when={showSettings()}>
          <SettingsPanel
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
              await logout();
              await initConnection();
            }}
            onDemoMode={async () => {
              await saveDemoMode(true);
              await logout();
              setHostname(await readStoredHostname());
              await initConnection();
            }}
            onDemoToggle={async (val) => {
              await saveDemoMode(val);
              if (val) {
                await logout();
                setHostname(await readStoredHostname());
                await initConnection();
              } else {
                await initConnection();
              }
            }}
          />
        </Match>

        {/* Engine discovery / onboarding */}
        <Match when={showOnboarding()}>
          <Onboarding
            onComplete={handleOnboardingComplete}
            discovering={discovering()}
            discoveryResults={discoveryResults()}
            onDiscoverySelect={handleDiscoverySelect}
          />
        </Match>

        {/* First-time operator setup */}
        <Match when={showFirstSetup() && store() && connection()}>
          <FirstTimeSetup
            store={store()!}
            connection={connection()!}
            onComplete={(user) => {
              // setAuthenticatedUser is synchronous; calling it here (post-finally
              // in FirstTimeSetup) flips isOperator() which moves Switch to the
              // mainLayout Match — clean transition with no disposal issues.
              setAuthenticatedUser(user);
            }}
          />
        </Match>

        {/* Operator management */}
        <Match when={showOperatorMgmt() && isOperator() && store() && connection()}>
          <OperatorManagement store={store()!} connection={connection()!} />
        </Match>

        {/* Main layout (authenticated) */}
        <Match when={showMainLayout()}>
          <Show
            when={isMobile()}
            fallback={
              <div class="main-layout">
                <NetworkTree
                  selection={selection()}
                  onSelect={setSelection}
                  store={store}
                  dragData={dragData}
                  onDrop={handleDrop}
                />
                <div class="main-layout__right">
                  <OperationProgress store={store} commandLogStore={commandLogStore} />
                  <Switch>
                    <Match when={rightPanel() === 'empty-disk'}>
                      <EmptyDiskPanel
                        disk={() => store()?.diskDB[selection().id]}
                        store={store}
                        engineId={() => store()?.diskDB[selection().id]?.dockedTo ?? undefined}
                      />
                    </Match>
                    <Match when={rightPanel() === 'backup-disk'}>
                      <RestorePanel
                        disk={() => store()?.diskDB[selection().id]}
                        store={store}
                        engineId={() => store()?.diskDB[selection().id]?.dockedTo ?? undefined}
                      />
                    </Match>
                    <Match when={true}>
                      <InstanceList
                        selection={selection()}
                        store={store}
                        commandLogStore={commandLogStore}
                        onDragStart={(data) => setDragData(data)}
                        onDragEnd={() => setDragData(null)}
                      />
                    </Match>
                  </Switch>
                </div>

                {/* Copy/Move modal — shown when an app is dropped onto a disk */}
                <Show when={pendingMove()}>
                  {(pm) => (
                    <div class="copy-move-modal-overlay" role="dialog" aria-modal="true" aria-label="Copy or Move">
                      <div class="copy-move-modal">
                        <div class="copy-move-modal__title">Copy or Move?</div>
                        <p class="copy-move-modal__desc">
                          <strong>{pm().data.instanceName}</strong> from <em>{pm().data.sourceDiskName}</em> → <em>{pm().targetDiskName}</em> on <em>{pm().targetEngineHostname}</em>
                        </p>
                        <div class="copy-move-modal__actions">
                          <button class="btn" onClick={() => setPendingMove(null)}>Cancel</button>
                          <button class="btn" onClick={() => handleCopyMoveChoice('move')}>Move</button>
                          <button class="btn btn--primary" onClick={() => handleCopyMoveChoice('copy')}>Copy</button>
                        </div>
                      </div>
                    </div>
                  )}
                </Show>
              </div>
            }
          >
            <MobileLayout
              store={store}
              commandLogStore={commandLogStore}
              selection={selection()}
              onSelect={setSelection}
              dragData={dragData}
              onDrop={handleDrop}
              pendingMove={pendingMove}
              onCopyMoveChoice={handleCopyMoveChoice}
              onCancelMove={() => setPendingMove(null)}
            />
          </Show>
        </Match>

        {/* Unauthenticated main view (default / fallback) */}
        <Match when={true}>
          <AppBrowser store={store} />
        </Match>

      </Switch>

      {/* ── Login modal ───────────────────────────────────────────────────── */}
      {/* Lives outside the Switch so auth signal changes never affect it.      */}
      <Show when={showLogin()}>
        <LoginForm
          store={store()}
          onSuccess={(user) => {
            batch(() => {
              setShowLogin(false);
              setAuthenticatedUser(user);
            });
          }}
          onCancel={() => setShowLogin(false)}
        />
      </Show>

    </div>
  );
};

export default App;
