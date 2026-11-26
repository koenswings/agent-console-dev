/**
 * First operator on one Engine with its one-time setup code (agent-engine-dev#582 §4).
 * Named per Engine: each fresh Engine shows its own code (Engine log, its
 * screen, or the setup-code file for Ops).
 */
import { createSignal, type Component } from 'solid-js';
import { setupWithCode } from '../store/auth';
import type { Store } from '../types/store';

interface EngineSetupFormProps {
  engineId: string;
  engineName: string;
  store: Store | null;
  /** Called after the Engine accepted the code and created the operator. */
  onDone?: () => void;
}

const EngineSetupForm: Component<EngineSetupFormProps> = (props) => {
  const [code, setCode] = createSignal('');
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
    let ok = false;
    try {
      const r = await setupWithCode(props.engineId, code(), username(), password(), props.store);
      if (r.ok) ok = true;
      else setError(r.message);
    } finally {
      setLoading(false);
    }
    if (ok) {
      setPassword('');
      setConfirm('');
      props.onDone?.();
    }
  };

  return (
    <form
      class="modal__form engine-setup"
      data-testid={`engine-setup-form-${props.engineId}`}
      onSubmit={handleSubmit}
    >
      <p class="engine-setup__intro">
        Enter the setup code shown on <strong>{props.engineName}</strong>, then choose its first operator.
      </p>
      <label class="form-field">
        <span class="form-field__label">Setup code</span>
        <input
          class="form-field__input engine-setup__code"
          type="text"
          data-testid="engine-setup-code"
          autocomplete="one-time-code"
          placeholder="XXXX-XXXX"
          value={code()}
          onInput={(e) => setCode(e.currentTarget.value)}
          required
        />
      </label>
      <label class="form-field">
        <span class="form-field__label">Username</span>
        <input
          class="form-field__input"
          type="text"
          autocomplete="username"
          data-testid="engine-setup-username"
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
          data-testid="engine-setup-password"
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
          data-testid="engine-setup-confirm"
          value={confirm()}
          onInput={(e) => setConfirm(e.currentTarget.value)}
          required
        />
      </label>
      {error() && <p class="form-error" data-testid="engine-setup-error">{error()}</p>}
      <button class="btn btn--primary" type="submit" data-testid="engine-setup-submit" disabled={loading()}>
        {loading() ? 'Setting up…' : `Set up ${props.engineName}`}
      </button>
    </form>
  );
};

export default EngineSetupForm;
