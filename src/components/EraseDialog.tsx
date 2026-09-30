/**
 * EraseDialog — summariseDisk → typed label → eraseDisk (files-disk.md §4 / §8,
 * idea#136). Used by "Erase this disk…" and the Files "Erase the disk first"
 * shortcut (erase, then createFilesDisk once the disk is republished ['empty']).
 */
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type Accessor, type Component } from 'solid-js';
import {
  createFilesDisk,
  eraseDisk,
  summariseDisk,
  DEFAULT_SHARE_NAME,
  validateShareName,
} from '../store/commands';
import { createCommandResult, FILES_TIMEOUT_MESSAGE } from '../store/commandResult';
import { traceIdSnapshot } from '../store/ejectResult';
import {
  DISK_REMOVED_MESSAGE,
  ERASE_NO_RESPONSE_MESSAGE,
  ERASE_NO_RESPONSE_MS,
  ERASE_SLOW_MESSAGE,
  ERASE_SLOW_MS,
  ERASE_STEPS,
  ERASE_WARNING,
  MAKING_FILES_STEP,
  SUMMARY_STALE_MESSAGE,
  countText,
  findTargetTrace,
  isErasedEmptyDisk,
  isSummaryStale,
  parseContentSummary,
  sizeText,
} from '../store/erase';
import { formatBytes } from '../store/diskRoles';
import type { CommandLogState } from '../store/commandLog';
import type { ContentSummary, Store } from '../types/store';

export type EraseMode = 'erase' | 'erase-then-files';

interface EraseDialogProps {
  /** Disk ID or unformattedDisks[].candidateId. */
  targetId: string;
  engineId: string;
  /** Known label before the summary arrives (disk name or candidate label). */
  fallbackLabel: string;
  mode: EraseMode;
  /** Share name for erase-then-files (validated by the caller). */
  shareName?: string;
  store: () => Store | null;
  commandLogStore?: Accessor<CommandLogState>;
  onClose: () => void;
  /** After a plain erase: disk is ['empty'] — select it / open Empty Disk panel. */
  onErasedEmpty?: (diskId: string) => void;
  /** After erase-then-files success: disk has 'files'. */
  onBecameFiles?: (diskId: string) => void;
  /** erase-then-files: createFilesDisk failed; disk is empty — land on Empty Disk with error. */
  onFilesFailed?: (diskId: string, message: string) => void;
}

type Phase =
  | { kind: 'summarising' }
  | { kind: 'summary'; summary: ContentSummary; traceId: string }
  | { kind: 'summary-error'; message: string }
  | { kind: 'erasing'; summary: ContentSummary; startedAt: number }
  | { kind: 'success'; summary: ContentSummary }
  | { kind: 'error'; message: string }
  | { kind: 'removed' };

const EraseDialog: Component<EraseDialogProps> = (props) => {
  const [phase, setPhase] = createSignal<Phase>({ kind: 'summarising' });
  const [confirmName, setConfirmName] = createSignal('');
  const [now, setNow] = createSignal(Date.now());
  const [slow, setSlow] = createSignal(false);
  const [makingFiles, setMakingFiles] = createSignal(false);

  const tick = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(tick));

  // ── summariseDisk ────────────────────────────────────────────────────────
  let summariseBaseline: Set<string> = new Set();
  let summariseTimer: ReturnType<typeof setTimeout> | null = null;
  const clearSummariseTimer = () => {
    if (summariseTimer !== null) { clearTimeout(summariseTimer); summariseTimer = null; }
  };
  onCleanup(clearSummariseTimer);

  const startSummarise = () => {
    clearSummariseTimer();
    setPhase({ kind: 'summarising' });
    setConfirmName('');
    summariseBaseline = traceIdSnapshot(props.commandLogStore?.() ?? null);
    summariseDisk(props.engineId, props.targetId);
    summariseTimer = setTimeout(() => {
      summariseTimer = null;
      if (phase().kind === 'summarising') {
        setPhase({ kind: 'summary-error', message: ERASE_NO_RESPONSE_MESSAGE });
      }
    }, ERASE_NO_RESPONSE_MS);
  };

  onMount(() => startSummarise());

  createEffect(() => {
    if (phase().kind !== 'summarising') return;
    const cls = props.commandLogStore?.() ?? null;
    const trace = findTargetTrace(cls, summariseBaseline, 'summariseDisk', props.targetId);
    if (!trace || trace.status === 'running') return;
    clearSummariseTimer();
    if (trace.status === 'error') {
      setPhase({
        kind: 'summary-error',
        message: (trace.errorMessage ?? '').trim() || 'Could not read the disk.',
      });
      return;
    }
    const summary = parseContentSummary(trace);
    if (!summary) {
      setPhase({ kind: 'summary-error', message: 'The Engine returned an empty summary.' });
      return;
    }
    setPhase({ kind: 'summary', summary, traceId: trace.traceId });
  });

  // Disk removed mid-dialog (Disk targets only; unformatted live on the Engine)
  const startedAsDisk = !!props.store()?.diskDB[props.targetId];
  createEffect(() => {
    const p = phase();
    if (!startedAsDisk) return;
    if (p.kind === 'erasing' || p.kind === 'success' || p.kind === 'removed' || p.kind === 'error') return;
    if (!props.store()?.diskDB[props.targetId]) setPhase({ kind: 'removed' });
  });

  const stale = createMemo(() => {
    const p = phase();
    if (p.kind !== 'summary') return false;
    return isSummaryStale(p.summary, now());
  });

  const labelMatches = createMemo(() => {
    const p = phase();
    if (p.kind !== 'summary') return false;
    return confirmName() === p.summary.label;
  });

  // ── eraseDisk ────────────────────────────────────────────────────────────
  let eraseBaseline: Set<string> = new Set();
  let eraseNoResponseTimer: ReturnType<typeof setTimeout> | null = null;
  let eraseSlowTimer: ReturnType<typeof setTimeout> | null = null;
  const clearEraseTimers = () => {
    if (eraseNoResponseTimer !== null) { clearTimeout(eraseNoResponseTimer); eraseNoResponseTimer = null; }
    if (eraseSlowTimer !== null) { clearTimeout(eraseSlowTimer); eraseSlowTimer = null; }
  };
  onCleanup(clearEraseTimers);

  const startErase = () => {
    const p = phase();
    if (p.kind !== 'summary' || stale() || !labelMatches()) return;
    clearEraseTimers();
    setSlow(false);
    eraseBaseline = traceIdSnapshot(props.commandLogStore?.() ?? null);
    const startedAt = Date.now();
    setPhase({ kind: 'erasing', summary: p.summary, startedAt });
    eraseDisk(props.engineId, props.targetId, p.traceId, p.summary.label);
    eraseNoResponseTimer = setTimeout(() => {
      eraseNoResponseTimer = null;
      const cur = phase();
      if (cur.kind !== 'erasing') return;
      const eng = props.store()?.engineDB[props.engineId];
      const progress = eng?.eraseInProgress && String(eng.eraseInProgress.targetId) === props.targetId;
      const trace = findTargetTrace(props.commandLogStore?.() ?? null, eraseBaseline, 'eraseDisk', props.targetId);
      if (!progress && !trace) setPhase({ kind: 'error', message: ERASE_NO_RESPONSE_MESSAGE });
    }, ERASE_NO_RESPONSE_MS);
    eraseSlowTimer = setTimeout(() => {
      eraseSlowTimer = null;
      if (phase().kind === 'erasing') setSlow(true);
    }, ERASE_SLOW_MS);
  };

  createEffect(() => {
    const p = phase();
    if (p.kind !== 'erasing') return;
    const cls = props.commandLogStore?.() ?? null;
    const trace = findTargetTrace(cls, eraseBaseline, 'eraseDisk', props.targetId);
    if (!trace || trace.status === 'running') return;
    clearEraseTimers();
    if (trace.status === 'error') {
      setPhase({
        kind: 'error',
        message: (trace.errorMessage ?? '').trim() || 'Erase failed.',
      });
      return;
    }
    // Wait for republish as ['empty'] with same ID (Disk and candidate both land as diskDB[targetId])
    // createEffect below watches for empty / then files shortcut
    setPhase({ kind: 'success', summary: p.summary });
  });

  // After erase ok: wait for empty disk, then maybe createFilesDisk
  const filesResult = createCommandResult({
    commandLog: () => props.commandLogStore?.() ?? null,
    command: 'createFilesDisk',
    argKey: 'diskId',
    isSuccess: () => (props.store()?.diskDB[props.targetId]?.diskTypes ?? []).includes('files'),
  });

  createEffect(() => {
    const p = phase();
    if (p.kind !== 'success') return;
    const disk = props.store()?.diskDB[props.targetId];
    if (!isErasedEmptyDisk(disk)) return;
    if (props.mode === 'erase') {
      props.onErasedEmpty?.(props.targetId);
      return;
    }
    // erase-then-files
    if (makingFiles()) return;
    if (filesResult.state().kind !== 'idle') return;
    setMakingFiles(true);
    const share = props.shareName && !validateShareName(props.shareName)
      ? props.shareName
      : DEFAULT_SHARE_NAME;
    filesResult.start(props.targetId, () => createFilesDisk(props.engineId, props.targetId, share));
  });

  createEffect(() => {
    if (!makingFiles()) return;
    const s = filesResult.state();
    if (s.kind === 'success') {
      props.onBecameFiles?.(props.targetId);
    } else if (s.kind === 'error') {
      props.onFilesFailed?.(props.targetId, s.message);
    } else if (s.kind === 'timeout') {
      props.onFilesFailed?.(props.targetId, FILES_TIMEOUT_MESSAGE);
    }
  });

  const progressStep = createMemo((): string | null => {
    if (makingFiles()) {
      const s = filesResult.state();
      if (s.kind === 'pending') return MAKING_FILES_STEP;
    }
    if (phase().kind !== 'erasing' && phase().kind !== 'success') return null;
    const eng = props.store()?.engineDB[props.engineId];
    const ip = eng?.eraseInProgress;
    if (ip && String(ip.targetId) === props.targetId) return ip.step;
    if (phase().kind === 'erasing') return 'checking';
    return null;
  });

  const titleLabel = () => {
    const p = phase();
    if (p.kind === 'summary' || p.kind === 'erasing' || p.kind === 'success') return p.summary.label;
    return props.fallbackLabel;
  };

  return (
    <div class="erase-dialog" role="dialog" data-testid="erase-dialog" aria-label={`Erase ${titleLabel()}`}>
      <h2 class="erase-dialog__title">Erase {titleLabel()}?</h2>

      <Show when={phase().kind === 'summarising'}>
        <p class="edp-form__hint">Reading the disk…</p>
      </Show>

      <Show when={phase().kind === 'summary-error'}>
        <p class="edp-form__error" role="alert">{(phase() as { message: string }).message}</p>
        <div class="edp-form__actions">
          <button class="btn" onClick={() => props.onClose()}>Close</button>
          <button class="btn" onClick={startSummarise}>Try again</button>
        </div>
      </Show>

      <Show when={phase().kind === 'removed'}>
        <p class="edp-form__error" role="alert">{DISK_REMOVED_MESSAGE}</p>
        <div class="edp-form__actions">
          <button class="btn" onClick={() => props.onClose()}>Close</button>
        </div>
      </Show>

      <Show when={phase().kind === 'summary'}>
        {(p) => {
          const summary = () => (phase() as { summary: ContentSummary }).summary;
          return (
            <>
              <SummaryBody summary={summary} />
              <p class="erase-dialog__warning" role="alert">{ERASE_WARNING}</p>
              <Show
                when={!stale()}
                fallback={
                  <p class="edp-form__error" role="alert">{SUMMARY_STALE_MESSAGE}</p>
                }
              >
                <label class="edp-form__label" for="erase-confirm-name">
                  Type <strong>{summary().label}</strong> to confirm
                </label>
                <input
                  id="erase-confirm-name"
                  data-testid="erase-confirm-name"
                  class="edp-form__search erase-dialog__confirm"
                  type="text"
                  value={confirmName()}
                  autocomplete="off"
                  onInput={(e) => setConfirmName((e.target as HTMLInputElement).value)}
                />
              </Show>
              <div class="edp-form__actions">
                <button class="btn" onClick={() => props.onClose()}>Cancel</button>
                <Show when={!stale()}>
                  <button
                    class="btn btn--danger"
                    disabled={!labelMatches()}
                    onClick={startErase}
                  >
                    {props.mode === 'erase-then-files' ? 'Erase and make a Files Disk' : 'Erase this disk'}
                  </button>
                </Show>
                <Show when={stale()}>
                  <button class="btn" onClick={startSummarise}>Check the disk again</button>
                </Show>
              </div>
            </>
          );
        }}
      </Show>

      <Show when={phase().kind === 'erasing' || (phase().kind === 'success' && makingFiles())}>
        <p class="erase-dialog__progress" role="status" data-erase-step={progressStep() ?? ''}>
          {progressStep() ?? 'checking'}…
        </p>
        <Show when={slow()}>
          <p class="edp-form__hint" role="status">{ERASE_SLOW_MESSAGE}</p>
        </Show>
        <ProgressSteps current={progressStep()} />
      </Show>

      <Show when={phase().kind === 'error'}>
        <p class="edp-form__error" role="alert">{(phase() as { message: string }).message}</p>
        <div class="edp-form__actions">
          <button class="btn" onClick={() => props.onClose()}>Close</button>
        </div>
      </Show>

      <Show when={phase().kind === 'success' && !makingFiles() && props.mode === 'erase'}>
        <SuccessBody summary={() => (phase() as { summary: ContentSummary }).summary} />
        <div class="edp-form__actions">
          <button
            class="btn btn--primary"
            onClick={() => {
              props.onErasedEmpty?.(props.targetId);
              props.onClose();
            }}
          >
            Done
          </button>
        </div>
      </Show>
    </div>
  );
};

const SummaryBody: Component<{ summary: () => ContentSummary }> = (props) => {
  const s = () => props.summary();
  return (
    <div class="erase-dialog__summary">
      <p><strong>{s().label}</strong></p>
      <Show when={s().model}><p>Model: {s().model}</p></Show>
      <p>Size: {sizeText(s().sizeBytes)}{s().usedBytes != null ? ` (${sizeText(s().usedBytes)} used)` : ''}</p>
      <Show when={s().fsType}><p>Filesystem: {s().fsType}</p></Show>
      <Show
        when={s().readable}
        fallback={<p class="erase-dialog__unknown" role="status">Contents unknown</p>}
      >
        <Show when={s().apps.length > 0}>
          <p class="erase-dialog__label">Apps:</p>
          <ul>
            <For each={s().apps.map((a) => `${a.name}@${a.version}`)}>
              {(id) => <li data-app={id}>{id}</li>}
            </For>
          </ul>
        </Show>
        <Show when={s().instances.length > 0}>
          <p class="erase-dialog__label">Instances:</p>
          <ul>
            <For each={s().instances.map((i) => i.id)}>
              {(id) => {
                const inst = () => s().instances.find((i) => i.id === id)!;
                return (
                  <li data-instance-id={id}>
                    {inst().name}
                    {inst().dataBytes != null ? ` (${formatBytes(inst().dataBytes!)})` : ''}
                    {inst().running ? ' — will be stopped' : ''}
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
        <Show when={s().backups.length > 0}>
          <p class="erase-dialog__label">Backups:</p>
          <ul>
            <For each={s().backups.map((b) => b.instanceId)}>
              {(id) => {
                const b = () => s().backups.find((x) => x.instanceId === id)!;
                return <li data-backup-instance={id}>{b().instanceName}</li>;
              }}
            </For>
          </ul>
        </Show>
        <Show when={s().files}>
          {(f) => (
            <p>
              Files: {countText(f().fileCount, f().partial)} files
              ({sizeText(f().totalBytes)})
            </p>
          )}
        </Show>
        <Show when={s().other}>
          {(o) => (
            <p>
              Other files: {countText(o().entryCount, o().partial)} entries
              ({sizeText(o().totalBytes)})
            </p>
          )}
        </Show>
      </Show>
    </div>
  );
};

const SuccessBody: Component<{ summary: () => ContentSummary }> = (props) => {
  const s = () => props.summary();
  return (
    <div class="erase-dialog__result" role="status">
      <p>Disk erased. It is now an empty IDEA disk.</p>
      <Show when={s().instances.length > 0}>
        <p class="erase-dialog__label">Removed instances:</p>
        <ul>
          <For each={s().instances.map((i) => i.id)}>
            {(id) => {
              const inst = () => s().instances.find((i) => i.id === id)!;
              return (
                <li data-removed-instance={id}>
                  {inst().name}
                  {inst().dataBytes != null ? ` (${formatBytes(inst().dataBytes!)})` : ''}
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
      <Show when={s().backups.length > 0}>
        <p class="erase-dialog__backups-erased">Backups on this disk were erased.</p>
      </Show>
    </div>
  );
};

const ProgressSteps: Component<{ current: string | null }> = (props) => {
  const steps = () => [...ERASE_STEPS, MAKING_FILES_STEP];
  return (
    <ol class="erase-dialog__steps">
      <For each={steps()}>
        {(step) => (
          <li
            data-step={step}
            classList={{
              'erase-dialog__step--current': props.current === step,
              'erase-dialog__step--done':
                !!props.current
                && steps().indexOf(props.current) > steps().indexOf(step),
            }}
          >
            {step}
          </li>
        )}
      </For>
    </ol>
  );
};

export default EraseDialog;
