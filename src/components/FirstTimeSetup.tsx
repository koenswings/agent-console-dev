import { createSignal, type Component } from 'solid-js';
import { createOperator, login } from '../store/auth';
import type { Store } from '../types/store';
import type { StoreConnection } from '../mock/mockStore';

interface FirstTimeSetupProps {
  store: Store;
  connection: StoreConnection;
  onComplete: () => void;
}

const FirstTimeSetup: Component<FirstTimeSetupProps> = (props) => {
  const [username, setUsername] = createSignal('admin');
  const [password, setPassword] = createSignal('');
  const [confirm, setConfirm] = createSignal('');
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError('');

    if (password() !== confirm()) {
      setError('Passwords do not match.');
      return;
    }
    if (password().length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      await createOperator(username(), password(), props.store, props.connection.changeDoc);
      // Auto-login after creating the first account
      // Note: store signal will update via Automerge sync; use a fresh snapshot
      // for login by re-reading after changeDoc. For simplicity, construct the
      // updated store inline.
      const updatedStore = props.connection.store();
      if (updatedStore) {
        await login(username(), password(), updatedStore);
      }
      props.onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="first-time-setup">
      <div class="first-time-setup__card">
        <h1 class="first-time-setup__title">Welcome to IDEA Console</h1>
        <p class="first-time-setup__subtitle">
          Create the first operator account to get started.
        </p>

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

          <label class="form-field">
            <span class="form-field__label">Password</span>
            <input
              class="form-field__input"
              type="password"
              autocomplete="new-password"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              required
              minLength={8}
            />
          </label>

          <label class="form-field">
            <span class="form-field__label">Confirm Password</span>
            <input
              class="form-field__input"
              type="password"
              autocomplete="new-password"
              value={confirm()}
              onInput={(e) => setConfirm(e.currentTarget.value)}
              required
            />
          </label>

          {error() && <p class="form-error">{error()}</p>}

          <button
            class="btn btn--primary"
            type="submit"
            disabled={loading()}
          >
            {loading() ? 'Creating account…' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default FirstTimeSetup;
