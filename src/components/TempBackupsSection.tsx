/**
 * TempBackupsSection (console#230 option A) — per Engine, under its app list:
 * the Engine's own disk space (free space when the system disk publishes it,
 * plus "Backups left from updates") and one row per temporary pre-update
 * backup from the stored Engine.tempBackups: app, when it was made, size and
 * whether it finished, with "Remove backup" (confirm first) for finished ones.
 * Renders nothing on an older Engine (no field) or when no backup is left.
 */
import { For, Show, createMemo, createSignal, type Accessor, type Component } from 'solid-js';
import { DELETE_TEMP_BACKUP_COMMAND, deleteTempBackup } from '../store/commands';
import { createCommandResult } from '../store/commandResult';
import type { CommandLogState } from '../store/commandLog';
import { remoteWatchFor } from '../store/remoteConfirm';
import { sameIds } from '../store/sameIds';
import { isUpdateRunning, latestUpdateOp } from '../store/updateApp';
import {
  canRemoveTempBackup, deleteTempBackupRefusalText, removeTempBackupConfirmText, systemDiskOf, tempBackupAppTitle, tempBackupKey,
  tempBackupBytesText, tempBackupSize, tempBackupWhen, tempBackupsOf, tempBackupsTotalBytes,
} from '../store/tempBackups';
import CommandFeedback from './CommandFeedback';
import TechnicalDetails from './TechnicalDetails';
import type { Store, TempBackupEntry } from '../types/store';

interface Props {
  engineId: string;
  store: Accessor<Store | null>;
  commandLogStore?: Accessor<CommandLogState>;
}

export const TEMP_BACKUPS_LABEL = 'Backups left from updates';
export const INCOMPLETE_TEXT = 'Not finished: it is still being made, or it stopped part-way.';
export const updateRunningHint = (app: string): string => `Wait until the update of ${app} has finished.`;

const TempBackupRow: Component<{
  backupKey: string;
  engineId: string;
  entry: Accessor<TempBackupEntry | undefined>;
  store: Accessor<Store | null>;
  commandLog: Accessor<CommandLogState>;
}> = (props) => {
  const [confirming, setConfirming] = createSignal(false);
  const result = createCommandResult({ commandLog: props.commandLog, command: DELETE_TEMP_BACKUP_COMMAND, argKey: 'stamp', longRunning: true });
  const busy = () => { const k = result.state().kind; return k === 'pending' || k === 'sent'; };
  const title = createMemo(() => { const e = props.entry(); return e ? tempBackupAppTitle(props.store(), e.instanceId) : ''; });
  const when = () => { const e = props.entry(); return e ? tempBackupWhen(e) : ''; };
  const size = () => { const e = props.entry(); return e ? tempBackupBytesText(tempBackupSize(e)) : ''; };
  const complete = () => { const e = props.entry(); return !!e && canRemoveTempBackup(e); };
  // The Engine is still using the backup while that instance's update runs.
  const updating = createMemo(() => { const e = props.entry(); return !!e && isUpdateRunning(latestUpdateOp(props.store(), e.instanceId)); });

  const send = () => {
    const e = props.entry();
    if (!e || !canRemoveTempBackup(e) || updating()) return;
    setConfirming(false);
    const { instanceId, stamp } = e;
    const key = tempBackupKey(e);
    const gone = () => !(tempBackupsOf(props.store()?.engineDB?.[props.engineId]) ?? []).some((b) => tempBackupKey(b) === key);
    result.start(stamp, () => deleteTempBackup(props.engineId, instanceId, stamp), {
      command: DELETE_TEMP_BACKUP_COMMAND,
      argKey: 'stamp',
      longRunning: true,
      engineId: props.engineId,
      remote: remoteWatchFor(props.store, props.engineId, DELETE_TEMP_BACKUP_COMMAND, () => (gone() ? 'ok' : null)),
      confirm: () => (gone() ? 'ok' : null),
    });
  };

  return (
    <li class="temp-backups__row" data-testid={`temp-backup-${props.backupKey}`}>
      <div class="temp-backups__main">
        <span class="temp-backups__app" data-testid={`temp-backup-app-${props.backupKey}`}>{title()}</span>
        <span class="temp-backups__meta" data-testid={`temp-backup-meta-${props.backupKey}`}>
          {`Made ${when()} · ${size()}`}
        </span>
      </div>
      <TechnicalDetails
        class="temp-backups__state"
        testId={`temp-backup-state-${props.backupKey}`}
        plain={complete() ? 'Complete' : INCOMPLETE_TEXT}
        raw={props.entry()?.path ?? ''}
      />
      <Show when={complete()}>
        <Show
          when={confirming()}
          fallback={
            <button
              class="btn btn--remove"
              data-testid={`temp-backup-remove-${props.backupKey}`}
              disabled={busy() || updating()}
              title={updating() ? updateRunningHint(title()) : 'Remove this backup from this Pi'}
              onClick={() => { result.reset(); setConfirming(true); }}
            >
              Remove backup
            </button>
          }
        >
          <div class="temp-backups__confirm" role="alertdialog" aria-label={`Remove the backup of ${title()}`}>
            <p data-testid={`temp-backup-confirm-text-${props.backupKey}`}>{removeTempBackupConfirmText(title(), when(), size())}</p>
            <div class="temp-backups__buttons">
              <button class="btn btn--remove" data-testid={`temp-backup-confirm-${props.backupKey}`} disabled={updating()} onClick={send}>Remove</button>
              <button class="btn" data-testid={`temp-backup-cancel-${props.backupKey}`} onClick={() => setConfirming(false)}>Cancel</button>
            </div>
          </div>
        </Show>
      </Show>
      <Show when={complete() && updating() && !confirming()}>
        <p class="edp-form__hint" data-testid={`temp-backup-hint-${props.backupKey}`}>{updateRunningHint(title())}</p>
      </Show>
      <Show when={busy()}>
        <p class="edp-form__hint" role="status">Removing…</p>
      </Show>
      <CommandFeedback
        result={result}
        subject={title}
        testId={`temp-backup-${props.backupKey}`}
        formatLine={(message, code) => deleteTempBackupRefusalText(message, title(), code)}
        details
      />
    </li>
  );
};

const TempBackupsSection: Component<Props> = (props) => {
  const engine = () => props.store()?.engineDB?.[props.engineId];
  const list = createMemo(() => tempBackupsOf(engine()) ?? []);
  const keys = createMemo(() => list().map(tempBackupKey), [], { equals: sameIds });
  const total = createMemo(() => tempBackupsTotalBytes(engine()) ?? 0);
  const freeText = createMemo(() => {
    const d = systemDiskOf(props.store(), props.engineId);
    return d?.sizeBytes != null && d.freeBytes != null ? `${tempBackupBytesText(d.freeBytes)} free of ${tempBackupBytesText(d.sizeBytes)}` : null;
  });
  const cls: Accessor<CommandLogState> = () => props.commandLogStore?.() ?? null;

  return (
    <Show when={keys().length > 0}>
      <section class="disk-section temp-backups" aria-label="This Pi's own disk" data-testid={`temp-backups-${props.engineId}`}>
        <h3 class="disk-section__title">This Pi's own disk</h3>
        <dl class="temp-backups__space">
          <Show when={freeText()}>
            <dt>Free space</dt>
            <dd data-testid={`temp-backups-free-${props.engineId}`}>{freeText()}</dd>
          </Show>
          <dt>{TEMP_BACKUPS_LABEL}</dt>
          <dd data-testid={`temp-backups-total-${props.engineId}`}>{tempBackupBytesText(total())}</dd>
        </dl>
        <ul class="temp-backups__list">
          <For each={keys()}>
            {(key) => (
              <TempBackupRow
                backupKey={key}
                engineId={props.engineId}
                entry={() => list().find((b) => tempBackupKey(b) === key)}
                store={props.store}
                commandLog={cls}
              />
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
};

export default TempBackupsSection;
