import { Show, type Component } from 'solid-js';
import StatusDot from './StatusDot';
import { startInstance, stopInstance, backupApp } from '../store/commands';
import type { Instance, App, Engine, Disk } from '../types/store';
import type { Status } from '../types/store';

interface InstanceRowProps {
  instance:    () => Instance | undefined;
  app:         () => App | undefined;
  engine:      () => Engine | undefined;
  /** Backup disk docked on the same engine and linked to this instance, if any. */
  backupDisk?: () => Disk | undefined;
}

/** Format a lastBackedUp timestamp for display. */
export const formatLastBackup = (ts: number | null | undefined): string => {
  if (ts == null || ts === 0) return 'Never';
  const date = new Date(ts);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** Returns true when the Start button should be disabled. */
export const isStartDisabled = (status: Status): boolean =>
  status === 'Running' || status === 'Starting';

/** Returns true when the Backup button should be disabled. */
export const isBackupDisabled = (status: Status): boolean =>
  status !== 'Running';

/** Returns true when the Stop button should be disabled. */
export const isStopDisabled = (status: Status): boolean =>
  status === 'Stopped' || status === 'Docked' || status === 'Undocked';

const InstanceRow: Component<InstanceRowProps> = (props) => {
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
    const engine = props.engine();
    const bd = props.backupDisk?.();
    if (!engine || !bd) return;
    const inst = props.instance();
    if (!inst) return;
    backupApp(engine.id, inst.name, bd.name);
  };

  const openUrl = () => {
    const inst = props.instance();
    const eng = props.engine();
    if (!inst || inst.status !== 'Running' || !eng) return null;
    const port = inst.port;
    if (!port) return null;
    return `http://${eng.hostname}.local:${port}`;
  };

  const hasBackupDisk = () => props.backupDisk?.() !== undefined;

  return (
    <div class="instance-row" role="listitem">
      <StatusDot status={props.instance()?.status ?? 'Stopped'} />

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

        <Show when={hasBackupDisk()}>
          <button
            class="btn btn--backup"
            disabled={isBackupDisabled(props.instance()?.status ?? 'Stopped')}
            onClick={handleBackup}
            title={`Back up to ${props.backupDisk?.()?.name}`}
            aria-label={`Back up ${props.instance()?.name}`}
          >
            Back up
          </button>
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

      <Show when={hasBackupDisk()}>
        <div class="instance-row__backup-info">
          Last backup: {formatLastBackup(props.instance()?.lastBackedUp)}
        </div>
      </Show>
    </div>
  );
};

export default InstanceRow;
