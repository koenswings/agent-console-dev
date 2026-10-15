/**
 * ClientCardsSection (idea#201 §10.2) — per Engine: card readers and the card
 * in each (reader, size, what is on it now) with Flash, plus new (unknown)
 * disks with Initialise (rule 1: the Engine no longer claims them itself).
 * Gated on Engine.capabilities; a missing capability shows a hint, never a fake.
 */
import { For, Show, createMemo, createSignal, type Accessor, type Component } from 'solid-js';
import CommandFeedback from './CommandFeedback';
import FlashDialog from './FlashDialog';
import EraseDialog from './EraseDialog';
import { engineHasCapability } from '../store/commands';
import { createCommandResult, type CommandResult } from '../store/commandResult';
import { mergeCommandLogs, remoteCommandLog } from '../store/remoteCommandLogs';
import { formatBytes } from '../store/diskRoles';
import type { CommandLogState } from '../store/commandLog';
import type { ClientCard, NewDisk, Store } from '../types/store';
import {
  CAP_HINT,
  TRACE,
  cardReadersOf,
  clientCardsOf,
  contentsLabel,
  engineOf,
  errorText,
  flashableImages,
  hasCap,
  initialisableDisks,
  initialiseDisk,
  needsErase,
  readerForCard,
  type InitialiseType,
} from '../store/clientCards';

interface ClientCardsSectionProps {
  engineId: string;
  store: () => Store | null;
  commandLogStore?: Accessor<CommandLogState>;
}

const plain = (r: CommandResult): CommandResult => ({
  ...r,
  state: () => {
    const s = r.state();
    return s.kind === 'error' ? { kind: 'error', message: errorText(s.message) } : s;
  },
});

const ClientCardsSection: Component<ClientCardsSectionProps> = (props) => {
  const engine = () => engineOf(props.store(), props.engineId);
  const [flashing, setFlashing] = createSignal<string | null>(null);
  const cls = () => mergeCommandLogs(props.commandLogStore?.() ?? null, remoteCommandLog(props.engineId)?.() ?? null);

  const cards = createMemo(() => clientCardsOf(engine()));
  const readers = createMemo(() => cardReadersOf(engine()));
  /** Cards not in a known reader (e.g. an external USB SSD). */
  const looseCards = createMemo(() => cards().filter((c) => !readerForCard(engine(), c)));
  const cardIn = (candidateId: string | null) => (candidateId ? cards().find((c) => c.candidateId === candidateId) : undefined);

  const flashHint = (c: ClientCard): string | null => {
    if (!hasCap(engine(), 'flashCard')) return CAP_HINT.flashCard;
    if (!hasCap(engine(), 'clientImages')) return CAP_HINT.clientImages;
    if (!c.flashable) return c.refusal ? errorText(`${c.refusal}: `) : 'The Engine says this card cannot be flashed.';
    if (flashableImages(engine()).length === 0) return 'There is no verified client image on this Pi yet.';
    const busy = engine()?.flashInProgress;
    if (busy && busy.candidateId !== c.candidateId) return errorText('BUSY: ');
    return null;
  };

  const CardLine = (p: { card: ClientCard; readerName: string | null }) => (
    <div class="client-card" data-testid={`client-card-${p.card.candidateId}`}>
      <span data-testid="client-card-reader">{p.readerName ?? p.card.model ?? 'USB disk'}</span>
      {' — '}
      <span data-testid="client-card-size">{formatBytes(p.card.sizeBytes)}</span>
      {' — '}
      <span data-testid="client-card-contents">{contentsLabel(p.card.contents)}</span>
      <Show when={engine()?.flashInProgress?.candidateId === p.card.candidateId}>
        <span class="edp-form__hint" data-testid="client-card-flashing"> (flashing…)</span>
      </Show>
      <button
        class="btn"
        data-testid={`client-card-flash-${p.card.candidateId}`}
        disabled={!!flashHint(p.card) || flashing() !== null}
        title={flashHint(p.card) ?? undefined}
        onClick={() => setFlashing(p.card.candidateId)}
      >
        Flash…
      </button>
      <Show when={flashHint(p.card)}>
        {(h) => <p class="edp-form__hint" data-testid={`client-card-hint-${p.card.candidateId}`}>{h()}</p>}
      </Show>
    </div>
  );

  const NewDiskLine = (p: { disk: NewDisk }) => {
    const [type, setType] = createSignal<InitialiseType>('empty');
    const raw = createCommandResult({ commandLog: cls, command: TRACE.initialise, argKey: 'candidateId', matchMode: 'key', longRunning: true });
    const result = plain(raw);
    const [erasing, setErasing] = createSignal(false);
    // Contract v2: non-ext4 → Erase first (same candidateId), then Initialise.
    const mustErase = () => needsErase(engine(), p.disk.candidateId);
    const canErase = () => engineHasCapability(engine(), 'eraseDisk');
    const blocked = () => (!hasCap(engine(), 'unknownDiskReadOnly') ? CAP_HINT.unknownDiskReadOnly
      : mustErase() ? errorText('NOT_EXT4: ') : null);
    const busy = () => raw.state().kind === 'pending';
    const label = () => `${p.disk.model ?? 'disk'} (${formatBytes(p.disk.sizeBytes)})`;
    return (
      <div class="new-disk" data-testid={`new-disk-${p.disk.candidateId}`}>
        <span data-testid="new-disk-label">{label()}</span>
        {' — '}
        <span data-testid="new-disk-contents">{contentsLabel(p.disk.contents)}</span>
        <select
          data-testid={`new-disk-type-${p.disk.candidateId}`}
          value={type()}
          onChange={(e) => setType((e.target as HTMLSelectElement).value as InitialiseType)}
        >
          <option value="empty">Empty IDEA disk</option>
          <option value="files">Files Disk</option>
          <option value="backup">Backup Disk</option>
        </select>
        <button
          class="btn"
          data-testid={`new-disk-initialise-${p.disk.candidateId}`}
          disabled={!!blocked() || busy()}
          title={blocked() ?? undefined}
          onClick={() => raw.start(p.disk.candidateId, () => initialiseDisk(props.engineId, p.disk.candidateId, type()))}
        >
          {busy() ? 'Initialising…' : 'Initialise'}
        </button>
        <Show when={mustErase()}>
          <button
            class="btn"
            data-testid={`new-disk-erase-${p.disk.candidateId}`}
            disabled={!canErase()}
            onClick={() => setErasing(true)}
          >
            Erase first…
          </button>
        </Show>
        <Show when={blocked()}>
          {(h) => <p class="edp-form__hint" data-testid={`new-disk-hint-${p.disk.candidateId}`}>{h()}</p>}
        </Show>
        <Show when={erasing()}>
          <EraseDialog
            targetId={p.disk.candidateId}
            engineId={props.engineId}
            fallbackLabel={label()}
            mode="erase"
            store={props.store}
            commandLogStore={props.commandLogStore}
            onClose={() => setErasing(false)}
            onErasedEmpty={() => setErasing(false)}
          />
        </Show>
        <Show when={raw.state().kind === 'success'}>
          <p class="edp-form__hint" role="status" data-testid={`new-disk-done-${p.disk.candidateId}`}>Initialised. It now appears as an IDEA disk.</p>
        </Show>
        <CommandFeedback result={result} subject={label} testId={`new-disk-feedback-${p.disk.candidateId}`} />
      </div>
    );
  };

  return (
    <section class="disk-section client-cards" aria-label="Client cards" data-testid="client-cards-section">
      <h3 class="disk-section__title">Client cards</h3>
      <Show
        when={hasCap(engine(), 'clientCards')}
        fallback={<p class="edp-form__hint" data-testid="client-cards-unsupported">{CAP_HINT.clientCards}</p>}
      >
        <Show when={hasCap(engine(), 'clientImages')}>
          <p class="edp-form__hint" data-testid="client-images-line">
            Client image: {engine()?.clientImages?.current ?? 'none yet'}
            {engine()?.clientImages?.previous ? ` (previous ${engine()!.clientImages!.previous})` : ''}
          </p>
        </Show>
        <Show when={readers().length + looseCards().length > 0} fallback={<p class="edp-form__hint" data-testid="client-cards-none">No card reader or client card on this Pi.</p>}>
          <For each={readers()}>
            {(r) => (
              <div class="card-reader" data-testid={`card-reader-${r.id}`}>
                <Show
                  when={r.hasMedium && cardIn(r.candidateId)}
                  fallback={
                    <p data-testid="card-reader-empty">
                      {r.name} (port {r.usbPath}): {r.hasMedium ? 'card present, not flashable' : 'no card'}
                    </p>
                  }
                >
                  {(c) => <CardLine card={c()} readerName={`${r.name} (port ${r.usbPath})`} />}
                </Show>
              </div>
            )}
          </For>
          <For each={looseCards()}>{(c) => <CardLine card={c} readerName={null} />}</For>
        </Show>

        <Show when={flashing()}>
          {(cid) => (
            <FlashDialog
              engineId={props.engineId}
              candidateId={cid()}
              store={props.store}
              commandLogStore={props.commandLogStore}
              onClose={() => setFlashing(null)}
            />
          )}
        </Show>

        <h4 class="disk-section__title">New disks</h4>
        <Show
          when={initialisableDisks(engine()).length > 0}
          fallback={<p class="edp-form__hint" data-testid="new-disks-none">No new disks.</p>}
        >
          <p class="edp-form__hint">These disks are not IDEA disks yet. Nothing is written to them until you choose Initialise.</p>
          <For each={initialisableDisks(engine())}>{(d) => <NewDiskLine disk={d} />}</For>
        </Show>
      </Show>
    </section>
  );
};

export default ClientCardsSection;
