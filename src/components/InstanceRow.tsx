import { Show, For, createSignal, createEffect, onCleanup, type Component } from 'solid-js';
import StatusDot from './StatusDot';
import { startInstance, stopInstance, backupApp } from '../store/commands';
import type { Instance, App, Engine, Disk, DockerMetrics } from '../types/store';
import type { Status } from '../types/store';

interface InstanceRowProps {
  instance:     () => Instance | undefined;
  app:          () => App | undefined;
  engine:       () => Engine | undefined;
  /** Backup disks docked on the same engine and linked to this instance. */
  backupDisks?: () => Disk[];
}

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
            No metrics — instance is not running.
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

  const handleStart = () => {
    const engine = props.engine();
    const inst = props.instance();
    const disk = inst?.storedOn;
    if (!engine || !inst || !disk) return;
    startInstance(engine.id, inst.name, disk);
  };

  const handleStop = () => {
    const engine = props.engine();
    const inst = props.instance();
    const disk = inst?.storedOn;
    if (!engine || !inst || !disk) return;
    stopInstance(engine.id, inst.name, disk);
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

  return (
    <div class="instance-row" role="listitem">
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
      </div>

      <div class="instance-row__actions">
        <button
          class="btn btn--start"
          disabled={isStartDisabled(props.instance()?.status ?? 'Stopped')}
          onClick={handleStart}
          title="Start instance"
          aria-label={`Start ${props.instance()?.name}`}
        >
          Start
        </button>

        <button
          class="btn btn--stop"
          disabled={isStopDisabled(props.instance()?.status ?? 'Stopped')}
          onClick={handleStop}
          title="Stop instance"
          aria-label={`Stop ${props.instance()?.name}`}
        >
          Stop
        </button>

        <Show when={hasBackupDisks()}>
          <div class="backup-picker" ref={pickerRef}>
            <button
              class="btn btn--backup"
              disabled={isBackupDisabled(props.instance()?.status ?? 'Stopped')}
              onClick={handleBackup}
              title={
                (props.backupDisks?.() ?? []).length === 1
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
            <Show when={props.app()?.description}>
              <div class="instance-details__item instance-details__item--full">
                <dt>Description</dt>
                <dd>{props.app()!.description}</dd>
              </div>
            </Show>
          </dl>

          <DockerMetricsPanel metrics={() => props.instance()?.metrics} />
        </div>
      </Show>
    </div>
  );
};

export default InstanceRow;
