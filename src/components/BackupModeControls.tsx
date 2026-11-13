/**
 * Backup Disk mode and daily-time controls (idea#400, Engine f114a28).
 *
 * Shown only when the docked Engine advertises a fresh scheduledBackups
 * capability. Reads the current mode and time from backupConfig; sends
 * setBackupMode <backupDiskId> <mode> [HH:MM] to Disk.dockedTo, always by id.
 */
import { For, Show, createEffect, createMemo, createSignal, type Accessor, type Component } from 'solid-js';
import { engineHasCapability, setBackupMode } from '../store/commands';
import { createCommandResult, findCommandTrace } from '../store/commandResult';
import { parseTraceResult } from '../store/historyRow';
import { traceIdSnapshot } from '../store/ejectResult';
import { remoteWatchFor } from '../store/remoteConfirm';
import {
  BACKUP_MODE_OPTIONS,
  DEFAULT_BACKUP_TIME,
  SCHEDULED_BACKUPS_CAPABILITY,
  SCHEDULE_ERROR_COPY,
  SET_BACKUP_MODE_COMMAND,
  SET_BACKUP_MODE_TIMEOUT_MESSAGE,
  normalizeDailyTime,
  plainSetBackupModeSuccess,
  setBackupModeErrorText,
  validateBackupTime,
} from '../store/setBackupMode';
import type { CommandLogState } from '../store/commandLog';
import type { BackupMode, Disk, Store } from '../types/store';

interface BackupModeControlsProps {
  disk: () => Disk | undefined;
  store: () => Store | null;
  /** Fallback Engine id; the command always goes to Disk.dockedTo when set. */
  engineId: () => string | undefined;
  commandLogStore?: Accessor<CommandLogState>;
}

const BackupModeControls: Component<BackupModeControlsProps> = (props) => {
  const engineId = () => props.disk()?.dockedTo ?? props.engineId() ?? undefined;
  const engine = createMemo(() => {
    const s = props.store();
    const id = engineId();
    return id && s ? s.engineDB[id] : undefined;
  });
  const show = () => engineHasCapability(engine(), SCHEDULED_BACKUPS_CAPABILITY)
    && !!props.disk()?.backupConfig;

  const storedMode = () => props.disk()?.backupConfig?.mode ?? null;
  const storedDaily = () => {
    const daily = props.disk()?.backupConfig?.schedule?.daily;
    return daily ? normalizeDailyTime(daily) : null;
  };
  const scheduleError = () => props.disk()?.backupConfig?.scheduleError ?? null;

  // Drafts are null until the operator edits, so the fields stay reactive
  // to backupConfig after a successful save (or a store update).
  const [draftMode, setDraftMode] = createSignal<BackupMode | null>(null);
  const [draftTime, setDraftTime] = createSignal<string | null>(null);
  const [baseline, setBaseline] = createSignal<Set<string> | null>(null);
  // Captured at send: Disk.lastAttempt is the last scheduled run (#186). A
  // first scheduled run may write it after we show the success line.
  const [sentLastAttempt, setSentLastAttempt] = createSignal<number | null | undefined>(undefined);

  const mode = (): BackupMode => draftMode() ?? storedMode() ?? 'on-demand';
  const time = (): string => draftTime() ?? storedDaily() ?? DEFAULT_BACKUP_TIME;
  const timeError = () => (mode() === 'scheduled' ? validateBackupTime(time()) : null);

  const dirty = () => {
    if (mode() !== storedMode()) return true;
    if (mode() !== 'scheduled') return false;
    const normalized = normalizeDailyTime(time());
    return !!normalized && normalized !== (storedDaily() ?? DEFAULT_BACKUP_TIME);
  };

  const result = createCommandResult({
    commandLog: () => props.commandLogStore?.() ?? null,
    command: SET_BACKUP_MODE_COMMAND,
    argKey: 'backupDiskId',
  });

  const pending = () => result.state().kind === 'pending' || result.state().kind === 'sent';
  const docked = () => !!props.disk()?.dockedTo;
  const canSave = () => show() && docked() && dirty() && !timeError() && !pending();

  const successText = (): string | null => {
    if (result.state().kind !== 'success') return null;
    const diskId = props.disk()?.id;
    const ids = baseline();
    const log = props.commandLogStore?.() ?? null;
    const lastAttempt = sentLastAttempt();
    if (diskId && ids && log) {
      const trace = findCommandTrace(log, ids, SET_BACKUP_MODE_COMMAND, 'backupDiskId', diskId);
      const parsed = trace ? parseTraceResult(trace) : null;
      if (parsed) return plainSetBackupModeSuccess(parsed, { lastAttempt });
    }
    return plainSetBackupModeSuccess({
      mode: mode(),
      schedule: mode() === 'scheduled' ? { daily: normalizeDailyTime(time()) ?? DEFAULT_BACKUP_TIME } : null,
      changed: true,
    }, { lastAttempt });
  };

  const submit = () => {
    const disk = props.disk();
    const target = engineId();
    if (!disk || !target || !canSave()) return;
    const nextMode = mode();
    const nextTime = nextMode === 'scheduled' ? normalizeDailyTime(time()) : undefined;
    if (nextMode === 'scheduled' && !nextTime) return;
    setSentLastAttempt(disk.lastAttempt ?? null);
    setBaseline(traceIdSnapshot(props.commandLogStore?.() ?? null));
    const timeArg = nextTime ?? undefined;
    result.start(disk.id, () => setBackupMode(target, disk.id, nextMode, timeArg), {
      engineId: target,
      remote: remoteWatchFor(props.store, target, SET_BACKUP_MODE_COMMAND, () => {
        const cfg = props.disk()?.backupConfig;
        if (!cfg || cfg.mode !== nextMode) return null;
        if (nextMode === 'scheduled' && normalizeDailyTime(cfg.schedule?.daily ?? '') !== nextTime) {
          return null;
        }
        return 'ok';
      }),
    });
    // After a successful save, drop drafts so the fields follow backupConfig.
  };

  createEffect(() => {
    if (result.state().kind === 'success') {
      setDraftMode(null);
      setDraftTime(null);
    }
  });

  return (
    <Show when={show()}>
      <div class="backup-mode-controls" data-testid="backup-mode-controls">
        <p class="backup-mode-controls__intro">Choose how this disk backs up its Apps.</p>
        <fieldset class="backup-mode-controls__fieldset" disabled={pending()}>
          <legend class="backup-mode-controls__legend">Backup mode</legend>
          <div class="edp-radios">
            <For each={BACKUP_MODE_OPTIONS}>
              {(opt) => (
                <label
                  class={`edp-radio ${mode() === opt.value ? 'edp-radio--on' : ''}`}
                  data-testid={`backup-mode-${opt.value}`}
                >
                  <input
                    type="radio"
                    name={`backup-mode-${props.disk()?.id ?? 'disk'}`}
                    value={opt.value}
                    checked={mode() === opt.value}
                    onChange={() => {
                      setDraftMode(opt.value);
                      result.reset();
                    }}
                  />
                  <span class="edp-radio__title">{opt.label}</span>
                  <span class="edp-radio__desc">{opt.description}</span>
                </label>
              )}
            </For>
          </div>

          <Show when={mode() === 'scheduled'}>
            <label class="edp-form__label" for={`backup-mode-time-${props.disk()?.id ?? 'disk'}`}>
              Daily time (24-hour, this Pi's local time)
            </label>
            <input
              id={`backup-mode-time-${props.disk()?.id ?? 'disk'}`}
              data-testid="backup-mode-time"
              class="edp-form__search backup-mode-controls__time"
              type="text"
              inputMode="numeric"
              autocomplete="off"
              spellcheck={false}
              maxlength={5}
              placeholder={DEFAULT_BACKUP_TIME}
              value={time()}
              aria-invalid={timeError() ? 'true' : 'false'}
              onInput={(e) => {
                setDraftTime((e.currentTarget as HTMLInputElement).value);
                result.reset();
              }}
            />
            <Show when={timeError()}>
              <p class="edp-form__error" data-testid="backup-mode-time-error" role="alert">{timeError()}</p>
            </Show>
            <Show when={scheduleError() && !timeError()}>
              <p class="edp-form__error" data-testid="backup-mode-schedule-error" role="status">{SCHEDULE_ERROR_COPY}</p>
            </Show>
          </Show>
        </fieldset>

        <div class="edp-form__actions">
          <button
            class="btn btn--primary"
            data-testid="backup-mode-save"
            disabled={!canSave()}
            title={!docked() ? "This Backup Disk isn't plugged into a Pi." : undefined}
            onClick={submit}
          >
            Save backup settings
          </button>
        </div>

        <Show when={result.state().kind === 'pending'}>
          <p class="edp-form__hint" data-testid="backup-mode-pending" role="status">Waiting for the Engine…</p>
        </Show>
        <Show when={(() => { const s = result.state(); return s.kind === 'sent' ? s.engine : null; })()}>
          {(eng) => (
            <p class="edp-form__hint" data-testid="backup-mode-sent" role="status">
              Sent to {eng()}, waiting for confirmation…
            </p>
          )}
        </Show>
        <Show when={(() => { const s = result.state(); return s.kind === 'error' ? setBackupModeErrorText(s.message) : null; })()}>
          {(msg) => (
            <p class="edp-form__error" data-testid="backup-mode-error" role="alert">{msg()}</p>
          )}
        </Show>
        <Show when={result.state().kind === 'timeout'}>
          <p class="edp-form__error" data-testid="backup-mode-timeout" role="status">{SET_BACKUP_MODE_TIMEOUT_MESSAGE}</p>
        </Show>
        <Show when={result.state().kind === 'success'}>
          <p class="edp-form__hint" data-testid="backup-mode-success" role="status">{successText()}</p>
        </Show>
      </div>
    </Show>
  );
};

export default BackupModeControls;
