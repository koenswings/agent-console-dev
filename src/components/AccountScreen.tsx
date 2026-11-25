/**
 * AccountScreen — full content-area panel opened by the 👤 status bar button.
 *
 * When NOT logged in: shows an inline login form.
 * When logged in: shows username, role, change password form,
 *   "Manage Operators" button (drills into OperatorManagement inline),
 *   and a "Log out" danger button at the bottom.
 *
 * No close button inside the panel — the 👤 button in the status bar toggles it.
 */
import { createSignal, Show, type Component } from 'solid-js';
import {
  currentUser,
  isOperator,
  logout,
  changeMyPassword,
  signIn,
} from '../store/auth';
import { authMode } from '../store/authMode';
import OperatorManagement from './OperatorManagement';
import EngineIssues from './EngineIssues';
import type { Store } from '../types/store';
import type { StoreConnection } from '../mock/mockStore';

interface AccountScreenProps {
  store: Store | null;
  connection: StoreConnection | null;
}

type SubView = 'main' | 'operator-mgmt';

const AccountScreen: Component<AccountScreenProps> = (props) => {
  const [subView, setSubView] = createSignal<SubView>('main');

  // Login form state
  const [username, setUsername] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [showPassword, setShowPassword] = createSignal(false);
  const [loginError, setLoginError] = createSignal('');
  const [loginLoading, setLoginLoading] = createSignal(false);

  // Change password state
  const [currentPw, setCurrentPw] = createSignal('');
  const [newPw, setNewPw] = createSignal('');
  const [confirmPw, setConfirmPw] = createSignal('');
  const [pwError, setPwError] = createSignal('');
  const [pwSuccess, setPwSuccess] = createSignal('');
  const [pwLoading, setPwLoading] = createSignal(false);

  /** Engine sign-in needs no store; the legacy userDB check does. */
  const canSignIn = () => authMode() === 'engine' || (authMode() === 'legacy' && !!props.store);

  const handleLogin = async (e: Event) => {
    e.preventDefault();
    if (!canSignIn()) return;
    setLoginError('');
    setLoginLoading(true);
    try {
      // AccountScreen stays mounted on auth change (it's controlled by showAccount),
      // so signIn may set the user itself. Engine mode signs in on every Engine
      // (agent-engine-dev#582); legacy checks userDB.
      const r = await signIn(username(), password(), props.store);
      if (!r.ok) {
        setLoginError(r.message);
        return;
      }
      setPassword('');
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setLoginLoading(false);
    }
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
    if (!currentUser()) return;
    setPwLoading(true);
    try {
      const r = await changeMyPassword(currentPw(), newPw(), props.store, props.connection?.changeDoc ?? null);
      if (r.ok) {
        setPwSuccess(r.failed.length === 0
          ? 'Password changed.'
          : `Password changed. Not changed on: ${r.failed.map((f) => `${f.engineName} (${f.message})`).join('; ')}`);
        setCurrentPw('');
        setNewPw('');
        setConfirmPw('');
      } else {
        setPwError(r.message);
      }
    } finally {
      setPwLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    // Account Screen stays open showing the login form — no auto modal.
    setSubView('main');
  };

  return (
    <div class="account-screen" data-testid="op-entry">

      {/* ── Operator Management sub-view ───────────────────────────────────── */}
      <Show when={subView() === 'operator-mgmt' && isOperator() && props.store && props.connection}>
        <div class="account-screen__subview">
          <button
            class="account-screen__back-btn"
            onClick={() => setSubView('main')}
          >
            ← Back
          </button>
          <OperatorManagement store={props.store!} connection={props.connection!} />
        </div>
      </Show>

      {/* ── Main view ─────────────────────────────────────────────────────── */}
      <Show when={subView() === 'main'}>

        {/* NOT logged in: show inline login form */}
        <Show when={!isOperator()}>
          <div class="account-screen__section">
            <h2 class="account-screen__heading">Operator Login</h2>
            <form class="modal__form" data-testid="login-form" onSubmit={handleLogin}>
              <label class="form-field">
                <span class="form-field__label">Username</span>
                <input
                  class="form-field__input"
                  type="text"
                  autocomplete="username"
                  value={username()}
                  onInput={(e) => setUsername(e.currentTarget.value)}
                  required
                />
              </label>
              <div class="form-field">
                <span class="form-field__label">Password</span>
                <div class="form-field__password-row">
                  <input
                    class="form-field__input"
                    type={showPassword() ? 'text' : 'password'}
                    autocomplete="current-password"
                    value={password()}
                    onInput={(e) => setPassword(e.currentTarget.value)}
                    required
                  />
                  <button
                    type="button"
                    class="form-field__show-pw"
                    onClick={() => setShowPassword((v) => !v)}
                    title={showPassword() ? 'Hide password' : 'Show password'}
                    aria-label={showPassword() ? 'Hide password' : 'Show password'}
                  >
                    {showPassword() ? '🙈' : '👁'}
                  </button>
                </div>
              </div>
              {loginError() && <p class="form-error">{loginError()}</p>}
              <Show when={!canSignIn()}>
                <p class="form-field__hint" style="color:var(--colour-text-muted)">Waiting for engine to sync…</p>
              </Show>
              <button class="btn btn--primary" type="submit" data-testid="sign-in" disabled={loginLoading() || !canSignIn()}>
                {loginLoading() ? 'Verifying…' : !canSignIn() ? 'Connecting…' : 'Log in'}
              </button>
            </form>
          </div>
        </Show>

        {/* Logged in: show user info + controls */}
        <Show when={isOperator()}>
          <div class="account-screen__section">
            <h2 class="account-screen__heading">Account</h2>
            <p class="account-screen__username">{currentUser()?.username}</p>
            <p class="account-screen__role">Operator</p>
          </div>

          <EngineIssues store={props.store} />

          <div class="account-screen__section">
            <h2 class="account-screen__heading">Change Password</h2>
            <form class="modal__form" data-testid="change-password-form" onSubmit={handleChangePassword}>
              <label class="form-field">
                <span class="form-field__label">Current password</span>
                <input
                  class="form-field__input"
                  type="password"
                  data-testid="change-password-current"
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
                  data-testid="change-password-new"
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
                  data-testid="change-password-confirm"
                  value={confirmPw()}
                  onInput={(e) => setConfirmPw(e.currentTarget.value)}
                  required
                />
              </label>
              {pwError() && <p class="form-error">{pwError()}</p>}
              {pwSuccess() && <p class="form-success" data-testid="change-password-success">{pwSuccess()}</p>}
              <button class="btn btn--primary" type="submit" data-testid="change-password" disabled={pwLoading()}>
                {pwLoading() ? 'Saving…' : 'Change password'}
              </button>
            </form>
          </div>

          <div class="account-screen__section">
            <button
              class="btn btn--secondary"
              data-testid="manage-operators"
              onClick={() => setSubView('operator-mgmt')}
            >
              Manage Operators
            </button>
          </div>

          <div class="account-screen__section account-screen__section--danger">
            <button class="btn btn--danger" data-testid="log-out" onClick={handleLogout}>
              Log out
            </button>
          </div>
        </Show>

      </Show>
    </div>
  );
};

export default AccountScreen;
