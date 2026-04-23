import { createSignal, Show, type Component } from 'solid-js';
import { bcryptCompare } from '../store/bcryptCompare';
import { setAuthenticatedUser } from '../store/auth';
import type { Store, User } from '../types/store';

interface LoginFormProps {
  store: Store | null;
  onSuccess: () => void;
  onCancel: () => void;
}

const LoginForm: Component<LoginFormProps> = (props) => {
  const [username, setUsername] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [showPassword, setShowPassword] = createSignal(false);
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!props.store) return;

    setError('');
    setLoading(true);

    let loggedInUser: User | null = null;

    try {
      const users = Object.values(props.store.userDB ?? {}) as User[];
      const user = users.find((u) => String(u.username) === username());
      if (!user) {
        setError('Invalid username or password.');
        return;
      }

      // Use compareSync wrapped in a Promise so the UI can re-paint before
      // the blocking bcrypt work starts. bcryptjs's async compare() uses
      // scheduler.postTask in modern browsers which can silently hang;
      // compareSync is always reliable.
      const hash = String(user.passwordHash);
      const match = await bcryptCompare(password(), hash);

      if (!match) {
        setError('Invalid username or password.');
        return;
      }

      // Stash the user — do NOT call setAuthenticatedUser here.
      // Reason: setAuthenticatedUser calls setCurrentUser() which is a global
      // Solid signal. That synchronously flips isOperator() → true, which
      // causes the outer <Show when={isOperator()}> in App.tsx to destroy
      // this component's reactive root. The finally block then tries to call
      // setLoading(false) on a disposed signal — it's a silent no-op, so the
      // button stays stuck on "Verifying…" forever.
      // Fix: clear our own loading state first (via finally), THEN hand off
      // control to the parent by calling onSuccess + setAuthenticatedUser
      // after the finally block has run.
      loggedInUser = user;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      // Always clear loading state while this component is still alive.
      // If we do this after setAuthenticatedUser, the component may already
      // be disposed and this becomes a no-op.
      setLoading(false);
    }

    // Post-finally: safe to hand off now. The component's own signals are
    // settled, so disposing it (via the parent's Show flip) is clean.
    if (loggedInUser) {
      // onSuccess() tells the parent to set showLogin(false).
      // setAuthenticatedUser() sets the global currentUser signal which flips
      // isOperator() and destroys this component. Order matters: if we call
      // setAuthenticatedUser first, Solid schedules component disposal before
      // onSuccess runs and showLogin never gets cleared.
      props.onSuccess();
      await setAuthenticatedUser(loggedInUser);
    }
  };

  return (
    <div class="modal-overlay">
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal__header">
          <span class="modal__title">Operator Login</span>
          <button class="modal__close" onClick={props.onCancel}>✕</button>
        </div>

        <form class="modal__form" onSubmit={handleSubmit}>
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

          {error() && <p class="form-error">{error()}</p>}

          <Show when={!props.store}>
            <p class="form-field__hint" style="color:var(--colour-text-muted)">Waiting for engine to sync…</p>
          </Show>
          <button class="btn btn--primary" type="submit" disabled={loading() || !props.store}>
            {loading() ? 'Verifying…' : !props.store ? 'Connecting…' : 'Log in'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginForm;
