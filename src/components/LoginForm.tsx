import { createSignal, type Component } from 'solid-js';
import bcrypt from 'bcryptjs';
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
      // Find user
      const users = Object.values(props.store.userDB ?? {}) as User[];
      const user = users.find((u) => String(u.username) === username());
      if (!user) {
        setError('Invalid username or password.');
        setLoading(false);
        return;
      }

      // Compare — bcrypt with timeout so it can't hang forever
      const hash = String(user.passwordHash);
      const match = await Promise.race([
        bcrypt.compare(password(), hash),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Login timed out — please try again.')), 10_000)
        ),
      ]);

      if (!match) {
        setError('Invalid username or password.');
        setLoading(false);
        return;
      }

      // Verified — set user and persist session (no second bcrypt call)
      await setAuthenticatedUser(user);
      props.onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.');
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

          <button
            class="btn btn--primary"
            type="submit"
            disabled={loading()}
          >
            {loading() ? 'Verifying…' : 'Log in'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginForm;
