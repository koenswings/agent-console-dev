/**
 * UnformattedDiskView — right pane for an Engine.unformattedDisks candidate
 * (files-disk.md §8, idea#136): Make this a Files Disk (erase-first only) and
 * Erase this disk….
 */
import { Show, createMemo, createSignal, type Accessor, type Component } from 'solid-js';
import EraseDialog, { type EraseMode } from './EraseDialog';
import { DEFAULT_SHARE_NAME, UPDATE_ENGINE_TOOLTIP, engineHasCapability, validateShareName } from '../store/commands';
import { eraseBlockedReason, findUnformatted } from '../store/erase';
import { formatBytes as fmt } from '../store/diskRoles';
import type { CommandLogState } from '../store/commandLog';
import type { Selection } from './NetworkTree';
import type { Store } from '../types/store';

interface UnformattedDiskViewProps {
  engineId: string;
  candidateId: string;
  store: () => Store | null;
  commandLogStore?: Accessor<CommandLogState>;
  onSelect: (selection: Selection) => void;
}

const UnformattedDiskView: Component<UnformattedDiskViewProps> = (props) => {
  const candidate = createMemo(() => findUnformatted(props.store(), props.engineId, props.candidateId));
  const engine = () => props.store()?.engineDB[props.engineId];
  const eraseBlocked = createMemo(() =>
    eraseBlockedReason(engine(), props.store(), props.candidateId)
  );
  const filesBlocked = createMemo((): string | undefined =>
    engineHasCapability(engine(), 'filesDisk') ? undefined : UPDATE_ENGINE_TOOLTIP
  );

  const [dialog, setDialog] = createSignal<{ mode: EraseMode; shareName?: string } | null>(null);
  const [shareName, setShareName] = createSignal(DEFAULT_SHARE_NAME);
  const shareErr = createMemo(() => validateShareName(shareName()));
  const [filesOpen, setFilesOpen] = createSignal(false);

  const openErase = (mode: EraseMode) => {
    if (eraseBlocked()) return;
    if (mode === 'erase-then-files' && (filesBlocked() || shareErr())) return;
    setDialog({ mode, shareName: shareName() });
  };

  return (
    <section class="disk-view unformatted-disk-view" aria-label="Unformatted disk">
      <header class="disk-view__header">
        <span class="disk-view__icon" aria-hidden="true">💾</span>
        <span class="disk-view__title">{candidate()?.label ?? props.candidateId}</span>
        <span class="disk-view__badge-unformatted">unformatted</span>
      </header>

      <Show when={candidate()}>
        {(c) => (
          <div class="unformatted-disk-view__meta">
            <Show when={c().model}><p>Model: {c().model}</p></Show>
            <p>Size: {fmt(c().sizeBytes)}</p>
            <Show when={c().fsType}><p>Filesystem: {c().fsType}</p></Show>
            <p class="edp-form__hint">Contents unknown until the disk is erased into an empty IDEA disk.</p>
          </div>
        )}
      </Show>

      <Show when={!dialog()}>
        <section class="disk-section" aria-label="Make this a Files Disk">
          <Show
            when={filesOpen()}
            fallback={
              <button
                class="btn"
                disabled={!!eraseBlocked() || !!filesBlocked()}
                title={eraseBlocked() || filesBlocked()}
                onClick={() => setFilesOpen(true)}
              >
                Make this a Files Disk
              </button>
            }
          >
            <h3 class="disk-section__title">Make this a Files Disk</h3>
            <p class="edp-form__hint">Removes everything on it, then makes it a Files Disk.</p>
            <label class="edp-form__label" for="unformatted-share-name">Share name</label>
            <input
              id="unformatted-share-name"
              class="edp-form__search"
              type="text"
              value={shareName()}
              maxLength={32}
              onInput={(e) => setShareName((e.target as HTMLInputElement).value)}
            />
            <Show when={shareErr()}>
              <p class="edp-form__error">{shareErr()}</p>
            </Show>
            <div class="edp-form__actions">
              <button class="btn" onClick={() => setFilesOpen(false)}>Close</button>
              <button
                class="btn btn--danger"
                disabled={!!eraseBlocked() || !!filesBlocked() || !!shareErr()}
                title={eraseBlocked() || filesBlocked()}
                onClick={() => openErase('erase-then-files')}
              >
                Erase the disk first
              </button>
            </div>
          </Show>
        </section>

        <div class="disk-view__erase">
          <button
            class="btn-text btn-text--danger"
            disabled={!!eraseBlocked()}
            title={eraseBlocked()}
            onClick={() => openErase('erase')}
          >
            Erase this disk…
          </button>
        </div>
      </Show>

      <Show when={dialog()}>
        {(d) => (
          <EraseDialog
            targetId={props.candidateId}
            engineId={props.engineId}
            fallbackLabel={candidate()?.label ?? props.candidateId}
            mode={d().mode}
            shareName={d().shareName}
            store={props.store}
            commandLogStore={props.commandLogStore}
            onClose={() => setDialog(null)}
            onErasedEmpty={(id) => {
              setDialog(null);
              props.onSelect({ type: 'disk', id });
            }}
            onBecameFiles={(id) => {
              setDialog(null);
              props.onSelect({ type: 'disk', id });
            }}
            onFilesFailed={(id, _msg) => {
              setDialog(null);
              props.onSelect({ type: 'disk', id });
            }}
          />
        )}
      </Show>
    </section>
  );
};

export default UnformattedDiskView;
