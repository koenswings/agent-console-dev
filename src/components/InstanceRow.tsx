import { versionLabel } from '../store/updateApp';
import { Show, For, createSignal, createEffect, createMemo, onCleanup, type Component } from 'solid-js';
import type { Accessor } from 'solid-js';
import StatusDot from './StatusDot';

// Strip ANSI escape sequences from engine log messages
const ANSI_RE = /\u001b\[[0-9;]*[mGKHFABCDJsu]|\u001b[\[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g;
const stripAnsi = (s: string): string => s.replace(ANSI_RE, '');
import LogLines from './LogLines';
import StepProgressBar from './StepProgressBar';
import { startInstance, stopInstance, backupApp } from '../store/commands';
import { createCommandResult } from '../store/commandResult';
import CommandFeedback from './CommandFeedback';
import RenameInstanceName from './RenameInstanceName';
import UpdateAppControl from './UpdateAppControl';
import { canUpdate, isUpdateRunning, latestUpdateOp, OP_KIND as UPDATE_OP_KIND } from '../store/updateApp';
import RemoveInstanceControl from './RemoveInstanceControl';
import { canOfferRemove } from '../store/removeInstance';
import {
  confirmInstanceStatus,
  confirmNewOperation,
  lastBackupAdvanced,
  remoteWatchFor,
} from '../store/remoteConfirm';
import { getActiveOpsForInstance, isInstanceLocked } from '../store/operations';
import { buildAppUrl, appHostContextFor, appEngineOffline, offlineAppHint } from '../store/appUrl';
import type { Instance, App, Engine, Disk, DockerMetrics, Store, Operation, OperationKind } from '../types/store';
import type { Status } from '../types/store';
import type { CommandLogStore, CommandTrace } from '../types/commandLog';
import type { DragAppData } from '../types/drag';
import { DRAG_TYPE } from '../types/drag';
import { live, liveNow, metricsFor } from '../store/live';
import { plainEngineText } from '../store/plainError';

interface InstanceRowProps {
  instance:         () => Instance | undefined;
  app:              () => App | undefined;
  engine:           () => Engine | undefined;
  /** Backup disks docked on the same engine and linked to this instance. */
  backupDisks?:     () => Disk[];
  /** The instance ID - used for operation locking lookups. */
  instanceId?:      string;
  /** Reactive store accessor - used for operation locking lookups. */
  store?:           () => Store | null;
  /** Command log store - used for showing recent trace logs in expanded view. */
  commandLogStore?: Accessor<import('../store/commandLog').CommandLogState>;
  /** Called when a drag starts on this row. */
  onDragStart?: (data: DragAppData) => void;
  /** Called when a drag ends (dropped or cancelled). */
  onDragEnd?:   () => void;
}

// ---------------------------------------------------------------------------
// ErrorCopyButton - inline copy button for the error text
// ---------------------------------------------------------------------------

const ErrorCopyButton: Component<{ text: () => string }> = (props) => {
  const [copied, setCopied] = createSignal(false);

  const handleCopy = () => {
    const text = props.text();
    const finish = () => { setCopied(true); setTimeout(() => setCopied(false), 2000); };
    const execFallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { if (document.execCommand('copy')) finish(); } finally { document.body.removeChild(ta); }
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(finish).catch(execFallback);
    } else {
      execFallback();
    }
  };

  return (
    <button class="instance-details__error-copy" onClick={handleCopy} title="Copy error to clipboard">
      {copied() ? '✓' : 'Copy'}
    </button>
  );
};

// ---------------------------------------------------------------------------
// Pure formatting helpers
// ---------------------------------------------------------------------------

const formatTs = (ts: number | null | undefined): string => {
  if (ts == null || ts === 0) return 'Never';
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

/** Format a lastBackup timestamp for display. */
export const formatLastBackup = (ts: number | null | undefined): string => formatTs(ts);

const formatBytes = (bytes: number | null): string => {
  if (bytes == null) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const formatPercent = (p: number | null): string =>
  p == null ? '-' : `${p.toFixed(2)}%`;

/** Returns true when the Start button should be disabled. */
export const isStartDisabled = (status: Status): boolean =>
  status === 'Running' || status === 'Starting';

/** Returns true when the Backup button should be disabled. */
export const isBackupDisabled = (status: Status): boolean =>
  status !== 'Running';

/** Returns true when the Stop button should be disabled. */
export const isStopDisabled = (status: Status): boolean =>
  status === 'Stopped' || status === 'Docked' || status === 'Undocked';

// ---------------------------------------------------------------------------
// Operation progress helpers
// ---------------------------------------------------------------------------

const OP_LABEL: Record<OperationKind, string> = {
  copyApp:       'Copying',
  moveApp:       'Moving',
  backupApp:     'Backing up',
  restoreApp:    'Restoring',
  upgradeApp:    'Upgrading',
  updateApp:     'Updating',
  upgradeEngine: 'Upgrading engine',
  startApp:      'Starting',
  stopApp:       'Stopping',
  flashCard:     'Flashing card',
  initialiseDisk: 'Initialising disk',
};

// ---------------------------------------------------------------------------
// DockerMetricsPanel - pure display component
// ---------------------------------------------------------------------------

interface MetricsPanelProps {
  metrics: () => DockerMetrics | null | undefined;
  /** Live metrics older than 45 s (live.ts): shown greyed with the last update time. */
  stale?: () => boolean;
  /** Console-clock time the live sample arrived, for the stale note. */
  receivedAt?: () => number | null;
}

export const DockerMetricsPanel: Component<MetricsPanelProps> = (props) => {
  const m = () => props.metrics();
  return (
    <div class="docker-metrics" classList={{ 'docker-metrics--stale': !!props.stale?.() }} data-testid="docker-metrics">
      <div class="docker-metrics__title">Container metrics</div>
      <Show when={props.stale?.() && m() != null}>
        <p class="docker-metrics__stale" data-testid="docker-metrics-stale">
          Stale: no update since {formatTs(props.receivedAt?.() ?? null)}
        </p>
      </Show>
      <Show
        when={m() != null}
        fallback={
          <p class="docker-metrics__unavailable">
            No metrics - app is not running.
          </p>
        }
      >
        <dl class="docker-metrics__grid">
          <div class="docker-metrics__item">
            <dt>CPU</dt>
            <dd>{formatPercent(m()!.cpuPercent)}</dd>
          </div>
          <div class="docker-metrics__item">
            <dt>Memory</dt>
            <dd>
              {formatBytes(m()!.memUsageBytes)} / {formatBytes(m()!.memLimitBytes)}
              <span class="docker-metrics__subval"> ({formatPercent(m()!.memPercent)})</span>
            </dd>
          </div>
          <div class="docker-metrics__item">
            <dt>Net I/O</dt>
            <dd>{formatBytes(m()!.netRxBytes)} in / {formatBytes(m()!.netTxBytes)} out</dd>
          </div>
          <div class="docker-metrics__item">
            <dt>Disk I/O</dt>
            <dd>{formatBytes(m()!.blockReadBytes)} read / {formatBytes(m()!.blockWriteBytes)} write</dd>
          </div>
          <Show when={m()!.sampledAt != null}>
            <div class="docker-metrics__item docker-metrics__item--sampled">
              <dt>Sampled</dt>
              <dd>{formatTs(m()!.sampledAt)}</dd>
            </div>
          </Show>
        </dl>
      </Show>
    </div>
  );
};

// ---------------------------------------------------------------------------
// InstanceRow
// ---------------------------------------------------------------------------

const InstanceRow: Component<InstanceRowProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [pendingAction, setPendingAction] = createSignal<'starting' | 'stopping' | null>(null);
  let pendingActionTimer: ReturnType<typeof setTimeout> | null = null;
  let pickerRef: HTMLDivElement | undefined;

  const setPendingWithTimeout = (action: 'starting' | 'stopping' | null) => {
    if (pendingActionTimer !== null) { clearTimeout(pendingActionTimer); pendingActionTimer = null; }
    setPendingAction(action);
    if (action !== null) {
      pendingActionTimer = setTimeout(() => { setPendingAction(null); pendingActionTimer = null; }, 15000);
    }
  };
  onCleanup(() => { if (pendingActionTimer !== null) clearTimeout(pendingActionTimer); });

  createEffect(() => {
    if (!pickerOpen()) return;
    const handleDocClick = (e: MouseEvent) => {
      if (pickerRef && !pickerRef.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleDocClick);
    onCleanup(() => document.removeEventListener('mousedown', handleDocClick));
  });

  // Clear pending start/stop once the instance reaches its expected state
  createEffect(() => {
    const status = props.instance()?.status;
    if (pendingAction() === 'starting' && (status === 'Running' || status === 'Error')) {
      setPendingWithTimeout(null);
    }
    if (pendingAction() === 'stopping' && (status === 'Stopped' || status === 'Docked' || status === 'Error')) {
      setPendingWithTimeout(null);
    }
  });

  // Also clear pending state when the active command trace finishes with an error
  // (engine may reject the command before the instance status ever updates)
  createEffect(() => {
    const trace = activeTrace();
    if (trace === null && pendingAction() !== null) {
      // Trace disappeared - check the most recent finished trace for this instance
      const last = instanceTraces()[0];
      if (last && last.status === 'error') {
        setPendingWithTimeout(null);
      }
    }
  });

  // ── Operation locking ────────────────────────────────────────────────────
  const activeOps = (): Operation[] => {
    if (!props.instanceId || !props.store) return [];
    return getActiveOpsForInstance(props.store(), props.instanceId);
  };

  const locked = (): boolean => {
    if (!props.instanceId || !props.store) return false;
    return isInstanceLocked(props.store(), props.instanceId);
  };

  const firstActiveOp = (): Operation | null => activeOps()[0] ?? null;

  // console#168: while an update runs (or the update UI owns the result), the
  // update control shows the step; unhealthy/starting is not shown as an error.
  const updateOwned = createMemo((): boolean => canUpdate(props.engine()));
  const updating = createMemo((): boolean =>
    updateOwned() && !!props.instanceId && isUpdateRunning(latestUpdateOp(props.store?.() ?? null, props.instanceId)));

  // Only show runtime failures on the app row (start/stop/backup/restore).
  // Copy/move failures are shown in the OperationProgress panel instead.
  const RUNTIME_OP_KINDS = new Set(['backupApp', 'restoreApp', 'upgradeApp', 'updateApp']);

  const failedOp = (): Operation | null => {
    if (!props.instanceId || !props.store) return null;
    const store = props.store();
    if (!store) return null;
    if (activeOps().length > 0) return null; // active ops take precedence
    const failed = Object.values(store.operationDB ?? {}).filter(
      (op) => op.status === 'Failed'
        && String(op.args['instanceId']) === String(props.instanceId)
        && RUNTIME_OP_KINDS.has(op.kind)
        && !(op.kind === UPDATE_OP_KIND && updateOwned())
    );
    if (failed.length === 0) return null;
    return failed.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0];
  };

  // All CommandTraces for this instance - matched by instanceId or instanceName in args, newest first
  const instanceTraces = createMemo((): CommandTrace[] => {
    if (!props.commandLogStore) return [];
    const cls = props.commandLogStore();
    if (!cls || (typeof cls === 'object' && 'error' in cls)) return [];
    const instanceId = props.instanceId;
    const instanceName = props.instance()?.name;
    return Object.values(cls.traces)
      .filter((t) => {
        try {
          const args: Record<string, string> = typeof t.args === 'string'
            ? JSON.parse(t.args) as Record<string, string>
            : t.args as Record<string, string>;
          return String(args['instanceId']) === String(instanceId) || String(args['instanceName']) === String(instanceName);
        } catch {
          return false;
        }
      })
      .sort((a, b) => b.startedAt - a.startedAt);
  });

  // Running trace → live steps; fallback to most recent finished trace for the expanded panel
  const activeTrace = createMemo((): CommandTrace | null =>
    instanceTraces().find((t) => t.status === 'running') ?? null
  );
  const recentTrace = createMemo((): CommandTrace | null =>
    activeTrace() ?? instanceTraces()[0] ?? null
  );

  // Reactive step label for startApp/stopApp inline progress.
  // Must be a memo — reading props.instance()?.stepLabel inside a Show child accessor
  // is not tracked; the memo ensures it re-evaluates on every store update.
  const activeOpStepLabel = createMemo((): string | null => {
    const op = firstActiveOp();
    if (!op || (op.kind !== 'startApp' && op.kind !== 'stopApp')) return null;
    return props.instance()?.stepLabel ?? op.stepLabel ?? null;
  });

  const activeOpProgressLabel = createMemo((): string => {
    const op = firstActiveOp();
    if (!op) return '';
    const stepLabel = activeOpStepLabel();
    if (stepLabel) return stepLabel;
    const pct = op.progressPercent;
    const label = OP_LABEL[op.kind] ?? op.kind;
    return pct != null ? `${label}\u2026 ${pct}%` : `${label}\u2026`;
  });

  // Step data — memos so signal reads are tracked outside Show child accessors.
  const activeOpCurrentStep = createMemo((): number | null =>
    props.instance()?.currentStep ?? firstActiveOp()?.currentStep ?? null
  );
  const activeOpTotalSteps = createMemo((): number | null =>
    props.instance()?.totalSteps ?? firstActiveOp()?.totalSteps ?? null
  );
  const activeOpProgressPct = createMemo((): number | null =>
    firstActiveOp()?.progressPercent ?? null
  );
  const activeOpDone = createMemo((): boolean =>
    firstActiveOp()?.status === 'Done'
  );

  // ── Engine answer for start / stop / backup (never silent) ───────────────
  // One result per row: the latest command's refusal or failure (e.g. "Too
  // many arguments", "Instance … not found") is shown under the row name.
  const cmdResult = createCommandResult({
    commandLog: () => props.commandLogStore?.() ?? null,
    argKey: 'instanceName',
  });
  createEffect(() => {
    // A refused start/stop never reaches the instance: drop the spinner.
    if (cmdResult.state().kind === 'error') setPendingWithTimeout(null);
  });
  const storeAcc = () => props.store?.() ?? null;

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleStart = () => {
    const engine = props.engine();
    const inst = props.instance();
    const diskId = inst?.storedOn;
    if (!engine || !inst || !diskId) return;
    // Disk ID (storedOn), never the display name: names may contain spaces.
    // Instance by NAME: no Engine (8d98718 nor Axle's fix) resolves an id here.
    cmdResult.start(inst.name, () => startInstance(engine.id, inst.name, String(diskId)), {
      command: 'startInstance',
      engineId: engine.id,
      remote: remoteWatchFor(storeAcc, engine.id, 'startInstance', confirmInstanceStatus(storeAcc, inst.id, ['Running'], 'startApp')),
    });
    setPendingWithTimeout('starting');
  };

  const handleStop = () => {
    const engine = props.engine();
    const inst = props.instance();
    const diskId = inst?.storedOn;
    if (!engine || !inst || !diskId) return;
    cmdResult.start(inst.name, () => stopInstance(engine.id, inst.name, String(diskId)), {
      command: 'stopInstance',
      engineId: engine.id,
      remote: remoteWatchFor(storeAcc, engine.id, 'stopInstance', confirmInstanceStatus(storeAcc, inst.id, ['Stopped', 'Docked'], 'stopApp')),
    });
    setPendingWithTimeout('stopping');
  };

  const sendBackup = (engineId: string, instanceId: string, backupDiskId: string) => {
    // Instance and backup disk by ID (see buildBackupAppCommand).
    cmdResult.start(instanceId, () => backupApp(engineId, instanceId, backupDiskId), {
      command: 'backupApp',
      longRunning: true,
      engineId,
      remote: remoteWatchFor(storeAcc, engineId, 'backupApp',
        confirmNewOperation(storeAcc, 'backupApp', instanceId, {
          engineId, args: { backupDiskId }, fallbackOk: lastBackupAdvanced(storeAcc, instanceId),
        })),
    });
  };

  const handleBackup = () => {
    const disks = props.backupDisks?.() ?? [];
    if (disks.length === 0) return;
    if (disks.length === 1) {
      const engine = props.engine();
      const inst = props.instance();
      if (!engine || !inst) return;
      sendBackup(engine.id, inst.id, disks[0].id);
    } else {
      setPickerOpen((v) => !v);
    }
  };

  const handleBackupTo = (disk: Disk) => {
    const engine = props.engine();
    const inst = props.instance();
    if (!engine || !inst) return;
    sendBackup(engine.id, inst.id, disk.id);
    setPickerOpen(false);
  };

  // Page context (engine count, page Engine id) for the App link host.
  const hostCtx = createMemo(() => appHostContextFor(props.store?.()));

  const isRunningInst = () => props.instance()?.status === 'Running' && !!props.engine();
  /** The instance's Engine is offline: Open is greyed out (follow-up to PR #162). */
  const appOffline = () => appEngineOffline(props.engine());
  /** Open link (appUrl.ts); null when not running, Engine offline, or no usable host/port. */
  const openUrl = () => {
    const inst = props.instance();
    if (!inst || !isRunningInst() || appOffline()) return null;
    return buildAppUrl(props.engine(), inst.port, hostCtx());
  };

  const hasBackupDisks = () => (props.backupDisks?.() ?? []).length > 0;

  const dragData = (): DragAppData | null => {
    const inst = props.instance();
    const disk = inst?.storedOn ? props.store?.()?.diskDB[String(inst.storedOn)] : undefined;
    if (!inst || !disk) return null;
    return {
      instanceId:     inst.id,
      instanceName:   inst.name,
      sourceDiskId:   String(inst.storedOn),
      sourceDiskName: disk.name,
    };
  };

  return (
    <div
      class="instance-row"
      role="listitem"
      data-testid={`instance-${props.instanceId ?? props.instance()?.id ?? ''}`}
      data-instance-id={props.instanceId ?? props.instance()?.id}
      data-copyable={dragData() ? 'true' : 'false'}
      data-source-disk-id={dragData()?.sourceDiskId ?? ''}
      draggable={Boolean(dragData())}
      onDragStart={(e) => {
        const data = dragData();
        if (!data) return;
        e.dataTransfer?.setData(DRAG_TYPE, JSON.stringify(data));
        props.onDragStart?.(data);
      }}
      onDragEnd={() => props.onDragEnd?.()}
    >
      {/* ── Main row ─────────────────────────────────────────── */}
      <button
        class="instance-row__status-btn"
        title={expanded() ? 'Hide details' : 'Show details'}
        aria-expanded={expanded()}
        aria-label={`${expanded() ? 'Hide' : 'Show'} details for ${props.instance()?.name}`}
        onClick={() => setExpanded((v) => !v)}
      >
        <StatusDot status={updating() && props.instance()?.status === 'Error' ? 'Starting' : props.instance()?.status ?? 'Stopped'} />
      </button>

      <div class="instance-row__info">
        <RenameInstanceName
          instance={props.instance}
          engine={props.engine}
          store={() => props.store?.() ?? null}
          commandLog={() => props.commandLogStore?.() ?? null}
        />
        <div class="instance-row__app">
          {props.app() ? props.app()!.title : props.instance()?.instanceOf}
        </div>

        {/* ── Inline operation progress ─────────────────────── */}
        {/* Hide when expanded: the log panel in expanded view is the source of truth */}
        <Show when={!expanded() && firstActiveOp() && !updating()}>
          <div class="instance-row__progress">
            <div class="instance-row__progress-label">{activeOpProgressLabel()}</div>
            <StepProgressBar
              currentStep={activeOpCurrentStep()}
              totalSteps={activeOpTotalSteps()}
              progressPercent={activeOpProgressPct()}
              done={activeOpDone()}
            />
          </div>
        </Show>
        <Show when={failedOp()}>
          {(op) => (
            <div class="instance-row__progress instance-row__progress--failed">
              <div class="instance-row__progress-label">
                Failed: {plainEngineText(op().error)} - Try again
              </div>
            </div>
          )}
        </Show>
        {/* Fallback spinner - shown only briefly before the engine's startApp/stopApp op lands in operationDB */}
        <Show when={!expanded() && !firstActiveOp() && pendingAction()}>
          <div class="instance-row__progress">
            <div class="instance-row__progress-label">
              {pendingAction() === 'starting' ? 'Starting...' : 'Stopping...'}
            </div>
            <StepProgressBar currentStep={null} totalSteps={null} progressPercent={null} />
          </div>
        </Show>
        <Show when={props.instance()?.status === 'Error' && props.instance()?.statusCondition && !expanded() && !updating()}>
          <div class="instance-row__error-hint">
            {plainEngineText(props.instance()!.statusCondition)}
          </div>
        </Show>
        <UpdateAppControl
          instance={props.instance}
          engine={props.engine}
          store={() => props.store?.() ?? null}
          commandLog={() => props.commandLogStore?.() ?? null}
          appTitle={() => props.app()?.title ?? props.instance()?.name ?? ''}
        />
        <CommandFeedback
          result={cmdResult}
          subject={() => props.instance()?.name ?? ''}
          testId={`instance-cmd-${props.instanceId ?? props.instance()?.id ?? ''}`}
        />
      </div>

      <div class="instance-row__actions">
        <button
          class="btn btn--start" data-testid={`start-instance-${props.instanceId ?? props.instance()?.id ?? ''}`}
          disabled={isStartDisabled(props.instance()?.status ?? 'Stopped') || locked() || pendingAction() === 'starting'}
          onClick={handleStart}
          title={locked() ? 'Operation in progress' : pendingAction() === 'starting' ? 'Starting...' : 'Start app'}
          aria-label={`Start ${props.instance()?.name}`}
        >
          Start
        </button>

        <button
          class="btn btn--stop" data-testid={`stop-instance-${props.instanceId ?? props.instance()?.id ?? ''}`}
          disabled={isStopDisabled(props.instance()?.status ?? 'Stopped') || locked() || pendingAction() === 'stopping'}
          onClick={handleStop}
          title={locked() ? 'Operation in progress' : pendingAction() === 'stopping' ? 'Stopping...' : 'Stop app'}
          aria-label={`Stop ${props.instance()?.name}`}
        >
          Stop
        </button>

        <Show when={hasBackupDisks()}>
          <div class="backup-picker" ref={pickerRef}>
            <button
              class="btn btn--backup"
              data-testid={`backup-instance-${props.instanceId ?? props.instance()?.id ?? ''}`}
              disabled={isBackupDisabled(props.instance()?.status ?? 'Stopped') || locked()}
              onClick={handleBackup}
              title={
                locked()
                  ? 'Operation in progress'
                  : (props.backupDisks?.() ?? []).length === 1
                  ? `Back up to ${props.backupDisks!()[0].name}`
                  : 'Select backup disk'
              }
              aria-label={`Back up ${props.instance()?.name}`}
            >
              Back up
            </button>
            <Show when={pickerOpen()}>
              <div class="backup-picker__dropdown" role="listbox" aria-label="Select backup disk">
                <For each={props.backupDisks?.() ?? []}>
                  {(disk) => (
                    <button
                      class="backup-picker__option"
                      data-testid={`backup-to-disk-${disk.id}`}
                      onClick={() => handleBackupTo(disk)}
                    >
                      {disk.name}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={isRunningInst()}>
          <Show
            when={openUrl()}
            fallback={
              <button
                class="btn--open" data-testid={`open-instance-${props.instanceId ?? props.instance()?.id ?? ''}`}
                disabled
                title={appOffline() ? offlineAppHint(props.engine()?.hostname) : 'No address or port known for this app yet'}
                aria-label={`Open ${props.instance()?.name} in browser (unavailable)`}
              >
                Open ↗
              </button>
            }
          >
            {(url) => (
              <a
                class="btn--open" data-testid={`open-instance-${props.instanceId ?? props.instance()?.id ?? ''}`}
                href={url()}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${props.instance()?.name} in browser`}
              >
                Open ↗
              </a>
            )}
          </Show>
          <Show when={appOffline()}>
            <span class="app-offline-hint" data-testid={`app-offline-hint-${props.instanceId ?? props.instance()?.id ?? ''}`}>
              {offlineAppHint(props.engine()?.hostname)}
            </span>
          </Show>
        </Show>
      </div>

      {/* ── Expandable details + metrics panel ───────────────── */}
      <Show when={expanded()}>
        <div
          class="instance-row__details"
          role="region"
          aria-label={`Details for ${props.instance()?.name}`}
        >
          {/* Log output — top of expanded panel so it's immediately visible during an op */}
          <Show when={recentTrace()}>
            {(trace) => (
              <div class="instance-row__cmd-log">
                <div class="instance-row__cmd-log-header">
                  <span class={`instance-row__trace-status instance-row__trace-status--${trace().status}`}>
                    {trace().status === 'running' ? '▶' : trace().status === 'ok' ? '✓' : '✗'}
                  </span>
                  <span class="instance-row__cmd-log-name">{trace().command}</span>
                </div>
                <Show
                  when={trace().logs.length > 0}
                  fallback={<div class="instance-row__trace-no-logs">{trace().status === 'running' ? 'Waiting for output…' : 'No log output'}</div>}
                >
                  <LogLines logs={trace().logs} />
                </Show>
              </div>
            )}
          </Show>

          <dl class="instance-details">
            <div class="instance-details__item">
              <dt>Status</dt>
              <dd>{props.instance()?.status ?? '-'}</dd>
            </div>
            <div class="instance-details__item">
              <dt>Version</dt>
              <dd>{versionLabel(props.app()?.version)}</dd>
            </div>
            <div class="instance-details__item">
              <dt>Engine</dt>
              <dd>{props.engine()?.hostname ?? '-'}</dd>
            </div>
            <div class="instance-details__item">
              <dt>Port</dt>
              <dd>{props.instance()?.port ?? '-'}</dd>
            </div>
            <div class="instance-details__item">
              <dt>Created</dt>
              <dd>{formatTs(props.instance()?.created)}</dd>
            </div>
            <div class="instance-details__item">
              <dt>Last started</dt>
              <dd>{formatTs(props.instance()?.lastStarted)}</dd>
            </div>
            <div class="instance-details__item">
              <dt>Last backup</dt>
              <dd>{formatTs(props.instance()?.lastBackup)}</dd>
            </div>
            <Show when={props.instance()?.status === 'Error' && props.instance()?.statusCondition}>
              <div class="instance-details__item instance-details__item--full instance-details__item--error">
                <dt>
                  Error
                  <ErrorCopyButton text={() => props.instance()!.statusCondition!} />
                </dt>
                <dd class="instance-details__error-text">{props.instance()!.statusCondition}</dd>
              </div>
            </Show>
            <Show when={props.app()?.description}>
              <div class="instance-details__item instance-details__item--full">
                <dt>Description</dt>
                <dd>{props.app()!.description}</dd>
              </div>
            </Show>
          </dl>

          <Show when={canOfferRemove(props.engine())}>
            <RemoveInstanceControl
              instance={props.instance}
              engine={props.engine}
              store={storeAcc}
              commandLog={() => props.commandLogStore?.() ?? null}
              locked={locked}
            />
          </Show>

          <DockerMetricsPanel
            metrics={() => metricsFor(props.instance(), live(), liveNow()).metrics}
            stale={() => metricsFor(props.instance(), live(), liveNow()).stale}
            receivedAt={() => metricsFor(props.instance(), live(), liveNow()).receivedAt}
          />
        </div>
      </Show>
    </div>
  );
};

export default InstanceRow;
