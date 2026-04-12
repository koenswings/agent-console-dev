import { createSignal, type Component } from 'solid-js';
import { login } from '../store/auth';
import type { Store } from '../types/store';

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
      const ok = await login(username(), password(), props.store);
      if (ok) {
        props.onSuccess();
      } else {
        setError('Invalid username or password.');
      }
    } catch (err) {
      console.error('[login]', err);
      setError('Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="modal-overlay" onClick={props.onCancel}>
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
