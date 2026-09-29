/**
 * FilesRoleForm — the share name field and the createFilesDisk result
 * (files-disk.md §4 and §8, idea#132). Used by "Make this a Files Disk" in
 * the Empty Disk panel and by "Add Files to this disk" on App/Backup Disks.
 *
 * The share name is pre-filled with "School Files" and validated as the
 * operator types. The result comes from createCommandResult: success is an ok
 * createFilesDisk trace for this disk ID and the disk showing 'files'.
 */
import { Show, createMemo, createSignal, type Accessor, type Component, type JSX } from 'solid-js';
import { DEFAULT_SHARE_NAME, createFilesDisk, validateShareName } from '../store/commands';
import { FILES_TIMEOUT_MESSAGE, createCommandResult } from '../store/commandResult';
import type { CommandLogState } from '../store/commandLog';
import type { Disk } from '../types/store';

interface FilesRoleFormProps {
  disk: () => Disk | undefined;
  /** Engine the disk is docked to (the command goes there). */
  engineId: () => string | undefined;
  commandLogStore?: Accessor<CommandLogState>;
  /** Explanation shown above the field. */
  intro: JSX.Element;
  submitLabel: string;
  /** Tooltip when the target Engine can't take the command; the form is disabled. */
  blockedReason?: () => string | undefined;
}

const FilesRoleForm: Component<FilesRoleFormProps> = (props) => {
  const [shareName, setShareName] = createSignal(DEFAULT_SHARE_NAME);
  const shareNameError = createMemo(() => validateShareName(shareName()));

  const result = createCommandResult({
    commandLog: () => props.commandLogStore?.() ?? null,
    command: 'createFilesDisk',
    argKey: 'diskId',
    isSuccess: () => (props.disk()?.diskTypes ?? []).includes('files'),
  });

  const pending = () => result.state().kind === 'pending';
  const blocked = () => props.blockedReason?.();

  const submit = () => {
    const disk = props.disk();
    const engineId = props.engineId();
    const name = shareName();
    if (!disk || !engineId || blocked() || validateShareName(name)) return;
    result.start(disk.id, () => createFilesDisk(engineId, disk.id, name));
  };

  return (
    <div class="edp-form files-form">
      <p class="edp-form__hint">{props.intro}</p>
      <label class="edp-form__label" for="files-share-name">Share name</label>
      <input
        id="files-share-name"
        class="edp-form__search files-form__share-name"
        type="text"
        value={shareName()}
        maxLength={32}
        disabled={pending() || result.state().kind === 'success'}
        aria-invalid={shareNameError() ? 'true' : 'false'}
        onInput={(e) => setShareName((e.target as HTMLInputElement).value)}
      />
      <Show when={shareNameError()}>
        <p class="edp-form__error files-form__share-name-error">{shareNameError()}</p>
      </Show>

      <Show when={result.state().kind === 'pending'}>
        <p class="edp-form__hint files-form__status">Waiting for the Engine…</p>
      </Show>
      <Show when={(() => { const s = result.state(); return s.kind === 'error' ? s.message : null; })()}>
        {(msg) => <p class="edp-form__error files-form__result" role="alert">{msg()}</p>}
      </Show>
      <Show when={result.state().kind === 'timeout'}>
        <p class="edp-form__error files-form__result" role="status">{FILES_TIMEOUT_MESSAGE}</p>
      </Show>
      <Show when={result.state().kind === 'success'}>
        <p class="edp-form__hint files-form__result" role="status">Done. This disk is now a Files Disk.</p>
      </Show>

      <div class="edp-form__actions">
        <button
          class="btn btn--primary"
          disabled={!!blocked() || !!shareNameError() || pending() || result.state().kind === 'success'}
          title={blocked()}
          onClick={submit}
        >
          {props.submitLabel}
        </button>
      </div>
    </div>
  );
};

export default FilesRoleForm;
