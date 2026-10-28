/**
 * Remove-instance control (idea#347, option A: quarantine). Rendered in the
 * expanded instance panel only when the Engine has the `removeInstance`
 * capability, so older Engines show exactly what they did before.
 */
import { Show, createSignal, type Accessor, type Component } from 'solid-js';
import { removeInstance } from '../store/commands';
import { createCommandResult } from '../store/commandResult';
import type { CommandLogState } from '../store/commandLog';
import { remoteWatchFor } from '../store/remoteConfirm';
import { friendlyRemoveError, removeBlockedReason, removeConfirmText } from '../store/removeInstance';
import CommandFeedback from './CommandFeedback';
import type { Engine, Instance, Store } from '../types/store';

interface Props {
  instance: Accessor<Instance | undefined>;
  engine: Accessor<Engine | undefined>;
  store: Accessor<Store | null>;
  commandLog: Accessor<CommandLogState>;
  locked: Accessor<boolean>;
}

const RemoveInstanceControl: Component<Props> = (props) => {
  const [confirming, setConfirming] = createSignal(false);
  const result = createCommandResult({ commandLog: props.commandLog, command: 'removeInstance', argKey: 'instanceId', matchMode: 'includes' });
  const blocked = () => removeBlockedReason(props.instance(), props.locked());
  const id = () => props.instance()?.id ?? '';
  const busy = () => { const k = result.state().kind; return k === 'pending' || k === 'sent'; };

  const send = () => {
    const engine = props.engine();
    const inst = props.instance();
    if (!engine || !inst) return;
    setConfirming(false);
    const instId = inst.id;
    result.start(instId, () => removeInstance(engine.id, instId), {
      command: 'removeInstance',
      argKey: 'instanceId',
      matchMode: 'includes',
      longRunning: true,
      engineId: engine.id,
      remote: remoteWatchFor(props.store, engine.id, 'removeInstance', () => (props.store()?.instanceDB?.[instId] ? null : 'ok')),
    });
  };

  return (
    <div class="instance-remove" data-testid={`remove-instance-${id()}`}>
      <Show
        when={confirming()}
        fallback={
          <button
            class="btn btn--remove"
            data-testid={`remove-instance-btn-${id()}`}
            disabled={!!blocked() || busy()}
            title={blocked() ?? 'Remove this app from this disk'}
            onClick={() => { result.reset(); setConfirming(true); }}
          >
            Remove from this disk…
          </button>
        }
      >
        <div class="instance-remove__confirm" role="alertdialog" aria-label={`Remove ${props.instance()?.name}`}>
          <p class="instance-remove__text" data-testid={`remove-instance-text-${id()}`}>
            {removeConfirmText(props.instance()?.name ?? '')}
          </p>
          <div class="instance-remove__buttons">
            <button class="btn btn--remove" data-testid={`remove-instance-confirm-${id()}`} disabled={!!blocked()} onClick={send}>Remove</button>
            <button class="btn" data-testid={`remove-instance-cancel-${id()}`} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      </Show>
      <Show when={blocked() && !confirming()}>
        <p class="edp-form__hint" data-testid={`remove-instance-hint-${id()}`}>{blocked()}</p>
      </Show>
      <Show when={busy()}>
        <p class="edp-form__hint" role="status">Removing…</p>
      </Show>
      <CommandFeedback result={result} subject={() => props.instance()?.name ?? ''} testId={`remove-instance-${id()}`} formatError={friendlyRemoveError} />
    </div>
  );
};

export default RemoveInstanceControl;
