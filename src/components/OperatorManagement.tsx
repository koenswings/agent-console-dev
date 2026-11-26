import { createEffect, createSignal, For, Show, type Component } from 'solid-js';
import {
  currentUser,
  createOperator,
  removeOperator,
  changeMyPassword,
  addOperatorEverywhere,
  removeOperatorEverywhere,
  listPageOperators,
  type EngineIssue,
} from '../store/auth';
import { isEngineAuth } from '../store/authMode';
import type { Store } from '../types/store';
import type { StoreConnection } from '../mock/mockStore';

/** One operator row: from userDB (legacy) or the page's Engine (agent-engine-dev#582). */
interface OperatorRow {
  id: string;
  username: string;
}

const notOn = (failed: EngineIssue[]): string =>
  failed.length === 0 ? '' : ` Not applied on: ${failed.map((f) => `${f.engineName} (${f.message})`).join('; ')}`;

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

  // Engine mode: the page's Engine lists its operators (no hashes); reloaded after a change.
  const [engineOps, setEngineOps] = createSignal<OperatorRow[]>([]);
  const [listError, setListError] = createSignal('');
  const reloadEngineOps = async (): Promise<void> => {
    try {
      const list = await listPageOperators();
      setEngineOps(list.map((o) => ({ id: String(o.id), username: String(o.username) })));
      setListError('');
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Could not load the operators.');
    }
  };
  createEffect(() => {
    if (isEngineAuth()) void reloadEngineOps();
  });

  const operators = (): OperatorRow[] => isEngineAuth()
    ? engineOps()
    : Object.values(props.store.userDB ?? {}).map((u) => ({ id: String(u.id), username: String(u.username) }));
  const operatorIds = () => operators().map((o) => o.id);
  const operatorById = (id: string) => operators().find((o) => o.id === id);

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
      if (isEngineAuth()) {
        // agent-engine-dev#582: on every Engine this page is signed in to.
        const r = await addOperatorEverywhere(newUsername(), newPassword(), props.store);
        if (!r.ok) {
          setAddError(r.message);
          return;
        }
        setAddSuccess(`Operator "${newUsername()}" created.${notOn(r.failed)}`);
        await reloadEngineOps();
      } else {
        await createOperator(
          newUsername(),
          newPassword(),
          props.store,
          props.connection.changeDoc
        );
        setAddSuccess(`Operator "${newUsername()}" created.`);
      }
      setNewUsername('');
      setNewPassword('');
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to create operator.');
    } finally {
      setAddLoading(false);
    }
  };

  const [removeError, setRemoveError] = createSignal('');

  const handleRemove = async (userId: string, username: string) => {
    if (userId === currentUser()?.id) {
      alert('You cannot remove yourself.');
      return;
    }
    if (!confirm(`Remove operator "${username}"?`)) return;
    setRemoveError('');
    if (!isEngineAuth()) {
      removeOperator(userId, props.connection.changeDoc);
      return;
    }
    // Accounts are per Engine: matched by username on each one.
    const r = await removeOperatorEverywhere(username, props.store);
    if (!r.ok) setRemoveError(r.message);
    else if (r.failed.length > 0) setRemoveError(`Removed.${notOn(r.failed)}`);
    await reloadEngineOps();
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
      const r = await changeMyPassword(currentPw(), newPw(), props.store, props.connection.changeDoc);
      if (r.ok) {
        setPwSuccess(`Password changed.${notOn(r.failed)}`);
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

  return (
    <div class="operator-mgmt" data-testid="operator-management">
      {/* Operator list */}
      <section class="operator-mgmt__section">
        <h2 class="operator-mgmt__heading">Operators</h2>
        <Show
          when={operators().length > 0}
          fallback={<p class="operator-mgmt__empty">No operators yet.</p>}
        >
          <ul class="operator-mgmt__list">
            <For each={operatorIds()}>
              {(id) => (
                <li
                  class="operator-mgmt__item"
                  data-testid={`operator-row-${id}`}
                  data-username={operatorById(id)?.username}
                >
                  <span class="operator-mgmt__name">
                    {operatorById(id)?.username}
                    {id === currentUser()?.id && (
                      <span class="operator-mgmt__you"> (you)</span>
                    )}
                  </span>
                  <button
                    class="btn btn--danger btn--small"
                    data-testid={`remove-operator-${id}`}
                    onClick={() => handleRemove(id, operatorById(id)?.username ?? '')}
                    disabled={id === currentUser()?.id}
                  >
                    Remove
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        {listError() && <p class="form-error" data-testid="operator-list-error">{listError()}</p>}
        {removeError() && <p class="form-error" data-testid="remove-operator-error">{removeError()}</p>}
      </section>

      {/* Add operator */}
      <section class="operator-mgmt__section">
        <h2 class="operator-mgmt__heading">Add Operator</h2>
        <form class="modal__form" data-testid="add-operator-form" onSubmit={handleAddOperator}>
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
          {addSuccess() && <p class="form-success" data-testid="add-operator-success">{addSuccess()}</p>}
          <button class="btn btn--primary" type="submit" data-testid="add-operator" disabled={addLoading()}>
            {addLoading() ? 'Creating…' : 'Add operator'}
          </button>
        </form>
      </section>

      {/* Change own password */}
      <section class="operator-mgmt__section">
        <h2 class="operator-mgmt__heading">Change My Password</h2>
        <form
          class="modal__form"
          data-testid="change-password-form"
          onSubmit={handleChangePassword}
        >
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
          {pwError() && <p class="form-error" data-testid="change-password-error">{pwError()}</p>}
          {pwSuccess() && <p class="form-success" data-testid="change-password-success">{pwSuccess()}</p>}
          <button
            class="btn btn--primary"
            type="submit"
            data-testid="change-password"
            disabled={pwLoading()}
          >
            {pwLoading() ? 'Saving…' : 'Change password'}
          </button>
        </form>
      </section>
    </div>
  );
};

export default OperatorManagement;
