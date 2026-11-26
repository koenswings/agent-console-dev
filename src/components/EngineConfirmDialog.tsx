/**
 * The Engine's second confirmation (428 CONFIRM_REQUIRED, agent-engine-dev#582).
 * Shows the summary the Engine built from its own data and asks for the
 * confirmation field. The confirmId expires (60 s); after that the dialog
 * closes and the command is not sent.
 */
import { createEffect, createSignal, For, onCleanup, Show, type Component } from 'solid-js';
import {
  answerEngineConfirm,
  confirmMode,
  confirmPrompt,
  expectedConfirmValue,
  pendingEngineConfirm,
  summaryRows,
} from '../store/engineConfirm';

const EngineConfirmDialog: Component = () => {
  const [typed, setTyped] = createSignal('');
  const rows = () => summaryRows(pendingEngineConfirm()?.req.summary);
  const rowKeys = () => rows().map((r) => r.key);
  const rowByKey = (k: string) => rows().find((r) => r.key === k);
  const expected = () => {
    const p = pendingEngineConfirm();
    return p ? expectedConfirmValue(p.req) : null;
  };
  const acknowledge = () => confirmMode(pendingEngineConfirm()?.req.confirmField ?? '') === 'acknowledge';
  /** Exact match when the summary carries the value; otherwise the Engine checks. */
  const matches = () => {
    const want = expected();
    if (acknowledge()) return want !== null;
    return typed().trim().length > 0 && (want === null || typed().trim() === want);
  };
  /** What goes back as confirmText. */
  const answer = (): string => (acknowledge() ? expected() ?? '' : typed().trim());

  createEffect(() => {
    const p = pendingEngineConfirm();
    setTyped('');
    if (!p) return;
    const ms = Math.max(0, p.expiresAt - performance.now());
    const timer = setTimeout(() => answerEngineConfirm(null), ms);
    onCleanup(() => clearTimeout(timer));
  });

  return (
    <Show when={pendingEngineConfirm()}>
      {(p) => (
        <div class="modal-overlay" data-testid="engine-confirm">
          <div class="modal engine-confirm" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div class="modal__header">
              <span class="modal__title">Confirm on {p().engineName}</span>
              <button class="modal__close" aria-label="Cancel" onClick={() => answerEngineConfirm(null)}>✕</button>
            </div>
            <p class="engine-confirm__message">{p().req.message}</p>
            <dl class="engine-confirm__summary" data-testid="engine-confirm-summary">
              <For each={rowKeys()}>
                {(k) => (
                  <div class="engine-confirm__row">
                    <dt>{rowByKey(k)?.label}</dt>
                    <dd>{rowByKey(k)?.value}</dd>
                  </div>
                )}
              </For>
            </dl>
            <form
              class="modal__form"
              onSubmit={(e) => {
                e.preventDefault();
                if (matches()) answerEngineConfirm(answer());
              }}
            >
              <Show when={!acknowledge()}>
                <label class="form-field">
                  <span class="form-field__label">{confirmPrompt(p().req.confirmField)}</span>
                  <input
                    class="form-field__input"
                    type="text"
                    data-testid="engine-confirm-input"
                    value={typed()}
                    onInput={(e) => setTyped(e.currentTarget.value)}
                    autocomplete="off"
                    required
                  />
                </label>
              </Show>
              <div class="engine-confirm__actions">
                <button type="button" class="btn btn--secondary" data-testid="engine-confirm-cancel" onClick={() => answerEngineConfirm(null)}>
                  Cancel
                </button>
                <button type="submit" class="btn btn--danger" data-testid="engine-confirm-ok" disabled={!matches()}>
                  Confirm
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Show>
  );
};

export default EngineConfirmDialog;
