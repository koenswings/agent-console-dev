/**
 * EjectConfirm — confirmation before ejecting a combined disk (idea#157,
 * files-disk.md §4 step 6 and §8): lists the disk's roles and everything
 * affected: instances on the disk that stop, Apps that lose its files and
 * backups that become unavailable.
 */
import { For, Show, createMemo, type Component } from 'solid-js';
import { ejectImpact, rolesSentence, type ImpactItem } from '../store/diskRoles';
import type { Disk, Store } from '../types/store';

interface EjectConfirmProps {
  disk: () => Disk | undefined;
  store: () => Store | null;
  onConfirm: () => void;
  onCancel: () => void;
}

const sameItems = (a: ImpactItem[], b: ImpactItem[]) =>
  a.length === b.length && a.every((x, i) => x.id === b[i].id && x.text === b[i].text);

const EjectConfirm: Component<EjectConfirmProps> = (props) => {
  const impact = createMemo(() => {
    const d = props.disk();
    return d ? ejectImpact(d, props.store()) : null;
  });
  // ID lists so each <For> is keyed by instance ID
  const ids = (pick: (i: NonNullable<ReturnType<typeof impact>>) => ImpactItem[]) =>
    createMemo(() => { const i = impact(); return i ? pick(i) : []; }, [], { equals: sameItems });
  const stopping = ids((i) => i.stopping);
  const losing = ids((i) => i.losingFiles);
  const backups = ids((i) => i.unavailableBackups);
  const stoppingIds = createMemo(() => stopping().map((x) => x.id));
  const losingIds = createMemo(() => losing().map((x) => x.id));
  const backupIds = createMemo(() => backups().map((x) => x.id));
  const textOf = (list: () => ImpactItem[], id: string) => list().find((x) => x.id === id)?.text ?? id;

  return (
    <div
      class="eject-confirm"
      role="dialog"
      aria-label={`Eject ${props.disk()?.name ?? ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      <p class="eject-confirm__title">
        Eject {props.disk()?.name}? It is {rolesSentence(impact()?.roles ?? [])}.
      </p>
      <Show when={stoppingIds().length > 0}>
        <p class="eject-confirm__label">These Apps stop:</p>
        <ul class="eject-confirm__list eject-confirm__list--stopping">
          <For each={stoppingIds()}>{(id) => <li data-instance-id={id}>{textOf(stopping, id)}</li>}</For>
        </ul>
      </Show>
      <Show when={losingIds().length > 0}>
        <p class="eject-confirm__label">These Apps lose its files:</p>
        <ul class="eject-confirm__list eject-confirm__list--files">
          <For each={losingIds()}>{(id) => <li data-instance-id={id}>{textOf(losing, id)}</li>}</For>
        </ul>
      </Show>
      <Show when={backupIds().length > 0}>
        <p class="eject-confirm__label">These backups become unavailable:</p>
        <ul class="eject-confirm__list eject-confirm__list--backups">
          <For each={backupIds()}>{(id) => <li data-instance-id={id}>{textOf(backups, id)}</li>}</For>
        </ul>
      </Show>
      <div class="eject-confirm__actions">
        <button class="btn" onClick={() => props.onCancel()}>Cancel</button>
        <button class="btn btn--danger" onClick={() => props.onConfirm()}>Eject</button>
      </div>
    </div>
  );
};

export default EjectConfirm;
