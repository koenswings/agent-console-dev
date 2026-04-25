import { createSignal, For, Show, type Component } from 'solid-js';
import {
  currentUser,
  createOperator,
  removeOperator,
  changePassword,
} from '../store/auth';
import type { Store, User } from '../types/store';
import type { StoreConnection } from '../mock/mockStore';

interface OperatorManagementProps {
  store: Store;
  connection: StoreConnection;
}

const OperatorManagement: Component<OperatorManagementProps> = (props) => {
  // Add operator form
  const [newUsername, setNewUsername] = createSignal('');
  const [newPassword, setNewPassword] = createSignal('');
  const [addError, setAddError] = createSignal('');
  const [addLoading, setAddLoading] = createSignal(false);
  const [addSuccess, setAddSuccess] = createSignal('');

  // Change password form
  const [currentPw, setCurrentPw] = createSignal('');
  const [newPw, setNewPw] = createSignal('');
  const [confirmPw, setConfirmPw] = createSignal('');
  const [pwError, setPwError] = createSignal('');
  const [pwSuccess, setPwSuccess] = createSignal('');
  const [pwLoading, setPwLoading] = createSignal(false);

  const operators = (): User[] => Object.values(props.store.userDB ?? {});

  const handleAddOperator = async (e: Event) => {
    e.preventDefault();
    setAddError('');
    setAddSuccess('');
    if (newPassword().length < 8) {
      setAddError('Password must be at least 8 characters.');
      return;
    }
    setAddLoading(true);
    try {
      await createOperator(
        newUsername(),
        newPassword(),
        props.store,
        props.connection.changeDoc
      );
      setAddSuccess(`Operator "${newUsername()}" created.`);
      setNewUsername('');
      setNewPassword('');
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to create operator.');
    } finally {
      setAddLoading(false);
    }
  };

  const handleRemove = (userId: string, username: string) => {
    if (userId === currentUser()?.id) {
      alert('You cannot remove yourself.');
      return;
    }
    if (!confirm(`Remove operator "${username}"?`)) return;
    removeOperator(userId, props.connection.changeDoc);
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
    if (!userId) return;
    setPwLoading(true);
    let ok = false;
    try {
      ok = await changePassword(
        userId,
        currentPw(),
        newPw(),
        props.store,
        props.connection.changeDoc
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

  return (
    <div class="operator-mgmt">
      {/* Operator list */}
      <section class="operator-mgmt__section">
        <h2 class="operator-mgmt__heading">Operators</h2>
        <Show
          when={operators().length > 0}
          fallback={<p class="operator-mgmt__empty">No operators yet.</p>}
        >
          <ul class="operator-mgmt__list">
            <For each={operators()}>
              {(op) => (
                <li class="operator-mgmt__item">
                  <span class="operator-mgmt__name">
                    {op.username}
                    {op.id === currentUser()?.id && (
                      <span class="operator-mgmt__you"> (you)</span>
                    )}
                  </span>
                  <button
                    class="btn btn--danger btn--small"
                    onClick={() => handleRemove(op.id, op.username)}
                    disabled={op.id === currentUser()?.id}
                  >
                    Remove
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      {/* Add operator */}
      <section class="operator-mgmt__section">
        <h2 class="operator-mgmt__heading">Add Operator</h2>
        <form class="modal__form" onSubmit={handleAddOperator}>
          <label class="form-field">
            <span class="form-field__label">Username</span>
            <input
              class="form-field__input"
              type="text"
              value={newUsername()}
              onInput={(e) => setNewUsername(e.currentTarget.value)}
              required
            />
          </label>
          <label class="form-field">
            <span class="form-field__label">Password</span>
            <input
              class="form-field__input"
              type="password"
              value={newPassword()}
              onInput={(e) => setNewPassword(e.currentTarget.value)}
              required
              minLength={8}
            />
          </label>
          {addError() && <p class="form-error">{addError()}</p>}
          {addSuccess() && <p class="form-success">{addSuccess()}</p>}
          <button class="btn btn--primary" type="submit" disabled={addLoading()}>
            {addLoading() ? 'Creating…' : 'Add operator'}
          </button>
        </form>
      </section>

      {/* Change own password */}
      <section class="operator-mgmt__section">
        <h2 class="operator-mgmt__heading">Change My Password</h2>
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
      </section>
    </div>
  );
};

export default OperatorManagement;
