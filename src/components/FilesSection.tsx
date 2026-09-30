/**
 * FilesSection — the Files role of a disk (files-disk.md §4 and §8,
 * idea#132): share name, size and free space, one of the three "available
 * in" lines, Not mounted (password case or a stuck unmount), the low-space
 * warning and Eject. Derived signals only.
 */
import { For, Show, createMemo, createSignal, type Accessor, type Component } from 'solid-js';
import EjectConfirm from './EjectConfirm';
import { ejectDisk } from '../store/commands';
import { createCommandResult } from '../store/commandResult';
import { isDiskLocked } from '../store/operations';
import {
  canEject,
  isCombinedDisk,
  filesAvailability,
  filesAvailabilityText,
  filesNotMountedReason,
  formatBytes,
  lowSpaceWarning,
} from '../store/diskRoles';
import type { CommandLogState } from '../store/commandLog';
import type { Disk, Store } from '../types/store';

interface FilesSectionProps {
  disk: () => Disk | undefined;
  store: () => Store | null;
  commandLogStore?: Accessor<CommandLogState>;
}

const FilesSection: Component<FilesSectionProps> = (props) => {
  const notMounted = createMemo(() => {
    const d = props.disk();
    return d ? filesNotMountedReason(d) : null;
  });
  const availability = createMemo(() => {
    const d = props.disk();
    return d ? filesAvailability(d, props.store()) : { kind: 'none' as const };
  });
  // ID list for the mounted state, so <For> is keyed by instance ID
  const mountedIds = createMemo(
    (): string[] => { const a = availability(); return a.kind === 'mounted' ? a.instances.map((i) => i.instanceId) : []; },
    [],
    { equals: (a, b) => a.length === b.length && a.every((x, i) => x === b[i]) }
  );
  const mountedLabel = (id: string) => {
    const a = availability();
    return a.kind === 'mounted' ? a.instances.find((i) => i.instanceId === id)?.label ?? id : id;
  };
  const lowSpace = createMemo(() => {
    const d = props.disk();
    return d ? lowSpaceWarning(d, props.store()) : null;
  });
  const sizeLine = createMemo(() => {
    const d = props.disk();
    if (d?.sizeBytes == null || d.freeBytes == null) return null;
    return `${formatBytes(d.freeBytes)} free of ${formatBytes(d.sizeBytes)}`;
  });

  const eject = createCommandResult({
    commandLog: () => props.commandLogStore?.() ?? null,
    command: 'ejectDisk',
    argKey: 'diskId',
  });
  const ejectShown = () => { const d = props.disk(); return !!d && canEject(d); };
  const ejectLocked = () => { const d = props.disk(); return !!d && isDiskLocked(props.store(), d.id); };
  const [confirming, setConfirming] = createSignal(false);
  const onEjectClick = () => {
    const d = props.disk();
    if (!d) return;
    if (isCombinedDisk(d, props.store())) setConfirming(true);
    else doEject();
  };
  const doEject = () => {
    setConfirming(false);
    const d = props.disk();
    if (!d?.dockedTo || ejectLocked()) return;
    const engineId = String(d.dockedTo);
    eject.start(d.id, () => ejectDisk(engineId, d.id));
  };

  return (
    <section class="disk-section disk-section--files" aria-label="Files" data-testid="disk-section-files">
      <h3 class="disk-section__title">Files</h3>
      <Show when={props.disk()?.filesConfig?.shareName}>
        <p class="files-section__share">Share name: <strong>{props.disk()?.filesConfig?.shareName}</strong></p>
      </Show>
      <Show when={sizeLine()}>
        <p class="files-section__size">{sizeLine()}</p>
      </Show>
      <Show when={lowSpace()}>
        <p class="files-section__low-space" role="status">{lowSpace()}</p>
      </Show>

      <Show
        when={notMounted()}
        fallback={
          <p class={`files-section__availability files-section__availability--${availability().kind}`}>
            <Show
              when={availability().kind === 'mounted'}
              fallback={filesAvailabilityText(availability())}
            >
              Available in:{' '}
              <For each={mountedIds()}>
                {(id, i) => (
                  <span data-instance-id={id}>{i() > 0 ? ', ' : ''}{mountedLabel(id)}</span>
                )}
              </For>
            </Show>
          </p>
        }
      >
        <p class="files-section__not-mounted" role="alert">Not mounted: {notMounted()}</p>
      </Show>

      <Show when={ejectShown()}>
        <div class="files-section__actions">
          <button
            class="btn files-section__eject"
            disabled={ejectLocked() || eject.state().kind === 'pending'}
            title={ejectLocked() ? 'Operation in progress — cannot eject' : `Eject ${props.disk()?.name}`}
            onClick={onEjectClick}
          >
            Eject
          </button>
          <Show when={confirming()}>
            <EjectConfirm disk={props.disk} store={props.store} onConfirm={doEject} onCancel={() => setConfirming(false)} />
          </Show>
          <Show when={(() => { const s = eject.state(); return s.kind === 'error' ? s.message : null; })()}>
            {(msg) => <p class="edp-form__error" role="alert">Couldn't eject {props.disk()?.name}: {msg()}</p>}
          </Show>
          <Show when={eject.state().kind === 'timeout'}>
            <p class="edp-form__hint" role="status">No response from the Engine for ejecting {props.disk()?.name}. Check History for details.</p>
          </Show>
        </div>
      </Show>
    </section>
  );
};

export default FilesSection;
