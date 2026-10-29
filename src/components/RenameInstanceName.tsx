/**
 * Inline rename of an instance's display name (agent-engine-dev#220, PR #266).
 * Without the `renameInstance` capability this renders the plain name, exactly
 * as before.
 */
import { Show, createSignal, type Accessor, type Component } from 'solid-js';
import { renameInstance } from '../store/commands';
import { createCommandResult } from '../store/commandResult';
import type { CommandLogState } from '../store/commandLog';
import { remoteWatchFor } from '../store/remoteConfirm';
import { canOfferRename, friendlyRenameError, isSameName, normaliseName, renameProblem, MAX_NAME_LENGTH } from '../store/renameInstance';
import CommandFeedback from './CommandFeedback';
import type { Engine, Instance, Store } from '../types/store';

interface Props {
  instance: Accessor<Instance | undefined>;
  engine: Accessor<Engine | undefined>;
  store: Accessor<Store | null>;
  commandLog: Accessor<CommandLogState>;
}

const RenameInstanceName: Component<Props> = (props) => {
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const result = createCommandResult({ commandLog: props.commandLog, command: 'renameInstance', argKey: 'instanceId', matchMode: 'includes' });
  const id = () => props.instance()?.id ?? '';
  const engineId = () => props.engine()?.id ?? '';
  const problem = () => (editing() ? renameProblem(draft(), props.instance(), props.store(), engineId()) : null);
  const offer = () => canOfferRename(props.engine());

  const begin = () => { result.reset(); setDraft(props.instance()?.name ?? ''); setEditing(true); };
  const save = () => {
    const engine = props.engine();
    const inst = props.instance();
    if (!engine || !inst || problem()) return;
    setEditing(false);
    if (isSameName(draft(), inst)) return;
    const name = normaliseName(draft());
    const instId = inst.id;
    result.start(instId, () => renameInstance(engine.id, instId, name), {
      command: 'renameInstance',
      argKey: 'instanceId',
      matchMode: 'includes',
      engineId: engine.id,
      remote: remoteWatchFor(props.store, engine.id, 'renameInstance', () => (props.store()?.instanceDB?.[instId]?.name === name ? 'ok' : null)),
    });
  };

  return (
    <>
      <Show
        when={editing()}
        fallback={
          <div class="instance-row__name">
            {props.instance()?.name}
            <Show when={offer()}>
              <button
                class="instance-rename__btn"
                data-testid={`rename-instance-btn-${id()}`}
                title="Rename"
                aria-label={`Rename ${props.instance()?.name}`}
                onClick={begin}
              >
                ✎
              </button>
            </Show>
          </div>
        }
      >
        <form class="instance-rename" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <input
            class="instance-rename__input"
            data-testid={`rename-instance-input-${id()}`}
            value={draft()}
            maxLength={MAX_NAME_LENGTH + 8}
            aria-label="New name"
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }}
            ref={(el) => queueMicrotask(() => el.focus())}
          />
          <button type="submit" class="btn" data-testid={`rename-instance-save-${id()}`} disabled={!!problem()}>Save</button>
          <button type="button" class="btn" data-testid={`rename-instance-cancel-${id()}`} onClick={() => setEditing(false)}>Cancel</button>
          <Show when={problem()}>
            <p class="edp-form__hint" data-testid={`rename-instance-problem-${id()}`}>{problem()}</p>
          </Show>
        </form>
      </Show>
      <CommandFeedback result={result} subject={() => props.instance()?.name ?? ''} testId={`rename-instance-${id()}`} formatError={friendlyRenameError} />
    </>
  );
};

export default RenameInstanceName;
