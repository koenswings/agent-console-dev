import { createMemo, createSignal, Show, For, type Component } from 'solid-js';
import pkg from '../../package.json';
import { currentUser, isOperator, changePassword } from '../store/auth';
import type { Store } from '../types/store';
import { engineHasCapability } from '../store/commands';
import { DEMO_APPS_CAPABILITY } from '../store/demoApps';
import DemoAppsSection from './DemoAppsSection';
import type { StoreConnection } from '../mock/mockStore';

type Tab = 'engine' | 'account' | 'demo' | 'about';

export interface SettingsPanelProps {
  store: Store | null;
  connection: StoreConnection | null;
  hostname: string;
  preview: boolean;
  onClose: () => void;
  onComplete: () => void;
  onConnect: (hostname: string, storeUrl: string) => void;
  /** Open ConnectionManagement to pick another Engine (Prefer A switch_engine). */
  onChangeEngine?: () => void;
  onPreviewMode: () => void;
  onPreviewToggle?: (val: boolean) => Promise<void>;
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
    let ok = false;
    try {
      ok = await changePassword(
        userId,
        currentPw(),
        newPw(),
        props.store,
        props.connection.changeDoc,
      );
    } finally {
      setPwLoading(false);
    }
    if (ok) {
      setPwSuccess('Password changed.');
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
    } else {
      setPwError('Current password is incorrect.');
    }
  };

  /** idea#235: any Engine with a fresh demoApps capability (engine#369 §1). */
  const anyDemoEngine = createMemo(() =>
    Object.values(props.store?.engineDB ?? {}).some((e) => engineHasCapability(e, DEMO_APPS_CAPABILITY)));
  /** Operators only (Koen, idea#235, 14 Nov 2026 10:15); hidden for everyone else. */
  const showDemoApps = () => isOperator() && anyDemoEngine();

  const tabs = (): { id: Tab; label: string }[] => {
    const t: { id: Tab; label: string }[] = [{ id: 'engine', label: 'Engine Connection' }];
    if (isOperator()) t.push({ id: 'account', label: 'Account' });
    if (showDemoApps()) t.push({ id: 'demo', label: 'Demo apps' });
    t.push({ id: 'about', label: 'About' });
    return t;
  };

  return (
    <div class="settings-panel" data-testid="settings-panel">
      {/* Left sidebar */}
      <nav class="settings-panel__sidebar">
        <For each={tabs()}>
          {(tab) => (
            <button
              class={`settings-panel__tab${activeTab() === tab.id ? ' settings-panel__tab--active' : ''}`}
              data-testid={`settings-tab-${tab.id}`}
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

            {/* Status row */}
            <div class="settings-panel__current-engine" data-testid="settings-engine-status">
              <Show when={props.preview}>
                <span class="settings-panel__status-dot" style="background:var(--colour-text-dim)" />
                <span class="settings-panel__current-label">Preview mode — simulated data, no engine connected</span>
              </Show>
              <Show when={!props.preview && props.hostname}>
                <span class="settings-panel__status-dot settings-panel__status-dot--connected" />
                <span class="settings-panel__current-label">Connected to <strong>{props.hostname.replace(/\.local$/i, '')}</strong></span>
              </Show>
              <Show when={!props.preview && !props.hostname}>
                <span class="settings-panel__status-dot" style="background:var(--colour-error)" />
                <span class="settings-panel__current-label">Not connected</span>
              </Show>
            </div>

            {/* Preview mode toggle — always visible */}
            <div class="settings-panel__toggle-row">
              <label class="toggle-row">
                <input
                  type="checkbox"
                  data-testid="settings-preview-toggle"
                  checked={props.preview}
                  onChange={(e) => void props.onPreviewToggle?.(e.currentTarget.checked)}
                />
                <span class="toggle-row__label">Preview mode</span>
              </label>
              <span class="form-field__hint">Simulated data, no engine required</span>
            </div>

            <Show when={props.onChangeEngine}>
              <div class="settings-panel__actions" style="margin-top:1rem">
                <button
                  type="button"
                  class="btn"
                  data-testid="switch-engine-connect"
                  onClick={() => props.onChangeEngine?.()}
                >
                  Change Engine…
                </button>
                <p class="form-field__hint">Opens connection picker to connect to another Engine on the network.</p>
              </div>
            </Show>
          </div>
        </Show>

        {/* Account */}
        <Show when={activeTab() === 'account' && isOperator()}>
          <div class="settings-panel__section">
            <h2 class="settings-panel__heading">Change Password</h2>
            <form class="modal__form" data-testid="settings-change-password-form" onSubmit={handleChangePassword}>
              <label class="form-field">
                <span class="form-field__label">Current password</span>
                <input
                  class="form-field__input"
                  type="password"
                  data-testid="settings-change-password-current"
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
                  data-testid="settings-change-password-new"
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
                  data-testid="settings-change-password-confirm"
                  value={confirmPw()}
                  onInput={(e) => setConfirmPw(e.currentTarget.value)}
                  required
                />
              </label>
              {pwError() && <p class="form-error" data-testid="settings-change-password-error">{pwError()}</p>}
              {pwSuccess() && <p class="form-success" data-testid="settings-change-password-success">{pwSuccess()}</p>}
              <button
                class="btn btn--primary"
                type="submit"
                data-testid="settings-change-password"
                disabled={pwLoading()}
              >
                {pwLoading() ? 'Saving…' : 'Change password'}
              </button>
            </form>
          </div>
        </Show>

        {/* Demo apps (idea#235): operators only, Engine capability demoApps */}
        <Show when={activeTab() === 'demo' && showDemoApps()}>
          <DemoAppsSection
            store={() => props.store}
            commandLog={() => props.connection?.commandLogStore() ?? null}
          />
        </Show>

        {/* About */}
        <Show when={activeTab() === 'about'}>
          <div class="settings-panel__section">
            <h2 class="settings-panel__heading">About</h2>
            <p class="settings-panel__about-name">IDEA Console</p>
            <p class="settings-panel__about-desc">Offline web app management for schools</p>
            <p class="settings-panel__about-version" data-testid="settings-about-version">v{pkg.version}</p>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default SettingsPanel;
