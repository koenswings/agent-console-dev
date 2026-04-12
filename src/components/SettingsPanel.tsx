import { createSignal, Show, For, type Component } from 'solid-js';
import Onboarding from './Onboarding';
import { currentUser, isOperator, changePassword } from '../store/auth';
import type { DiscoveryResult } from '../store/discovery';
import type { Store } from '../types/store';
import type { StoreConnection } from '../mock/mockStore';

type Tab = 'engine' | 'account' | 'about';

export interface SettingsPanelProps {
  store: Store | null;
  connection: StoreConnection | null;
  hostname: string;
  demo: boolean;
  discovering: boolean;
  discoveryResults: DiscoveryResult[];
  onDiscoverySelect: (result: DiscoveryResult) => void;
  onRescan: () => void;
  onClose: () => void;
  onComplete: () => void;
  /** Reconnect in-place without closing the panel (e.g. live toggle changes) */
  onReconnect: () => void;
}

async function probeHostname(hostname: string): Promise<boolean> {
  try {
    const res = await fetch(`http://${hostname}/api/store-url`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return false;
    const json = await res.json();
    return typeof json?.url === 'string' && (json.url as string).startsWith('automerge:');
  } catch {
    return false;
  }
}

const SettingsPanel: Component<SettingsPanelProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal<Tab>('engine');

  // Change password state
  const [currentPw, setCurrentPw] = createSignal('');
  const [newPw, setNewPw] = createSignal('');
  const [confirmPw, setConfirmPw] = createSignal('');
  const [pwError, setPwError] = createSignal('');
  const [pwSuccess, setPwSuccess] = createSignal('');
  const [pwLoading, setPwLoading] = createSignal(false);

  // Per-engine online/offline status
  const [engineStatuses, setEngineStatuses] = createSignal<
    Record<string, 'online' | 'offline' | 'checking'>
  >({});

  // Other engines: discovery results that are NOT the current hostname
  const otherEngines = (): DiscoveryResult[] => {
    return props.discoveryResults.filter((r) => r.hostname !== props.hostname);
  };

  const probeEngine = async (hostname: string) => {
    setEngineStatuses((prev) => ({ ...prev, [hostname]: 'checking' }));
    const online = await probeHostname(hostname);
    setEngineStatuses((prev) => ({ ...prev, [hostname]: online ? 'online' : 'offline' }));
  };

  const handleChangePassword = async (e: Event) => {
    e.preventDefault();
    setPwError('');
    setPwSuccess('');
    if (newPw() !== confirmPw()) {
      setPwError('Passwords do not match.');
      return;
    }
    if (newPw().length < 8) {
      setPwError('New password must be at least 8 characters.');
      return;
    }
    const userId = currentUser()?.id;
    if (!userId || !props.store || !props.connection) return;
    setPwLoading(true);
    const ok = await changePassword(
      userId,
      currentPw(),
      newPw(),
      props.store,
      props.connection.changeDoc,
    );
    setPwLoading(false);
    if (ok) {
      setPwSuccess('Password changed.');
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
    } else {
      setPwError('Current password is incorrect.');
    }
  };

  const tabs = (): { id: Tab; label: string }[] => {
    const t: { id: Tab; label: string }[] = [{ id: 'engine', label: 'Engine Connection' }];
    if (isOperator()) t.push({ id: 'account', label: 'Account' });
    t.push({ id: 'about', label: 'About' });
    return t;
  };

  return (
    <div class="settings-panel">
      {/* Left sidebar */}
      <nav class="settings-panel__sidebar">
        <For each={tabs()}>
          {(tab) => (
            <button
              class={`settings-panel__tab${activeTab() === tab.id ? ' settings-panel__tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          )}
        </For>
      </nav>

      {/* Right content */}
      <div class="settings-panel__content">

        {/* Engine Connection */}
        <Show when={activeTab() === 'engine'}>
          <div class="settings-panel__section">
            <h2 class="settings-panel__heading">Engine Connection</h2>

            {/* Current connection status */}
            <div class="settings-panel__current-engine">
              <Show when={props.demo}>
                <span class="settings-panel__status-dot" style="background:var(--colour-text-dim)" />
                <span class="settings-panel__current-label">Demo mode — simulated data, no engine connected</span>
              </Show>
              <Show when={!props.demo && props.hostname}>
                <span class="settings-panel__status-dot settings-panel__status-dot--connected" />
                <span class="settings-panel__current-label">Connected to <strong>{props.hostname}</strong></span>
              </Show>
              <Show when={!props.demo && !props.hostname}>
                <span class="settings-panel__status-dot" style="background:var(--colour-error)" />
                <span class="settings-panel__current-label">Not connected</span>
              </Show>
            </div>

            {/* Other engines found on the network — only shown when there are alternatives */}
            <Show when={otherEngines().length > 0}>
              <p class="settings-panel__other-label">Other engines on the network:</p>
              <div class="settings-panel__engine-list">
                <For each={otherEngines()}>
                  {(engine) => {
                    const status = () => engineStatuses()[engine.hostname];
                    return (
                      <div class="settings-panel__engine-item">
                        <button
                          class="settings-panel__engine-hostname"
                          onClick={() => props.onDiscoverySelect(engine)}
                          title="Switch to this engine"
                        >
                          {engine.hostname}
                        </button>
                        <Show when={status() === 'checking'}>
                          <span class="settings-panel__engine-badge settings-panel__engine-badge--checking">checking…</span>
                        </Show>
                        <Show when={status() === 'online'}>
                          <span class="settings-panel__engine-badge settings-panel__engine-badge--online">online</span>
                        </Show>
                        <Show when={status() === 'offline'}>
                          <span class="settings-panel__engine-badge settings-panel__engine-badge--offline">offline</span>
                        </Show>
                        <Show when={!status()}>
                          <button class="btn btn--small" onClick={() => probeEngine(engine.hostname)}>Check</button>
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>

            {/* Onboarding embedded — hostname input, display mode, demo toggle */}
            <Onboarding
              onComplete={props.onComplete}
              onReconnect={props.onReconnect}
              discovering={props.discovering}
              discoveryResults={props.discoveryResults}
              onDiscoverySelect={props.onDiscoverySelect}
            />
          </div>
        </Show>

        {/* Account */}
        <Show when={activeTab() === 'account' && isOperator()}>
          <div class="settings-panel__section">
            <h2 class="settings-panel__heading">Change Password</h2>
            <form class="modal__form" onSubmit={handleChangePassword}>
              <label class="form-field">
                <span class="form-field__label">Current password</span>
                <input
                  class="form-field__input"
                  type="password"
                  value={currentPw()}
                  onInput={(e) => setCurrentPw(e.currentTarget.value)}
                  required
                />
              </label>
              <label class="form-field">
                <span class="form-field__label">New password</span>
                <input
                  class="form-field__input"
                  type="password"
                  value={newPw()}
                  onInput={(e) => setNewPw(e.currentTarget.value)}
                  required
                  minLength={8}
                />
              </label>
              <label class="form-field">
                <span class="form-field__label">Confirm new password</span>
                <input
                  class="form-field__input"
                  type="password"
                  value={confirmPw()}
                  onInput={(e) => setConfirmPw(e.currentTarget.value)}
                  required
                />
              </label>
              {pwError() && <p class="form-error">{pwError()}</p>}
              {pwSuccess() && <p class="form-success">{pwSuccess()}</p>}
              <button class="btn btn--primary" type="submit" disabled={pwLoading()}>
                {pwLoading() ? 'Saving…' : 'Change password'}
              </button>
            </form>
          </div>
        </Show>

        {/* About */}
        <Show when={activeTab() === 'about'}>
          <div class="settings-panel__section">
            <h2 class="settings-panel__heading">About</h2>
            <p class="settings-panel__about-name">IDEA Console</p>
            <p class="settings-panel__about-desc">Offline web app management for schools</p>
            <p class="settings-panel__about-version">Version 0.1.0</p>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default SettingsPanel;
