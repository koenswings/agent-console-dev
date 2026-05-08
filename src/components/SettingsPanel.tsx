import { createSignal, onMount, Show, For, type Component } from 'solid-js';
import ChangeEngineDialog from './ChangeEngineDialog';
import { currentUser, isOperator, changePassword } from '../store/auth';
import { csGet, csSet, STORAGE_KEY_MODE, type DisplayMode } from '../store/storage';
import { IS_EXTENSION } from '../store/context';
import type { Store } from '../types/store';
import type { StoreConnection } from '../mock/mockStore';

type Tab = 'engine' | 'account' | 'about';

export interface SettingsPanelProps {
  store: Store | null;
  connection: StoreConnection | null;
  hostname: string;
  demo: boolean;
  onClose: () => void;
  onComplete: () => void;
  onConnect: (hostname: string, storeUrl: string) => void;
  onDemoMode: () => void;
  onDemoToggle?: (val: boolean) => Promise<void>;
}

const SettingsPanel: Component<SettingsPanelProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal<Tab>('engine');
  const [showChangeEngine, setShowChangeEngine] = createSignal(false);
  const [displayMode, setDisplayMode] = createSignal<DisplayMode>('sidePanel');

  // Change password state
  const [currentPw, setCurrentPw] = createSignal('');
  const [newPw, setNewPw] = createSignal('');
  const [confirmPw, setConfirmPw] = createSignal('');
  const [pwError, setPwError] = createSignal('');
  const [pwSuccess, setPwSuccess] = createSignal('');
  const [pwLoading, setPwLoading] = createSignal(false);

  onMount(async () => {
    const r = await csGet([STORAGE_KEY_MODE]);
    setDisplayMode((r[STORAGE_KEY_MODE] as DisplayMode) ?? 'sidePanel');
  });

  const handleModeChange = async (mode: DisplayMode) => {
    setDisplayMode(mode);
    await csSet({ [STORAGE_KEY_MODE]: mode });
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

  const tabs = (): { id: Tab; label: string }[] => {
    const t: { id: Tab; label: string }[] = [{ id: 'engine', label: 'Engine Connection' }];
    if (isOperator()) t.push({ id: 'account', label: 'Account' });
    t.push({ id: 'about', label: 'About' });
    return t;
  };

  const modeOptions: { id: DisplayMode; label: string; desc: string }[] = [
    { id: 'sidePanel', label: 'Side panel', desc: 'Docked to the right of the browser. Stays open across tabs.' },
    { id: 'popup', label: 'Popup', desc: 'Opens on icon click, closes when you click away.' },
    { id: 'window', label: 'Standalone window', desc: 'Opens as a separate Chrome window.' },
  ];

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

            {/* Status row */}
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

            {/* Demo mode toggle — always visible */}
            <div class="settings-panel__toggle-row">
              <label class="toggle-row">
                <input
                  type="checkbox"
                  checked={props.demo}
                  onChange={(e) => void props.onDemoToggle?.(e.currentTarget.checked)}
                />
                <span class="toggle-row__label">Demo mode</span>
              </label>
              <span class="form-field__hint">Simulated data, no engine required</span>
            </div>

            {/* Change engine — operator only */}
            <Show when={isOperator()}>
              <button
                class="btn btn--primary settings-panel__change-engine-btn"
                onClick={() => setShowChangeEngine(true)}
              >
                Change engine
              </button>
            </Show>

            {/* Change engine dialog */}
            <Show when={showChangeEngine()}>
              <ChangeEngineDialog
                currentHostname={props.hostname}
                demo={props.demo}
                onConnect={(h, s) => {
                  setShowChangeEngine(false);
                  props.onConnect(h, s);
                }}
                onDemoMode={() => {
                  setShowChangeEngine(false);
                  props.onDemoMode();
                }}
                onCancel={() => setShowChangeEngine(false)}
              />
            </Show>
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

            {/* Display mode — extension only */}
            <Show when={IS_EXTENSION}>
            <div class="settings-panel__display-mode">
              <p class="settings-panel__display-mode-label">Display mode</p>
              <p class="settings-panel__display-mode-hint">
                Saved immediately. Takes effect on next toolbar icon click.
              </p>
              <div class="mode-options">
                <For each={modeOptions}>
                  {(opt) => (
                    <label class="mode-option">
                      <input
                        type="radio"
                        name="displayMode"
                        value={opt.id}
                        checked={displayMode() === opt.id}
                        onChange={() => handleModeChange(opt.id)}
                      />
                      <span class="mode-option__label">{opt.label}</span>
                      <span class="mode-option__desc">{opt.desc}</span>
                    </label>
                  )}
                </For>
              </div>
            </div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default SettingsPanel;
