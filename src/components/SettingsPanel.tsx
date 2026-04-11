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
  discovering: boolean;
  discoveryResults: DiscoveryResult[];
  onDiscoverySelect: (result: DiscoveryResult) => void;
  onRescan: () => void;
  onClose: () => void;
  onComplete: () => void;
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

  // All known engines: current hostname + discovery results (deduplicated)
  const knownEngines = (): DiscoveryResult[] => {
    const seen = new Set<string>();
    const engines: DiscoveryResult[] = [];
    if (props.hostname) {
      seen.add(props.hostname);
      engines.push({ hostname: props.hostname, storeUrl: '' });
    }
    for (const r of props.discoveryResults) {
      if (!seen.has(r.hostname)) {
        seen.add(r.hostname);
        engines.push(r);
      }
    }
    return engines;
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

            {/* Current connection */}
            <Show when={props.hostname}>
              <div class="settings-panel__current-engine">
                <span class="settings-panel__status-dot settings-panel__status-dot--connected" />
                <span>{props.hostname}</span>
              </div>
            </Show>

            {/* Known engines list */}
            <Show when={knownEngines().length > 0}>
              <div class="settings-panel__engine-list">
                <For each={knownEngines()}>
                  {(engine) => {
                    const status = () => engineStatuses()[engine.hostname];
                    return (
                      <div class="settings-panel__engine-item">
                        <button
                          class="settings-panel__engine-hostname"
                          onClick={() => {
                            if (engine.storeUrl) props.onDiscoverySelect(engine);
                          }}
                          disabled={!engine.storeUrl}
                          title={engine.storeUrl ? 'Click to connect' : engine.hostname}
                        >
                          {engine.hostname}
                        </button>
                        <Show when={status() === 'checking'}>
                          <span class="settings-panel__engine-badge settings-panel__engine-badge--checking">
                            checking…
                          </span>
                        </Show>
                        <Show when={status() === 'online'}>
                          <span class="settings-panel__engine-badge settings-panel__engine-badge--online">
                            online
                          </span>
                        </Show>
                        <Show when={status() === 'offline'}>
                          <span class="settings-panel__engine-badge settings-panel__engine-badge--offline">
                            offline
                          </span>
                        </Show>
                        <Show when={!status()}>
                          <button
                            class="btn btn--small"
                            onClick={() => probeEngine(engine.hostname)}
                          >
                            Check
                          </button>
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>

            {/* Re-scan button */}
            <button
              class="btn btn--primary"
              onClick={props.onRescan}
              disabled={props.discovering}
            >
              {props.discovering ? 'Scanning…' : 'Re-scan network'}
            </button>

            {/* Onboarding embedded — handles hostname input, display mode, demo toggle */}
            <Onboarding
              onComplete={props.onComplete}
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
