import { createSignal, createEffect, createMemo, Show, Switch, Match, onMount, onCleanup, batch, type Component } from 'solid-js';
import pkg from '../package.json';
import ConnectionManagement from './components/ConnectionManagement';
import SettingsPanel from './components/SettingsPanel';
import AccountScreen from './components/AccountScreen';
import NetworkTree from './components/NetworkTree';
import ClientCardsSection from './components/ClientCardsSection';
import TempBackupsSection from './components/TempBackupsSection';
import InstanceList from './components/InstanceList';
import CommandScope from './components/CommandScope';
import EmptyDiskPanel from './components/EmptyDiskPanel';
import DiskView from './components/DiskView';
import UnformattedDiskView from './components/UnformattedDiskView';
import { rightPanelFor } from './store/diskRoles';
import OperationProgress from './components/OperationProgress';
import HistoryPanel from './components/HistoryPanel';
import AppBrowser from './components/AppBrowser';
import MobileLayout from './components/MobileLayout';
import FirstTimeSetup from './components/FirstTimeSetup';
import EngineConfirmDialog from './components/EngineConfirmDialog';
import CommandNotices from './components/CommandNotices';
import CopyMoveFeedback from './components/CopyMoveFeedback';
import CopyMoveModal from './components/CopyMoveModal';
import { createDragCopyMove } from './store/dragCopyMove';
import { connectedEngineId, connectedEngineName, setConnectedEngineHost } from './store/connectedEngine';
import { remoteCommandLog, setRemoteCommandLogFn } from './store/remoteCommandLogs';
import { setSendCommandFn } from './store/commands';
import { clearCommandNotices, configureCommandRouter, dispatchCommand } from './store/commandRouter';
import { resetEngineVersionMismatches } from './store/signedCommand';
import {
  AUTH_PROBE_RETRY_MS,
  authTransport,
  beginAuthProbe,
  isEngineAuth,
  pageAuthEngineId,
  probeAuthMode,
} from './store/authMode';
import { startSessionRenewal } from './store/engineAuth';
import { relayDiscovery } from './store/relayDiscovery';
import { connectionIndicator } from './store/connectionIndicator';
import {
  currentUser,
  isOperator,
  isFirstTimeSetup,
  logout,
  restoreSession,
  setAuthenticatedUser,
  handleSessionsEnded,
} from './store/auth';
import { createMockConnection } from './mock/mockStore';
import type { StoreConnection } from './mock/mockStore';
import {
  readStoredHostname,
  readStoredPreviewMode,
  saveHostnameAndStoreUrl,
  savePreviewMode,
  STORAGE_KEY_PORT,
  STORAGE_KEY_STORE_URL,
} from './store/storage';
import { isProductionWebMode } from './store/engine';
import { decideFailover, navigateTo, PROD_FAILOVER_MS, PROD_FAILOVER_RETRY_MS } from './store/prodFailover';
import { defaultEnginePort } from './store/discovery';
import { resolvePreviewMode } from './store/previewMode';
import { discoverAllEngines, enginesFromStore, DISCOVERY_REFRESH_INTERVAL_MS, type DiscoveryResult } from './store/discovery';
import type { Selection } from './components/NetworkTree';
import type { Store } from './types/store';
import type { CommandLogState } from './store/commandLog';

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const App: Component = () => {
  // ── Connection state ──────────────────────────────────────────────────────
  const [hostname, setHostname] = createSignal('');
  const [store, setStore] = createSignal<Store | null>(null);
  const [connected, setConnected] = createSignal(false);
  const [hasEverConnected, setHasEverConnected] = createSignal(false);
  const [preview, setPreview] = createSignal(false);
  const [connection, setConnection] = createSignal<StoreConnection | null>(null);
  // commandLogStore is derived reactively from the connection's accessor
  // so it updates automatically as the async connection resolves.
  const commandLogStore = createMemo<CommandLogState>(() => connection()?.commandLogStore() ?? null);
  const [discovering, setDiscovering] = createSignal(false);
  const [discoveryResults, setDiscoveryResults] = createSignal<DiscoveryResult[]>([]);
  const [discoveryFailed, setDiscoveryFailed] = createSignal(false);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [ready, setReady] = createSignal(false);
  const [selection, setSelection] = createSignal<Selection>({ type: 'network', id: '' });
  /** Surfaced when erase-then-files' createFilesDisk fails (Empty Disk panel). */
  const [filesShortcutError, setFilesShortcutError] = createSignal<string | null>(null);
  createEffect((prev: Selection | undefined) => {
    const cur = selection();
    if (prev && (prev.type !== cur.type || prev.id !== cur.id || prev.engineId !== cur.engineId)) {
      setFilesShortcutError(null);
    }
    return cur;
  });
  const [showSettings, setShowSettings] = createSignal(false);
  const [showHistory, setShowHistory] = createSignal(false);
  const [showAccount, setShowAccount] = createSignal(false);
  const [showConnectionMgmt, setShowConnectionMgmt] = createSignal(false);
  const [sessionRestored, setSessionRestored] = createSignal(false);

  // ── Mobile breakpoint ─────────────────────────────────────────────────────
  const [isMobile, setIsMobile] = createSignal(window.innerWidth <= 600);
  onMount(() => {
    const handler = () => setIsMobile(window.innerWidth <= 600);
    window.addEventListener('resize', handler);
    onCleanup(() => window.removeEventListener('resize', handler));
  });

  // ── Drag-and-drop state (lifted here so NetworkTree and InstanceList share it)
  // and the Copy-or-Move choice (store/dragCopyMove.ts; component-tested there).
  const dragCopyMove = createDragCopyMove(store, () => commandLogStore());
  const { dragData, setDragData, pendingMove, handleDrop } = dragCopyMove;
  const handleCopyMoveChoice = dragCopyMove.choose;

  // ── Cross-engine feedback: which Engine we talk to, other Engines' logs ────
  // Only re-runs when the connection object changes (not on store changes).
  createEffect(() => {
    const conn = connection();
    setConnectedEngineHost(conn?.hostname ?? null);
    setRemoteCommandLogFn((engineId) => {
      const host = store()?.engineDB[engineId]?.hostname;
      // engineId lets the connection use the relay for the log URL (agent-engine-dev#582).
      return host && conn?.commandLogFor ? conn.commandLogFor(String(host), String(engineId)) : null;
    });
  });
  // Start loading the other Engines' command logs early, so a later
  // cross-engine command has a real baseline (approach i, opportunistic).
  createEffect(() => {
    const s = store();
    if (!s || !connection()?.commandLogFor) return;
    const own = connectedEngineId(s);
    for (const id of Object.keys(s.engineDB ?? {})) {
      if (id !== own) remoteCommandLog(id);
    }
  });

  // ── Reactive sync from connection → store / connected signals ─────────────
  createEffect(() => {
    const conn = connection();
    if (!conn) return;
    setStore(conn.store());
    setConnected(conn.connected());
  });

  // ── Commands and sign-in mode (agent-engine-dev#582) ──────────────────────
  // Every command goes through the router: signed (POST /api/command) when
  // the page's Engine has the sign-in API, the store queue otherwise.
  createEffect(() => {
    const conn = connection();
    configureCommandRouter({
      legacySend: conn ? conn.sendCommand : null,
      store: () => store(),
      onSignInRequired: (ids) => {
        const self = pageAuthEngineId();
        if (self && ids.includes(self)) {
          void handleSessionsEnded([self]).then(() => setShowAccount(true));
        }
      },
    });
    setSendCommandFn(dispatchCommand);
  });

  // Once per connection: ask the page's Engine which sign-in it has. No answer
  // keeps sign-in and commands waiting and retries; 404 means an older Engine.
  createEffect(() => {
    const conn = connection();
    beginAuthProbe(conn?.apiTransport ?? null);
    resetEngineVersionMismatches();
    clearCommandNotices();
    if (!conn?.apiTransport) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = async () => {
      const m = await probeAuthMode();
      if (!stopped && m === 'probing') timer = setTimeout(attempt, AUTH_PROBE_RETRY_MS);
    };
    void attempt();
    onCleanup(() => { stopped = true; if (timer) clearTimeout(timer); });
  });

  // Keep Engine sessions alive while the page is visible (#582 answer 12).
  createEffect(() => {
    if (!isEngineAuth() || !isOperator()) return;
    const stop = startSessionRenewal({
      transport: authTransport,
      onSessionsEnded: (ids) => {
        const self = pageAuthEngineId();
        void handleSessionsEnded(ids).then(() => { if (self && ids.includes(self)) setShowAccount(true); });
      },
    });
    onCleanup(stop);
  });

  createEffect(() => {
    const conn = connection();
    if (!conn) return;
    setStore(conn.store());
  });

  createEffect(() => {
    const conn = connection();
    if (!conn) return;
    const isConn = conn.connected();
    setConnected(isConn);
    if (isConn) setHasEverConnected(true);
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

  // ── Connection management ─────────────────────────────────────────────────
  // Tracks the current in-progress initConnection() call so that if a new one
  // starts before the previous resolves, the stale one can be abandoned.
  let currentInitId = 0;

  // Issue #150: the Engine picked in Connection Management. It drives the connection
  // (also when served from a Pi); null = default (page host / saved host).
  let pickedTarget: { hostname: string; port?: number | null } | null = null;

  const initConnection = async () => {
    // Dispose the old connection before starting a new one to stop stale WS
    // retries (BrowserWebSocketClientAdapter retries every 5 s indefinitely).
    const oldConn = connection();
    if (oldConn?.dispose) oldConn.dispose();

    sessionRestoreRan = false;
    setSessionRestored(false);
    setStore(null);
    setConnected(false);
    setHasEverConnected(false);

    const myId = ++currentInitId;

    // Production web (Engine :8080): NEVER honor stale localStorage previewMode —
    // bootPreview disks (DISK001) break duration Intents (duration-kolibri-grade5a-001).
    const storedPreview = await readStoredPreviewMode();
    if (myId !== currentInitId) return; // superseded
    const resolved = resolvePreviewMode({
      productionWeb: isProductionWebMode(),
      storedPreview,
      searchParams: typeof window !== 'undefined' ? window.location.search : '',
    });
    if (resolved.persistFalse) await savePreviewMode(false);
    else if (resolved.persistTrue) await savePreviewMode(true);
    if (myId !== currentInitId) return; // superseded during persist
    const isPreview = resolved.isPreview;
    setPreview(isPreview);

    const conn = isPreview
      ? createMockConnection()
      : await (await import('./store/engine')).createEngineConnection(3, { target: pickedTarget });

    if (myId !== currentInitId) {
      // Superseded — clean up immediately so we don't leak a WS connection
      conn.dispose?.();
      return;
    }

    setConnection(conn);
  };

  const runDiscovery = () => {
    setDiscovering(true);
    setDiscoveryResults([]);

    // After 5s of scanning with no single match, show Connection Management
    const failTimer = setTimeout(() => {
      if (discovering() && !hostname()) setDiscoveryFailed(true);
    }, 5000);

    discoverAllEngines().then(async (results) => {
      clearTimeout(failTimer);
      setDiscovering(false);
      if (results.length === 1 && !hostname()) {
        // Single engine found: auto-connect, never show Connection Management screen
        await handleDiscoverySelect(results[0]);
      } else {
        // Multiple engines found or none: show Connection Management so user can pick
        setDiscoveryResults(results);
        setDiscoveryFailed(true);
      }
    });
  };

  const handleDiscoverySelect = async (result: DiscoveryResult) => {
    // agent-engine-dev#582: a page served by an Engine talks only to its own
    // origin, so switching Engine opens that Engine's own Console.
    if (isProductionWebMode() && isEngineAuth()) {
      const port = result.port && result.port !== 80 ? `:${result.port}` : '';
      navigateTo(`http://${result.hostname}${port}/`);
      return;
    }
    await saveHostnameAndStoreUrl(result.hostname, result.storeUrl, result.port);
    pickedTarget = { hostname: result.hostname, port: result.port ?? null };
    // Status bar = the host the connection is actually made to (issue #150).
    setHostname(result.hostname);
    setDiscoveryResults([]);
    setShowConnectionMgmt(false);
    await initConnection();
  };

  const handleConnectionFailure = async () => {
    pickedTarget = null;
    setHostname('');
    localStorage.removeItem('engineHostname');
    localStorage.removeItem(STORAGE_KEY_PORT);
    setDiscoveryFailed(false);
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

  // Initial connection timeout — if hostname is set but we never receive document
  // data after 15 s, the engine is unreachable; go back to scanning.
  createEffect(() => {
    const host = hostname();
    const everConn = hasEverConnected();
    if (host && !everConn && !preview() && !isProductionWebMode()) {
      const timer = setTimeout(() => {
        if (!hasEverConnected() && hostname()) {
          handleConnectionFailure();
        }
      }, 15_000);
      return () => clearTimeout(timer);
    }
  });

  // Reconnect after 15s of disconnection (not in preview / production mode).
  // Only fires after first successful connection to avoid cancelling in-progress connects.
  createEffect(() => {
    const isConn = connected();
    const host = hostname();
    if (!isConn && host && hasEverConnected() && !preview() && !isProductionWebMode()) {
      const timer = setTimeout(() => {
        if (!connected() && hostname()) handleConnectionFailure();
      }, 15_000);
      return () => clearTimeout(timer);
    }
  });

  // idea#203: served from an Engine, the Console only talks to its page host.
  // If that Engine stays unreachable, reconnect when it (or the new idea.local
  // holder) answers again, else open another live Engine's Console.
  createEffect(() => {
    const isConn = connected();
    if (isConn || !hasEverConnected() || preview() || !isProductionWebMode()) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = async () => {
      if (stopped || connected()) return;
      const step = await decideFailover(store(), window.location.hostname, defaultEnginePort());
      if (stopped || connected()) return;
      if (step.kind === 'reconnect') { await initConnection(); return; }
      if (step.kind === 'navigate') {
        console.info(`[app] Serving Engine unreachable — opening ${step.url}`);
        navigateTo(step.url);
        return;
      }
      timer = setTimeout(attempt, PROD_FAILOVER_RETRY_MS);
    };
    timer = setTimeout(attempt, PROD_FAILOVER_MS);
    onCleanup(() => { stopped = true; clearTimeout(timer); });
  });

  onMount(async () => {
    if (isProductionWebMode()) {
      setHostname(window.location.hostname);
      setPreview(false);
      setReady(true);
      await initConnection();
      return;
    }

    // EXTENSION-ONLY: Reading saved hostname and trying last-used or preconfigured hostnames
    // is only needed when the app runs as a Chrome extension. In web mode, the hostname is
    // auto-detected from window.location. If we ship as an extension, this path must be
    // tested thoroughly including the chrome.storage.local silent hang risk (see MEMORY.md).
    const host = await readStoredHostname();
    setHostname(host);
    setReady(true);

    const isPreview = await readStoredPreviewMode();
    if (isPreview || host) {
      await initConnection();
    } else {
      runDiscovery();
    }
  });

  // ── Settings / reconnect helpers ─────────────────────────────────────────
  const handleOnboardingComplete = async () => {
    setHostname(await readStoredHostname());
    setShowConnectionMgmt(false);
    setShowSettings(false);
    await initConnection();
  };

  // ── Computed screen conditions ────────────────────────────────────────────
  const showOnboarding   = () => ready() && !hostname() && !preview() && discoveryFailed();
  const showFirstSetup   = () => ready() && !isOperator() && isFirstTimeSetup(store());
  // showAccount overlays above the main layout in the Switch — showMainLayout doesn't
  // need to exclude it; the Switch renders the first matching Match.
  const showMainLayout   = () => isOperator();
  const rightPanel       = () => rightPanelFor(selection(), store());
  /** Engine the right panel acts on: the selected Engine, the disk's Engine, or the candidate's. */
  const scopeEngineId = (): string | null => {
    const sel = selection();
    if (sel.type === 'engine') return sel.id;
    if (sel.type === 'unformatted') return sel.engineId ?? null;
    if (sel.type === 'disk') return store()?.diskDB?.[sel.id]?.dockedTo ?? null;
    return null;
  };

  // ── Status-bar dot ────────────────────────────────────────────────────────
  // Store socket liveness (agent-engine-dev#168): only this one accessor of the
  // connection is read, never the store.
  const socketState = createMemo(() => connection()?.socketState?.() ?? 'live');
  const indicator = createMemo(() => connectionIndicator({
    connected: connected(),
    socketState: socketState(),
    preview: !!preview(),
    discovering: discovering(),
    hostname: hostname() || null,
    engineName: () => connectedEngineName(store(), hostname()),
  }));
  const dotClass = () => indicator().dotClass;
  const statusLabel = () => indicator().label;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div class="app">
      <EngineConfirmDialog />
      <CommandNotices />

      {/* ── Status bar ────────────────────────────────────────────────────── */}
      <div class="status-bar">
        <span class="status-bar__title">IDEA Console <span class="status-bar__version">v{pkg.version}</span></span>
        <div class="status-bar__indicator" data-testid="status-bar-indicator">
          <span class={`status-bar__dot ${dotClass()}`} />
          <span data-testid="status-bar-hostname">{statusLabel()}</span>
        </div>

        <Show when={preview()}>
          <span class="status-bar__preview-badge">PREVIEW</span>
        </Show>

        <Show when={isOperator()}>
          <span class="status-bar__username">{currentUser()?.username}</span>
        </Show>

        <div class="status-bar__actions">
          {/* 🔌 Connection Management — hidden in preview mode */}
          <Show when={!preview()}>
            <button
              class="status-bar__connection-btn"
              data-testid="connection-mgmt-btn"
              title="Connection Management"
              onClick={() => {
                setShowConnectionMgmt((v) => !v);
                setShowAccount(false);
                setShowSettings(false);
                setShowHistory(false);
              }}
            >
              {showConnectionMgmt() ? '✕' : '🔌'}
            </button>
          </Show>

          {/* 👤 Account — always visible */}
          <button
            class="status-bar__account-btn" data-testid="account-btn"
            title="Account"
            onClick={() => {
              setShowAccount((v) => !v);
              setShowConnectionMgmt(false);
              setShowSettings(false);
              setShowHistory(false);
            }}
          >
            {showAccount() ? '✕' : '👤'}
          </button>

          <button
            class="status-bar__history-btn"
            title="Command History"
            onClick={() => {
              setShowHistory((v) => !v);
              setShowConnectionMgmt(false);
              setShowAccount(false);
              setShowSettings(false);
            }}
          >
            {showHistory() ? '✕' : '📋'}
          </button>

          <button
            class="status-bar__settings-btn" data-testid="settings-btn"
            title="Settings"
            onClick={() => {
              setShowSettings((v) => !v);
              setShowConnectionMgmt(false);
              setShowAccount(false);
              setShowHistory(false);
            }}
          >
            {showSettings() ? '✕' : '⚙'}
          </button>
        </div>
      </div>

      {/* ── Page content — exactly one Match renders at a time ────────────── */}
      <Switch>

        {/* Connection Management — toggled by 🔌 or auto-shown when discovery failed */}
        <Match when={showConnectionMgmt() || showOnboarding()}>
          <ConnectionManagement
            onComplete={handleOnboardingComplete}
            discovering={discovering()}
            discoveryResults={discoveryResults()}
            onDiscoverySelect={handleDiscoverySelect}
            storeEngines={enginesFromStore(store(), localStorage.getItem(STORAGE_KEY_STORE_URL) ?? '')}
            probe={isProductionWebMode() && isEngineAuth()
              ? () => relayDiscovery(authTransport(), store(), localStorage.getItem(STORAGE_KEY_STORE_URL) ?? '')
              : undefined}
          />
        </Match>

        {/* Settings panel */}
        <Match when={showSettings()}>
          <SettingsPanel
            store={store()}
            connection={connection()}
            hostname={hostname()}
            preview={preview()}
            onClose={() => setShowSettings(false)}
            onComplete={handleOnboardingComplete}
            onConnect={async (h, s) => {
              await savePreviewMode(false);
              await saveHostnameAndStoreUrl(h, s);
              setHostname(h);
              setShowSettings(false);
              await logout();
              await initConnection();
            }}
            onChangeEngine={() => {
              setShowSettings(false);
              setShowConnectionMgmt(true);
            }}
            onPreviewMode={async () => {
              // Production web: refuse preview (duration --live must stay on Engine store)
              if (isProductionWebMode()) {
                await savePreviewMode(false);
                setPreview(false);
                return;
              }
              await savePreviewMode(true);
              await logout();
              setHostname(await readStoredHostname());
              await initConnection();
            }}
            onPreviewToggle={async (val) => {
              if (isProductionWebMode()) {
                await savePreviewMode(false);
                setPreview(false);
                if (!val) await initConnection();
                return;
              }
              await savePreviewMode(val);
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

        {/* Account screen — always accessible via 👤 button */}
        <Match when={showAccount()}>
          <AccountScreen store={store()} connection={connection()} />
        </Match>

        {/* History panel */}
        <Match when={showHistory()}>
          <HistoryPanel
            commandLogStore={commandLogStore}
            store={store}
            onClose={() => setShowHistory(false)}
          />
        </Match>

        {/* First-time operator setup */}
        <Match when={showFirstSetup() && store() && connection()}>
          <FirstTimeSetup
            store={store()!}
            connection={connection()!}
            onComplete={(user) => {
              setAuthenticatedUser(user);
            }}
          />
        </Match>

        {/* Main layout (authenticated) */}
        <Match when={showMainLayout()}>
          <Show
            when={isMobile()}
            fallback={
              <div class="main-layout" data-testid="op-overview">
                <NetworkTree
                  selection={selection()}
                  onSelect={setSelection}
                  store={store}
                  dragData={dragData}
                  onDrop={handleDrop}
                  commandLogStore={commandLogStore}
                />
                <div class="main-layout__right">
                  <CopyMoveFeedback store={store} ctl={dragCopyMove} />
                  <OperationProgress store={store} commandLogStore={commandLogStore} />
                  <CommandScope engineId={scopeEngineId}>
                  <Switch>
                    <Match when={selection().type === 'unformatted' ? `${selection().engineId}:${selection().id}` : null} keyed>
                      {(key) => {
                        const [engId, candId] = key.split(':');
                        return (
                          <UnformattedDiskView
                            engineId={engId}
                            candidateId={candId}
                            store={store}
                            commandLogStore={commandLogStore}
                            onSelect={setSelection}
                          />
                        );
                      }}
                    </Match>
                    <Match when={rightPanel() === 'empty-disk'}>
                      <EmptyDiskPanel
                        disk={() => store()?.diskDB[selection().id]}
                        store={store}
                        engineId={() => store()?.diskDB[selection().id]?.dockedTo ?? undefined}
                        commandLogStore={commandLogStore}
                        onSelectDisk={(id) => setSelection({ type: 'disk', id })}
                        filesError={filesShortcutError()}
                        onFilesFailed={(id, msg) => {
                          setFilesShortcutError(msg);
                          setSelection({ type: 'disk', id });
                        }}
                      />
                    </Match>
                    {/* keyed: a fresh DiskView (and its local form state) per disk */}
                    <Match when={rightPanel() === 'disk' ? selection().id : null} keyed>
                      {(diskId) => (
                        <DiskView
                          diskId={diskId}
                          store={store}
                          commandLogStore={commandLogStore}
                          onDragStart={(data) => setDragData(data)}
                          onDragEnd={() => setDragData(null)}
                          onSelect={setSelection}
                          filesError={filesShortcutError()}
                          onClearFilesError={() => setFilesShortcutError(null)}
                          onFilesFailed={(id, msg) => {
                            setFilesShortcutError(msg);
                            setSelection({ type: 'disk', id });
                          }}
                        />
                      )}
                    </Match>
                    <Match when={true}>
                      <InstanceList
                        selection={selection()}
                        store={store}
                        commandLogStore={commandLogStore}
                        onDragStart={(data) => setDragData(data)}
                        onDragEnd={() => setDragData(null)}
                      />
                      {/* idea#201 §10.2: Client cards per Engine */}
                      <Show when={selection().type === 'engine' ? selection().id : null} keyed>
                        {(engineId) => (
                          <>
                            <ClientCardsSection engineId={engineId} store={store} commandLogStore={commandLogStore} />
                            <TempBackupsSection engineId={engineId} store={store} commandLogStore={commandLogStore} />
                          </>
                        )}
                      </Show>
                    </Match>
                  </Switch>
                  </CommandScope>
                </div>

                {/* Copy/Move modal — shown when an app is dropped onto a disk */}
                <CopyMoveModal ctl={dragCopyMove} />
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
              onCancelMove={dragCopyMove.cancel}
              copyMoveFeedback={<CopyMoveFeedback store={store} ctl={dragCopyMove} />}
            />
          </Show>
        </Match>

        {/* Unauthenticated main view (default / fallback) */}
        <Match when={true}>
          <AppBrowser store={store} connected={connected} />
        </Match>

      </Switch>

    </div>
  );
};

export default App;
