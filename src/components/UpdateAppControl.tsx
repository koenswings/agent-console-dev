/**
 * updateApp UI (console#168): badge, confirm, step progress and result.
 * All Engine shapes come from store/updateApp.ts. Renders nothing unless the
 * Engine has the `updateApp` capability and the instance offers an update,
 * or an update op is running / just finished.
 */
import { For, Show, createEffect, createMemo, createSignal, type Accessor, type Component } from 'solid-js';
import { sendRawCommand } from '../store/commands';
import { createCommandResult } from '../store/commandResult';
import type { CommandLogState } from '../store/commandLog';
import { isOnline, live, liveNow } from '../store/live';
import {
  COMMAND, NEEDS_BACKUP_TEXT, badgeText, buildUpdateAppCommand, canUpdate, confirmText, currentStep,
  dismissUpdate, engineLabel, fetchPausedOf, friendlyUpdateError, isDismissed, isUpdateRunning,
  latestUpdateOp, parseRefusal, pausedText, previousVersionOf, stepLabel, updateOfferFor, updateOutcome,
  updateProgress, type RefusalCtx,
} from '../store/updateApp';
import type { Engine, Instance, Store } from '../types/store';

interface Props {
  instance: Accessor<Instance | undefined>;
  engine: Accessor<Engine | undefined>;
  store: Accessor<Store | null>;
  commandLog: Accessor<CommandLogState>;
  /** App title for the sentences. */
  appTitle: Accessor<string>;
}

const UpdateAppControl: Component<Props> = (props) => {
  const id = () => props.instance()?.id ?? '';
  const offer = createMemo(() => updateOfferFor(props.store(), props.instance(), props.engine()));
  const op = createMemo(() => (canUpdate(props.engine()) ? latestUpdateOp(props.store(), id()) : null));
  const running = createMemo(() => isUpdateRunning(op()));
  const prog = createMemo(() => updateProgress()[id()] ?? null);
  const [confirming, setConfirming] = createSignal(false);
  const [watching, setWatching] = createSignal(false);
  const [fromVersion, setFromVersion] = createSignal<string | null>(null);
  const [backupNeededAt, setBackupNeededAt] = createSignal<number | null | undefined>(undefined);

  const sourceName = () => (offer()?.sourceEngineId ? engineLabel(props.store(), offer()!.sourceEngineId) : null);
  const sourceOffline = createMemo(() => {
    const sid = offer()?.sourceEngineId;
    if (!sid) return false;
    const e = props.store()?.engineDB?.[sid];
    return !e || !isOnline(e, live(), liveNow());
  });
  const diskName = () => {
    const d = props.instance()?.storedOn;
    return d ? String(props.store()?.diskDB?.[String(d)]?.name ?? d) : null;
  };
  const ctx = (): RefusalCtx => ({
    app: props.appTitle(),
    fromVersion: fromVersion() ?? offer()?.fromVersion ?? '',
    engine: sourceName() ?? engineLabel(props.store(), props.engine()?.id ?? null),
    diskName: diskName(),
  });

  const result = createCommandResult({ commandLog: props.commandLog, command: COMMAND, argKey: 'instanceId', matchMode: 'includes', longRunning: true });
  createEffect(() => {
    const s = result.state();
    if (s.kind === 'error' && parseRefusal(s.message).code === 'NEEDS_BACKUP') {
      setBackupNeededAt(props.instance()?.lastBackup ?? null);
    }
  });
  createEffect(() => { if (running()) setWatching(true); });

  const needsBackup = () => backupNeededAt() !== undefined && backupNeededAt() === (props.instance()?.lastBackup ?? null);
  const showBadge = () => {
    const o = offer();
    return !!o && !running() && !isDismissed(id(), o.toAppId);
  };

  const send = () => {
    const engine = props.engine();
    const inst = props.instance();
    const o = offer();
    if (!engine || !inst || !o) return;
    setConfirming(false);
    setFromVersion(o.fromVersion);
    setWatching(true);
    const instId = inst.id;
    result.start(instId, () => sendRawCommand(engine.id, buildUpdateAppCommand(instId, o)), {
      command: COMMAND, argKey: 'instanceId', matchMode: 'includes', longRunning: true, engineId: engine.id,
    });
  };

  const paused = () => fetchPausedOf(props.instance(), op());
  const step = () => stepLabel(currentStep(op(), prog()), prog(), sourceName() ?? 'the other Engine');
  const outcome = createMemo(() => {
    if (!watching()) return null;
    const from = fromVersion() ?? previousVersionOf(props.store(), props.instance()) ?? '';
    return updateOutcome(op(), props.instance(), props.appTitle(), from, { ...ctx(), fromVersion: from });
  });
  const errorText = () => {
    const s = result.state();
    return s.kind === 'error' ? friendlyUpdateError(s.message, ctx()) : null;
  };

  return (
    <Show when={canUpdate(props.engine())}>
      <div class="update-app" data-testid={`update-app-${id()}`}>
        <Show when={showBadge() && !confirming()}>
          <div class="update-app__badge-row">
            <button
              class="update-app__badge"
              classList={{ 'update-app__badge--offline': sourceOffline() }}
              data-testid={`update-badge-${id()}`}
              disabled={sourceOffline() || needsBackup()}
              title={sourceOffline() ? `${sourceName()} is switched off` : needsBackup() ? NEEDS_BACKUP_TEXT : 'Update'}
              onClick={() => { result.reset(); setConfirming(true); }}
            >
              {badgeText(offer()!, sourceName())}
            </button>
            <Show when={needsBackup()}>
              <span class="edp-form__hint" data-testid={`update-needs-backup-${id()}`}>{NEEDS_BACKUP_TEXT}</span>
            </Show>
          </div>
        </Show>

        <Show when={confirming() && offer()}>
          {(o) => (
            <div class="update-app__confirm" role="alertdialog" aria-label={`Update ${props.appTitle()}`} data-testid={`update-confirm-${id()}`}>
              <For each={confirmText(props.appTitle(), o(), sourceName())}>{(line) => <p class="update-app__line">{line}</p>}</For>
              <Show when={o().major && o().migrationNote}>
                <p class="update-app__note" data-testid={`update-migration-note-${id()}`}>{o().migrationNote}</p>
              </Show>
              <div class="update-app__buttons">
                <button class="btn btn--update" data-testid={`update-confirm-btn-${id()}`} disabled={needsBackup() || sourceOffline()} onClick={send}>Update</button>
                <button
                  class="btn"
                  data-testid={`update-not-now-${id()}`}
                  onClick={() => { const toAppId = o().toAppId; dismissUpdate(id(), toAppId); setConfirming(false); }}
                >
                  Not now
                </button>
              </div>
            </div>
          )}
        </Show>

        <Show when={running()}>
          <p class="update-app__step" role="status" data-testid={`update-step-${id()}`}>
            {paused() ? pausedText(paused()!, sourceName() ?? 'the other Engine') : step() ?? 'Updating…'}
          </p>
        </Show>
        <Show when={outcome()}>
          {(out) => (
            <p
              class={out().kind === 'updated' ? 'update-app__ok' : 'edp-form__error'}
              role={out().kind === 'updated' ? 'status' : 'alert'}
              data-testid={`update-outcome-${id()}`}
              data-kind={out().kind}
            >
              {out().text}
            </p>
          )}
        </Show>
        <Show when={errorText()}>
          <p class="edp-form__error" role="alert" data-testid={`update-error-${id()}`}>{errorText()}</p>
        </Show>
      </div>
    </Show>
  );
};

export default UpdateAppControl;
