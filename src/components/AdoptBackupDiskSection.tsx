/**
 * "Make this also a Backup Disk" on an App or Files disk (agent-console-dev#209).
 * A plain confirm (nothing is erased, no typed name) sends
 * `makeBackupDisk <diskId>` to the Engine the disk is docked to. Progress shows
 * Check → Create from the Operation; success needs the trace ok and the Backup
 * role on the disk. Helpers: store/adoptBackupDisk.ts and store/makeBackupDisk.ts.
 */
import { Show, createMemo, createSignal, type Accessor, type Component } from 'solid-js';
import MakeBackupDiskProgress from './MakeBackupDiskProgress';
import { createCommandResult } from '../store/commandResult';
import { remoteWatchFor } from '../store/remoteConfirm';
import { makeBackupDisk } from '../store/commands';
import {
  MAKE_BACKUP_DISK_COMMAND,
  MAKE_BACKUP_TIMEOUT_MESSAGE,
  findMakeBackupDiskOp,
} from '../store/makeBackupDisk';
import {
  ADOPT_BACKUP_DISK_ACTION,
  ADOPT_BACKUP_DISK_KEEP,
  ADOPT_BACKUP_DISK_SAME_DISK_WARNING,
  ADOPT_BACKUP_DISK_SCHEDULE,
  ADOPT_BACKUP_DISK_SUCCESS_HINT,
  ADOPT_BACKUP_DISK_SUCCESS_MESSAGE,
  adoptBackupDiskBlockedReason,
  adoptBackupDiskErrorText,
  adoptBackupDiskRemoteCheck,
  adoptBackupDiskSizeGate,
  adoptBackupDiskTitle,
  canOfferAdoptBackupDisk,
  diskHoldsInstances,
  makeBackupDiskOpIds,
} from '../store/adoptBackupDisk';
import type { CommandLogState } from '../store/commandLog';
import type { Disk, Store } from '../types/store';

interface AdoptBackupDiskSectionProps {
  disk: Accessor<Disk | undefined>;
  store: Accessor<Store | null>;
  /** The Engine the disk is docked to (Disk.dockedTo). */
  engineId: Accessor<string | undefined>;
  commandLogStore?: Accessor<CommandLogState>;
}

const AdoptBackupDiskSection: Component<AdoptBackupDiskSectionProps> = (props) => {
  const engine = () => {
    const id = props.engineId();
    return id ? props.store()?.engineDB[id] : undefined;
  };
  const diskId = () => props.disk()?.id;
  const hasBackupRole = () => (props.disk()?.diskTypes ?? []).includes('backup');

  const offer = createMemo(() => canOfferAdoptBackupDisk(props.disk(), engine(), props.store()));
  const blocked = createMemo((): string | undefined => {
    const id = diskId();
    return id ? adoptBackupDiskBlockedReason(engine(), props.store(), id) : undefined;
  });
  const sizeWarning = createMemo((): string | undefined => {
    const id = diskId();
    return id ? adoptBackupDiskSizeGate(engine(), props.store(), id)?.warning : undefined;
  });
  const holdsInstances = createMemo(() => {
    const id = diskId();
    return !!id && diskHoldsInstances(props.store(), id);
  });

  const [open, setOpen] = createSignal(false);
  const result = createCommandResult({
    commandLog: () => props.commandLogStore?.() ?? null,
    command: MAKE_BACKUP_DISK_COMMAND,
    argKey: 'targetId',
    longRunning: true,
    isSuccess: hasBackupRole,
  });
  const kind = () => result.state().kind;
  const pending = () => kind() === 'pending' || kind() === 'sent';
  const succeeded = () => kind() === 'success';

  const op = createMemo(() => {
    if (!pending()) return null;
    return findMakeBackupDiskOp(props.store(), props.engineId(), diskId());
  });

  const errorText = (): string | null => {
    const s = result.state();
    return s.kind === 'error' ? adoptBackupDiskErrorText(s.message, s.code) : null;
  };
  const sentTo = (): string | null => {
    const s = result.state();
    return s.kind === 'sent' ? s.engine : null;
  };

  const confirm = () => {
    const engineId = props.engineId();
    const id = diskId();
    if (!engineId || !id || blocked() || pending()) return;
    const baseline = makeBackupDiskOpIds(props.store(), id);
    // An adopted IDEA disk: the Engine skips Erase, so the id alone (engine#355).
    result.start(id, () => makeBackupDisk(engineId, id), {
      command: MAKE_BACKUP_DISK_COMMAND,
      argKey: 'targetId',
      matchMode: 'key',
      longRunning: true,
      engineId,
      remote: remoteWatchFor(props.store, engineId, MAKE_BACKUP_DISK_COMMAND,
        () => adoptBackupDiskRemoteCheck(props.store(), engineId, id, baseline)),
    });
  };

  const close = () => {
    result.reset();
    setOpen(false);
  };

  return (
    <Show when={offer() || open()}>
      <section class="disk-section disk-section--adopt-backup" aria-label="Make this also a Backup Disk">
        <Show
          when={open()}
          fallback={
            <div class="adopt-backup">
              <button
                class="btn"
                data-testid="adopt-backup-disk"
                disabled={!!blocked()}
                title={blocked()}
                onClick={() => setOpen(true)}
              >
                {ADOPT_BACKUP_DISK_ACTION}
              </button>
              <Show when={blocked()}>
                {(why) => <p class="edp-form__hint" data-testid="adopt-backup-disk-blocked">{why()}</p>}
              </Show>
            </div>
          }
        >
          <Show
            when={!succeeded()}
            fallback={
              <div class="edp-form" data-testid="adopt-backup-disk-success">
                <p class="edp-form__hint adopt-backup__success">{ADOPT_BACKUP_DISK_SUCCESS_MESSAGE}</p>
                <p class="edp-form__hint" data-testid="adopt-backup-disk-success-hint">{ADOPT_BACKUP_DISK_SUCCESS_HINT}</p>
                <div class="edp-form__actions">
                  <button class="btn" onClick={close}>Close</button>
                </div>
              </div>
            }
          >
            <div class="edp-form" data-testid="adopt-backup-disk-confirm">
              <h3 class="disk-section__title">{adoptBackupDiskTitle(props.disk()?.name ?? 'this disk')}</h3>
              <p class="edp-form__hint">{ADOPT_BACKUP_DISK_KEEP}</p>
              <p class="edp-form__hint">{ADOPT_BACKUP_DISK_SCHEDULE}</p>
              <Show when={holdsInstances()}>
                <p class="adopt-backup__warning" data-testid="adopt-backup-disk-same-disk">
                  {ADOPT_BACKUP_DISK_SAME_DISK_WARNING}
                </p>
              </Show>
              <Show when={sizeWarning()}>
                {(msg) => <p class="edp-form__hint" data-testid="adopt-backup-disk-size-warn">{msg()}</p>}
              </Show>
              <Show when={errorText()}>
                {(msg) => <p class="edp-form__error" role="alert" data-testid="adopt-backup-disk-error">{msg()}</p>}
              </Show>
              <Show when={kind() === 'timeout'}>
                <p class="edp-form__error" role="status" data-testid="adopt-backup-disk-timeout">{MAKE_BACKUP_TIMEOUT_MESSAGE}</p>
              </Show>
              <Show when={sentTo()}>
                {(eng) => <p class="edp-form__hint" role="status" data-testid="adopt-backup-disk-sent">Sent to {eng()}, waiting for confirmation…</p>}
              </Show>
              <Show when={pending()}>
                <MakeBackupDiskProgress op={op} waiting={true} adopted={true} />
              </Show>
              <div class="edp-form__actions">
                <button
                  class="btn btn--primary"
                  data-testid="confirm-adopt-backup-disk"
                  disabled={pending() || !!blocked()}
                  title={blocked()}
                  onClick={confirm}
                >
                  Make it also a Backup Disk
                </button>
                <button class="btn" disabled={pending()} onClick={close}>Cancel</button>
              </div>
            </div>
          </Show>
        </Show>
      </section>
    </Show>
  );
};

export default AdoptBackupDiskSection;
