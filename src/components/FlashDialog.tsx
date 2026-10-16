/**
 * FlashDialog (idea#201 §10.2): pick version → confirm (target, size, contents,
 * wipe warning) → progress (Cancel while allowed) → "Done – safe to remove".
 * Follows the target Engine's command log; Engine access via ../store/clientCards.
 */
import { For, Match, Show, Switch, createMemo, createSignal, type Accessor, type Component } from 'solid-js';
import CommandFeedback from './CommandFeedback';
import { createCommandResult, findCommandTrace, type CommandResult } from '../store/commandResult';
import { traceIdSnapshot } from '../store/ejectResult';
import { mergeCommandLogs, remoteCommandLog } from '../store/remoteCommandLogs';
import { formatBytes } from '../store/diskRoles';
import type { CommandLogState } from '../store/commandLog';
import type { Store } from '../types/store';
import {
  CAP_HINT,
  FLASH_STEP_COUNT,
  flashStepNumber,
  FLASH_STEP_LABELS,
  TRACE,
  cancelFlash,
  contentsLabel,
  currentImageVersion,
  engineOf,
  errorText,
  findClientCard,
  findDiskOperation,
  flashCard,
  flashableImages,
  hasCap,
  parseEngineError,
  parseFlashResult,
  readerForCard,
} from '../store/clientCards';

interface FlashDialogProps {
  engineId: string;
  candidateId: string;
  store: () => Store | null;
  commandLogStore?: Accessor<CommandLogState>;
  onClose: () => void;
}

type Phase = 'pick' | 'confirm' | 'running';

export const SAFE_TO_REMOVE_TEXT = 'Done – safe to remove';
export const EJECT_FIRST_TEXT = 'Done – eject the card before removing it';
const CANCELLABLE = new Set(['checking', 'verifying-image', 'writing']);

/** CommandResult whose error messages are the plain teacher-facing text. */
const plain = (r: CommandResult): CommandResult => ({
  ...r,
  state: () => {
    const s = r.state();
    return s.kind === 'error' ? { kind: 'error', message: errorText(s.message) } : s;
  },
});

const FlashDialog: Component<FlashDialogProps> = (props) => {
  const engine = () => engineOf(props.store(), props.engineId);
  // Snapshot of what the user saw: the confirm step and confirmSizeBytes use THIS.
  const seen = findClientCard(engine(), props.candidateId);
  const seenReader = seen ? readerForCard(engine(), seen) : undefined;
  const targetName = seenReader ? `${seenReader.name} (port ${seenReader.usbPath})` : (seen?.model ?? props.candidateId);

  const images = createMemo(() => flashableImages(engine()));
  /** Version strings: <For> keyed by a stable id, not by store object identity. */
  const versions = createMemo(() => images().map((i) => i.version), [], { equals: (a, b) => a.length === b.length && a.every((x, i) => x === b[i]) });
  const [version, setVersion] = createSignal<string | null>(currentImageVersion(engine()) ?? images()[0]?.version ?? null);
  const [phase, setPhase] = createSignal<Phase>('pick');
  const [startedAt, setStartedAt] = createSignal(0);
  const [cancelSent, setCancelSent] = createSignal(false);
  let baseline = new Set<string>();

  const cls = () => mergeCommandLogs(props.commandLogStore?.() ?? null, remoteCommandLog(props.engineId)?.() ?? null);
  const raw = createCommandResult({ commandLog: cls, command: TRACE.flash, argKey: 'candidateId', matchMode: 'key', longRunning: true });
  const result = plain(raw);
  const cancelRaw = createCommandResult({ commandLog: cls, command: TRACE.cancel, argKey: 'operationId', matchMode: 'key' });
  const cancelResult = plain(cancelRaw);

  const op = createMemo(() => (phase() === 'running' ? findDiskOperation(props.store(), props.engineId, 'flashCard', props.candidateId, startedAt() - 5_000) : undefined));
  const trace = createMemo(() => (phase() === 'running' ? findCommandTrace(cls(), baseline, TRACE.flash, 'candidateId', props.candidateId, 'key') : null));

  type Outcome =
    | { kind: 'progress' }
    | { kind: 'done'; safe: boolean; note: string | null }
    | { kind: 'failed'; text: string; code: string | null }
    | { kind: 'cancelled' };
  const outcome = createMemo((): Outcome => {
    const o = op();
    const t = trace();
    // Contract v2: no Cancelled status; a cancel is Failed 'CANCELLED: ...'.
    if (o?.status === 'Failed') {
      const e = parseEngineError(o.error);
      return e.code === 'CANCELLED' ? { kind: 'cancelled' } : { kind: 'failed', text: e.text, code: e.code };
    }
    if (o?.status === 'Done') {
      // Contract v2: Operation.safeToRemove (set with Done) is the primary signal.
      if (o.safeToRemove === true) return { kind: 'done', safe: true, note: null };
      if (o.safeToRemove === false) return { kind: 'done', safe: false, note: errorText('POWER_OFF_FAILED: ') };
      // Fallback (older Engine without the field): the closed trace's result.
      if (!t || t.status === 'running') return { kind: 'progress' };
      const r = parseFlashResult(t);
      if (r?.safeToRemove === true) return { kind: 'done', safe: true, note: null };
      const e = parseEngineError(t.errorMessage);
      return {
        kind: 'done',
        safe: false,
        note: e.code === 'POWER_OFF_FAILED' || r?.safeToRemove === false
          ? errorText('POWER_OFF_FAILED: ')
          : 'The Engine did not confirm that the card was switched off.',
      };
    }
    return { kind: 'progress' };
  });

  const card = () => findClientCard(engine(), props.candidateId);
  const flashBlocked = (): string | null => {
    if (!hasCap(engine(), 'flashCard')) return CAP_HINT.flashCard;
    if (!hasCap(engine(), 'clientImages')) return CAP_HINT.clientImages;
    const c = card();
    if (!c) return errorText('NOT_FOUND: ');
    if (!c.flashable) return c.refusal ? errorText(`${c.refusal}: `) : 'The Engine says this card cannot be flashed.';
    if (images().length === 0) return 'There is no verified client image on this Pi yet.';
    const busy = engine()?.flashInProgress;
    if (busy && busy.candidateId !== props.candidateId) return errorText('BUSY: ');
    return null;
  };

  const tooSmall = () => {
    const img = images().find((i) => i.version === version());
    return !!(img?.imageSizeBytes && seen && img.imageSizeBytes > seen.sizeBytes);
  };

  const startFlash = () => {
    const v = version();
    if (!seen || !v || flashBlocked()) return;
    baseline = traceIdSnapshot(cls());
    setStartedAt(Date.now());
    setPhase('running');
    raw.start(props.candidateId, () => flashCard(props.engineId, props.candidateId, v, seen.sizeBytes));
  };

  const doCancel = () => {
    const o = op();
    if (!o || cancelSent()) return;
    setCancelSent(true);
    cancelRaw.start(o.id, () => cancelFlash(props.engineId, o.id));
  };

  const stepLabel = () => {
    const o = op();
    const s = (o?.stepLabel ?? engine()?.flashInProgress?.step ?? null) as keyof typeof FLASH_STEP_LABELS | null;
    return s && FLASH_STEP_LABELS[s] ? FLASH_STEP_LABELS[s] : 'Waiting for the Engine';
  };
  const canCancel = () => {
    const o = op();
    const s = o?.stepLabel ?? engine()?.flashInProgress?.step ?? '';
    return !!o && (o.status === 'Pending' || o.status === 'Running') && CANCELLABLE.has(s) && !cancelSent();
  };
  const finished = () => outcome().kind !== 'progress' || ['error', 'timeout'].includes(raw.state().kind);

  return (
    <section class="flash-dialog" role="dialog" aria-label="Flash client card" data-testid="flash-dialog">
      <h3 class="disk-section__title">Flash client card</h3>
      <Switch>
        <Match when={phase() === 'pick'}>
          <div data-testid="flash-step-pick">
            <p>Card: {targetName}</p>
            <Show when={flashBlocked()}>
              {(why) => <p class="edp-form__error" role="alert" data-testid="flash-blocked">{why()}</p>}
            </Show>
            <fieldset class="flash-dialog__versions">
              <legend>Image version</legend>
              <For each={versions()}>
                {(v) => (
                  <label data-testid={`flash-version-${v}`}>
                    <input
                      type="radio"
                      name="flash-version"
                      value={v}
                      checked={version() === v}
                      onChange={() => setVersion(v)}
                    />
                    {' '}{v}
                    {v === currentImageVersion(engine()) ? ' (current)' : ''}
                    {v === engine()?.clientImages?.previous ? ' (previous)' : ''}
                  </label>
                )}
              </For>
            </fieldset>
            <Show when={tooSmall()}>
              <p class="edp-form__error" data-testid="flash-too-small">{errorText('IMAGE_TOO_LARGE: ')}</p>
            </Show>
            <div class="edp-form__actions">
              <button class="btn" onClick={() => props.onClose()}>Close</button>
              <button
                class="btn"
                data-testid="flash-next"
                disabled={!!flashBlocked() || !version() || tooSmall()}
                onClick={() => setPhase('confirm')}
              >
                Next
              </button>
            </div>
          </div>
        </Match>

        <Match when={phase() === 'confirm'}>
          <div data-testid="flash-step-confirm">
            <dl class="flash-dialog__target">
              <dt>Card</dt><dd data-testid="flash-confirm-target">{targetName}</dd>
              <dt>Size</dt><dd data-testid="flash-confirm-size">{formatBytes(seen?.sizeBytes ?? 0)}</dd>
              <dt>Now on the card</dt><dd data-testid="flash-confirm-contents">{contentsLabel(seen?.contents)}</dd>
              <dt>Image</dt><dd data-testid="flash-confirm-version">{version()}</dd>
            </dl>
            <p class="edp-form__error" role="alert" data-testid="flash-wipe-warning">
              Everything on this card will be wiped ({contentsLabel(seen?.contents)}, {formatBytes(seen?.sizeBytes ?? 0)}). This cannot be undone.
            </p>
            <Show when={flashBlocked()}>
              {(why) => <p class="edp-form__error" role="alert" data-testid="flash-blocked">{why()}</p>}
            </Show>
            <div class="edp-form__actions">
              <button class="btn" data-testid="flash-back" onClick={() => setPhase('pick')}>Back</button>
              <button class="btn btn--danger" data-testid="flash-confirm" disabled={!!flashBlocked()} onClick={startFlash}>
                Wipe and flash
              </button>
            </div>
          </div>
        </Match>

        <Match when={phase() === 'running'}>
          <div data-testid="flash-step-running">
            <Switch>
              <Match when={outcome().kind === 'done' && (outcome() as { safe: boolean }).safe}>
                <p class="edp-form__success" role="status" data-testid="flash-done">{SAFE_TO_REMOVE_TEXT}</p>
              </Match>
              <Match when={outcome().kind === 'done'}>
                <p class="edp-form__error" role="alert" data-testid="flash-done-eject">{EJECT_FIRST_TEXT}</p>
                <p class="edp-form__hint" data-testid="flash-done-note">{(outcome() as { note: string | null }).note}</p>
              </Match>
              <Match when={outcome().kind === 'failed'}>
                <p class="edp-form__error" role="alert" data-testid="flash-failed" data-code={(outcome() as { code: string | null }).code ?? ''}>
                  Flash failed: {(outcome() as { text: string }).text}
                </p>
              </Match>
              <Match when={outcome().kind === 'cancelled'}>
                <p class="edp-form__hint" role="status" data-testid="flash-cancelled">{errorText('CANCELLED: ')}</p>
              </Match>
              <Match when={!['error', 'timeout'].includes(raw.state().kind)}>
                <div data-testid="flash-progress">
                  <p data-testid="flash-step-label">
                    Step {flashStepNumber(op()?.stepLabel ?? engine()?.flashInProgress?.step, op()?.currentStep)} of {op()?.totalSteps ?? FLASH_STEP_COUNT}: {stepLabel()}
                  </p>
                  <progress
                    max={100}
                    value={op()?.progressPercent ?? 0}
                    data-testid="flash-progress-bar"
                    aria-label="Flash progress"
                  />
                  <Show when={op()?.progressPercent != null}>
                    <span data-testid="flash-progress-percent"> {Math.round(op()!.progressPercent!)}%</span>
                  </Show>
                  <p class="edp-form__hint">Do not remove the card.</p>
                </div>
              </Match>
            </Switch>
            <CommandFeedback result={result} subject={() => targetName} testId="flash-feedback" />
            <CommandFeedback result={cancelResult} subject={() => targetName} testId="flash-cancel-feedback" />
            <div class="edp-form__actions">
              <Show when={canCancel()}>
                <button class="btn btn--danger" data-testid="flash-cancel" onClick={doCancel}>Cancel flash</button>
              </Show>
              <Show when={finished()}>
                <button class="btn" data-testid="flash-close" onClick={() => props.onClose()}>Close</button>
              </Show>
            </div>
          </div>
        </Match>
      </Switch>
    </section>
  );
};

export default FlashDialog;
