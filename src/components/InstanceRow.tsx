import { Show, For, createSignal, createEffect, createMemo, onCleanup, type Component } from 'solid-js';
import type { Accessor } from 'solid-js';
import StatusDot from './StatusDot';
import LogLines from './LogLines';
import { startInstance, stopInstance, backupApp } from '../store/commands';
import { getActiveOpsForInstance, isInstanceLocked } from '../store/operations';
import type { Instance, App, Engine, Disk, DockerMetrics, Store, Operation, OperationKind } from '../types/store';
import type { Status } from '../types/store';
import type { CommandLogStore, CommandTrace } from '../types/commandLog';
import type { DragAppData } from '../types/drag';
import { DRAG_TYPE } from '../types/drag';

interface InstanceRowProps {
  instance:         () => Instance | undefined;
  app:              () => App | undefined;
  engine:           () => Engine | undefined;
  /** Backup disks docked on the same engine and linked to this instance. */
  backupDisks?:     () => Disk[];
  /** The instance ID — used for operation locking lookups. */
  instanceId?:      string;
  /** Reactive store accessor — used for operation locking lookups. */
  store?:           () => Store | null;
  /** Command log store — used for showing recent trace logs in expanded view. */
  commandLogStore?: Accessor<CommandLogStore | null | false>;
  /** Called when a drag starts on this row. */
  onDragStart?: (data: DragAppData) => void;
  /** Called when a drag ends (dropped or cancelled). */
  onDragEnd?:   () => void;
}

// ---------------------------------------------------------------------------
// ErrorCopyButton — inline copy button for the error text
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
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const formatPercent = (p: number | null): string =>
  p == null ? '—' : `${p.toFixed(2)}%`;

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
  upgradeEngine: 'Upgrading engine',
};

// ---------------------------------------------------------------------------
// DockerMetricsPanel — pure display component
// ---------------------------------------------------------------------------

interface MetricsPanelProps {
  metrics: () => DockerMetrics | null | undefined;
}

export const DockerMetricsPanel: Component<MetricsPanelProps> = (props) => {
  const m = () => props.metrics();
  return (
    <div class="docker-metrics">
      <div class="docker-metrics__title">Container metrics</div>
      <Show
        when={m() != null}
        fallback={
          <p class="docker-metrics__unavailable">
            No metrics — app is not running.
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
  let pickerRef: HTMLDivElement | undefined;

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
      setPendingAction(null);
    }
    if (pendingAction() === 'stopping' && (status === 'Stopped' || status === 'Docked' || status === 'Error')) {
      setPendingAction(null);
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

  // Only show runtime failures on the app row (start/stop/backup/restore).
  // Copy/move failures are shown in the OperationProgress panel instead.
  const RUNTIME_OP_KINDS = new Set(['backupApp', 'restoreApp', 'upgradeApp']);

  const failedOp = (): Operation | null => {
    if (!props.instanceId || !props.store) return null;
    const store = props.store();
    if (!store) return null;
    if (activeOps().length > 0) return null; // active ops take precedence
    const failed = Object.values(store.operationDB ?? {}).filter(
      (op) => op.status === 'Failed'
        && op.args['instanceId'] === props.instanceId
        && RUNTIME_OP_KINDS.has(op.kind)
    );
    if (failed.length === 0) return null;
    return failed.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0];
  };

  // All CommandTraces for this instance — matched by instanceId or instanceName in args, newest first
  const instanceTraces = createMemo((): CommandTrace[] => {
    if (!props.commandLogStore) return [];
    const cls = props.commandLogStore();
    if (!cls) return [];
    const instanceId = props.instanceId;
    const instanceName = props.instance()?.name;
    return Object.values(cls.traces)
      .filter((t) => {
        try {
          const args: Record<string, string> = typeof t.args === 'string'
            ? JSON.parse(t.args) as Record<string, string>
            : t.args as Record<string, string>;
          return args['instanceId'] === instanceId || args['instanceName'] === instanceName;
        } catch {
          return false;
        }
      })
      .sort((a, b) => b.startedAt - a.startedAt);
  });

  // Keep the most recent running trace accessible for the inline progress bar
  const recentTrace = createMemo((): CommandTrace | null => {
    const running = instanceTraces().find((t) => t.status === 'running');
    return running ?? instanceTraces()[0] ?? null;
  });

  const [expandedTraceIds, setExpandedTraceIds] = createSignal<Set<string>>(new Set());
  const toggleTraceExpand = (id: string) => {
    setExpandedTraceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const [showAllTraces, setShowAllTraces] = createSignal(false);

  // The single most relevant trace to show by default:
  // prefer running, then most recent
  const primaryTrace = createMemo((): CommandTrace | null =>
    instanceTraces().find((t) => t.status === 'running') ?? instanceTraces()[0] ?? null
  );

  const visibleTraces = createMemo((): CommandTrace[] =>
    showAllTraces() ? instanceTraces() : (primaryTrace() ? [primaryTrace()!] : [])
  );

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleStart = () => {
    const engine = props.engine();
    const inst = props.instance();
    const disk = inst?.storedOn;
    if (!engine || !inst || !disk) return;
    startInstance(engine.id, inst.name, disk);
    setPendingAction('starting');
  };

  const handleStop = () => {
    const engine = props.engine();
    const inst = props.instance();
    const disk = inst?.storedOn;
    if (!engine || !inst || !disk) return;
    stopInstance(engine.id, inst.name, disk);
    setPendingAction('stopping');
  };

  const handleBackup = () => {
    const disks = props.backupDisks?.() ?? [];
    if (disks.length === 0) return;
    if (disks.length === 1) {
      const engine = props.engine();
      const inst = props.instance();
      if (!engine || !inst) return;
      backupApp(engine.id, inst.name, disks[0].name);
    } else {
      setPickerOpen((v) => !v);
    }
  };

  const handleBackupTo = (disk: Disk) => {
    const engine = props.engine();
    const inst = props.instance();
    if (!engine || !inst) return;
    backupApp(engine.id, inst.name, disk.name);
    setPickerOpen(false);
  };

  const openUrl = () => {
    const inst = props.instance();
    const eng = props.engine();
    if (!inst || inst.status !== 'Running' || !eng) return null;
    const port = inst.port;
    if (!port) return null;
    return `http://${eng.hostname}.local:${port}`;
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
      draggable={true}
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
        <StatusDot status={props.instance()?.status ?? 'Stopped'} />
      </button>

      <div class="instance-row__info">
        <div class="instance-row__name">{props.instance()?.name}</div>
        <div class="instance-row__app">
          {props.app() ? props.app()!.title : props.instance()?.instanceOf}
        </div>

        {/* ── Inline operation progress ─────────────────────── */}
        <Show when={firstActiveOp()}>
          {(op) => {
            const label = OP_LABEL[op().kind] ?? op().kind;
            const pct = op().progressPercent;
            const labelText = pct != null ? `${label}… ${pct}%` : `${label}…`;
            return (
              <div class={`instance-row__progress${pct == null ? ' instance-row__progress--indeterminate' : ''}`}>
                <div class="instance-row__progress-label">{labelText}</div>
                <div class="instance-row__progress-bar">
                  <div
                    class="instance-row__progress-fill"
                    style={pct != null ? { width: `${pct}%` } : {}}
                  />
                </div>
              </div>
            );
          }}
        </Show>
        <Show when={failedOp()}>
          {(op) => (
            <div class="instance-row__progress instance-row__progress--failed">
              <div class="instance-row__progress-label">
                Failed: {op().error ?? 'Unknown error'} — Try again
              </div>
            </div>
          )}
        </Show>
        <Show when={pendingAction() && !firstActiveOp()}>
          <div class="instance-row__progress instance-row__progress--indeterminate">
            <div class="instance-row__progress-label">
              {pendingAction() === 'starting' ? 'Starting…' : 'Stopping…'}
            </div>
            <div class="instance-row__progress-bar">
              <div class="instance-row__progress-fill" />
            </div>
          </div>
        </Show>
        <Show when={props.instance()?.status === 'Error' && props.instance()?.statusCondition && !expanded()}>
          <div class="instance-row__error-hint">
            {props.instance()!.statusCondition}
          </div>
        </Show>
      </div>

      <div class="instance-row__actions">
        <button
          class="btn btn--start"
          disabled={isStartDisabled(props.instance()?.status ?? 'Stopped') || locked() || pendingAction() === 'starting'}
          onClick={handleStart}
          title={locked() ? 'Operation in progress' : pendingAction() === 'starting' ? 'Starting…' : 'Start app'}
          aria-label={`Start ${props.instance()?.name}`}
        >
          Start
        </button>

        <button
          class="btn btn--stop"
          disabled={isStopDisabled(props.instance()?.status ?? 'Stopped') || locked() || pendingAction() === 'stopping'}
          onClick={handleStop}
          title={locked() ? 'Operation in progress' : pendingAction() === 'stopping' ? 'Stopping…' : 'Stop app'}
          aria-label={`Stop ${props.instance()?.name}`}
        >
          Stop
        </button>

        <Show when={hasBackupDisks()}>
          <div class="backup-picker" ref={pickerRef}>
            <button
              class="btn btn--backup"
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

        <Show when={openUrl() !== null}>
          <a
            class="btn--open"
            href={openUrl()!}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${props.instance()?.name} in browser`}
          >
            Open ↗
          </a>
        </Show>
      </div>

      {/* ── Expandable details + metrics panel ───────────────── */}
      <Show when={expanded()}>
        <div
          class="instance-row__details"
          role="region"
          aria-label={`Details for ${props.instance()?.name}`}
        >
          <dl class="instance-details">
            <div class="instance-details__item">
              <dt>Status</dt>
              <dd>{props.instance()?.status ?? '—'}</dd>
            </div>
            <div class="instance-details__item">
              <dt>Version</dt>
              <dd>{props.app()?.version ?? '—'}</dd>
            </div>
            <div class="instance-details__item">
              <dt>Engine</dt>
              <dd>{props.engine()?.hostname ?? '—'}</dd>
            </div>
            <div class="instance-details__item">
              <dt>Port</dt>
              <dd>{props.instance()?.port ?? '—'}</dd>
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

          <DockerMetricsPanel metrics={() => props.instance()?.metrics} />

          <div class="instance-row__trace-history">
            <div class="instance-row__trace-history-header">
              <span class="instance-row__trace-history-title">Last command</span>
              <Show when={instanceTraces().length > 1}>
                <button
                  class="instance-row__trace-show-all"
                  onClick={() => setShowAllTraces((v) => !v)}
                >
                  {showAllTraces() ? 'Show less' : `All (${instanceTraces().length})`}
                </button>
              </Show>
            </div>
            <Show
              when={visibleTraces().length > 0}
              fallback={
                <div class="instance-row__trace-no-logs">
                  {!props.commandLogStore
                    ? 'No log store'
                    : props.commandLogStore() === null
                    ? 'Loading…'
                    : props.commandLogStore() === false
                    ? '⚠️ Error loading logs'
                    : 'No commands logged yet'}
                </div>
              }
            >
              <For each={visibleTraces()}>
                {(trace) => (
                  <>
                    <div
                      class="instance-row__trace-row"
                      onClick={() => toggleTraceExpand(trace.traceId)}
                    >
                      <span class={`instance-row__trace-status instance-row__trace-status--${trace.status}`}>
                        {trace.status === 'running' ? '▶' : trace.status === 'ok' ? '✓' : '✗'}
                      </span>
                      <span class="instance-row__trace-cmd">{trace.command}</span>
                      <span class="instance-row__trace-chevron">
                        {expandedTraceIds().has(trace.traceId) ? '▲' : '▼'}
                      </span>
                    </div>
                    <Show when={expandedTraceIds().has(trace.traceId)}>
                      <div class="instance-row__trace-logs">
                        <Show
                          when={trace.logs.length > 0}
                          fallback={<div class="instance-row__trace-no-logs">No log output</div>}
                        >
                          <LogLines logs={trace.logs} />
                        </Show>
                      </div>
                    </Show>
                  </>
                )}
              </For>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default InstanceRow;
