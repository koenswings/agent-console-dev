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

      setAuthenticatedUser(user);
      props.onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setLoading(false);
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
