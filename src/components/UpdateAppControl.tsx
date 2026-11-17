/**
 * updateApp UI (console#168): badge, confirm, step progress and result.
 * All Engine shapes come from store/updateApp.ts. Renders nothing unless the
 * Engine has the `updateApp` capability and the instance offers an update,
 * or an update op is running / just finished, or the App is still stopped
 * after an update whose restart failed (console#227, from Engine state), or a
 * temporary pre-update backup is still on the Engine's own disk (console#230:
 * Engine.tempBackups, else the op args on an older Engine).
 */
import { For, Show, createEffect, createMemo, createSignal, type Accessor, type Component } from 'solid-js';
import { sendRawCommand } from '../store/commands';
import { createCommandResult, latestInstanceTrace } from '../store/commandResult';
import type { CommandLogState } from '../store/commandLog';
import { isBackupMethodNone } from '../store/backupStatus';
import { engineStatus, live, liveNow, liveSince } from '../store/live';
import {
  COMMAND, NEEDS_BACKUP_TEXT, majorNeedsBackup, badgeText, buildUpdateAppCommand, canUpdate, confirmText, currentStep,
  dismissUpdate, engineLabel, fetchPausedOf, friendlyUpdateError, isDismissed, isUpdateRunning,
  latestUpdateOp, leftoverTempBackupFor, leftoverTempBackupRaw, leftoverTempBackupText, parseRefusal, pausedText, previousVersionOf, restartFailedBadgeTitle, restartFailedFromOp, restartFailedOpFor,
  restartFailedText, stepLabel, updateOfferFor, updateOutcome,
  updateProgress, type RefusalCtx,
} from '../store/updateApp';
import type { Engine, Instance, Store } from '../types/store';
import TechnicalDetails from './TechnicalDetails';

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
  // console#227: "stopped after a failed restart" comes from Engine state (instance
  // Error + newest updateApp op / trace restartFailed), not from this session, so it
  // survives a reload and clears once the App runs again.
  const restartFailedNow = createMemo(() => {
    const inst = props.instance();
    if (!canUpdate(props.engine()) || !inst) return false;
    const cls = props.commandLog();
    const trace = cls && !('error' in cls) ? latestInstanceTrace(cls, COMMAND, String(inst.id), inst.name) : null;
    return restartFailedOpFor(props.store(), inst, trace?.status === 'error' ? trace.result : null) !== null;
  });
  // console#230: from Engine state, so it shows after a reload too: the stored
  // Engine.tempBackups (option A), else on an older Engine the newest updateApp op args.
  const leftover = createMemo(() => {
    const inst = props.instance();
    if (!inst) return null;
    const o = op();
    const cls = props.commandLog();
    const trace = o && cls && !('error' in cls) ? latestInstanceTrace(cls, COMMAND, String(inst.id), inst.name) : null;
    return leftoverTempBackupFor(props.engine(), String(inst.id), o, trace?.status === 'ok' ? trace.result : null);
  });
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
    return !e || engineStatus(e, live(), liveNow(), liveSince()) === 'offline';
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
    toVersion: offer()?.toVersion ?? null,
    hostEngine: props.engine() ? engineLabel(props.store(), props.engine()!.id) : null,
  });

  const result = createCommandResult({ commandLog: props.commandLog, command: COMMAND, argKey: 'instanceId', matchMode: 'includes', longRunning: true });
  createEffect(() => {
    const s = result.state();
    if (s.kind === 'error' && parseRefusal(s.message).code === 'NEEDS_BACKUP') {
      setBackupNeededAt(props.instance()?.lastBackup ?? null);
    }
  });
  createEffect(() => { if (running()) setWatching(true); });

  // idea#403: a backup-method-none instance never gets lastBackup and needs no backup.
  const methodNone = () => isBackupMethodNone(props.instance());
  const refusedForBackup = () => !methodNone() && backupNeededAt() !== undefined && backupNeededAt() === (props.instance()?.lastBackup ?? null);
  // engine#469: a missing backup no longer blocks a major update: the Engine makes it first
  // (linked Backup Disk, else temporarily on its own disk). An older Engine refuses NEEDS_BACKUP
  // before anything stops, and then the badge stays disabled with the hint.
  const backupFirst = () => majorNeedsBackup(offer(), props.instance()?.lastBackup, liveNow(), methodNone());
  const needsBackup = () => refusedForBackup();
  const backupHint = () => NEEDS_BACKUP_TEXT;
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
    if (restartFailedNow()) return { kind: 'failed' as const, text: restartFailedText(props.appTitle()) };
    if (!watching()) return null;
    // A restartFailed op whose App runs again (or was started since) has nothing left to say.
    if (restartFailedFromOp(op())) return null;
    const from = fromVersion() ?? previousVersionOf(props.store(), props.instance()) ?? '';
    return updateOutcome(op(), props.instance(), props.appTitle(), from, { ...ctx(), fromVersion: from });
  });
  const errorText = () => {
    const s = result.state();
    if (s.kind !== 'error') return null;
    const restartFailed = !!s.restartFailed || restartFailedFromOp(op());
    // With the op in the store, the outcome line owns the restart-failed sentence
    // (shown while the App is stopped, cleared once it runs again).
    if (restartFailed && op()) return null;
    return friendlyUpdateError(s.message, ctx(), { restartFailed });
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
              disabled={sourceOffline() || refusedForBackup() || restartFailedNow()}
              title={restartFailedNow()
                ? restartFailedBadgeTitle(props.appTitle())
                : sourceOffline() ? `${sourceName()} is switched off` : refusedForBackup() ? NEEDS_BACKUP_TEXT : 'Update'}
              onClick={() => { result.reset(); setConfirming(true); }}
            >
              {badgeText(offer()!, sourceName())}
            </button>
            <Show when={refusedForBackup()}>
              <span class="edp-form__hint" data-testid={`update-needs-backup-${id()}`}>{backupHint()}</span>
            </Show>
          </div>
        </Show>

        <Show when={confirming() && offer()}>
          {(o) => (
            <div class="update-app__confirm" role="alertdialog" aria-label={`Update ${props.appTitle()}`} data-testid={`update-confirm-${id()}`}>
              <For each={confirmText(props.appTitle(), o(), sourceName(), backupFirst())}>{(line) => <p class="update-app__line">{line}</p>}</For>
              <Show when={o().major && o().migrationNote}>
                <p class="update-app__note" data-testid={`update-migration-note-${id()}`}>{o().migrationNote}</p>
              </Show>
              <Show when={needsBackup()}>
                <p class="edp-form__hint" data-testid={`update-confirm-needs-backup-${id()}`}>{backupHint()}</p>
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
        <Show when={leftover()}>
          {(lb) => (
            <TechnicalDetails
              class="update-app__leftover"
              testId={`update-leftover-backup-${id()}`}
              plain={leftoverTempBackupText(lb(), props.appTitle(), props.engine() ? engineLabel(props.store(), props.engine()!.id) : null)}
              raw={leftoverTempBackupRaw(lb())}
            />
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
