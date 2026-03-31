import { Show, type Component } from 'solid-js';
import StatusDot from './StatusDot';
import { startInstance, stopInstance } from '../store/commands';
import type { Instance, App, Engine } from '../types/store';
import type { Status } from '../types/store';

interface InstanceRowProps {
  instance: Instance;
  app: App | undefined;
  /** Engine the instance runs on — needed to route commands and build the open URL. */
  engine: Engine | undefined;
}

/** Returns true when the Start button should be disabled. */
export const isStartDisabled = (status: Status): boolean =>
  status === 'Running' || status === 'Starting';

/** Returns true when the Stop button should be disabled. */
export const isStopDisabled = (status: Status): boolean =>
  status === 'Stopped' || status === 'Docked' || status === 'Undocked';

const InstanceRow: Component<InstanceRowProps> = (props) => {
  const handleStart = () => {
    const engine = props.engine;
    const disk = props.instance.storedOn;
    if (!engine || !disk) return;
    startInstance(engine.id, props.instance.name, disk);
  };

  const handleStop = () => {
    const engine = props.engine;
    const disk = props.instance.storedOn;
    if (!engine || !disk) return;
    stopInstance(engine.id, props.instance.name, disk);
  };

  const openUrl = () => {
    if (props.instance.status !== 'Running' || !props.engine) return null;
    const hostname = props.engine.hostname;
    const port = props.instance.port;
    if (!port) return null;
    return `http://${hostname}.local:${port}`;
  };

  return (
    <div class="instance-row" role="listitem">
      <StatusDot status={props.instance.status} />

      <div class="instance-row__info">
        <div class="instance-row__name">{props.instance.name}</div>
        <div class="instance-row__app">
          {props.app ? props.app.title : props.instance.instanceOf}
        </div>
      </div>

      <div class="instance-row__actions">
        <button
          class="btn btn--start"
          disabled={isStartDisabled(props.instance.status)}
          onClick={handleStart}
          title="Start instance"
          aria-label={`Start ${props.instance.name}`}
        >
          Start
        </button>

        <button
          class="btn btn--stop"
          disabled={isStopDisabled(props.instance.status)}
          onClick={handleStop}
          title="Stop instance"
          aria-label={`Stop ${props.instance.name}`}
        >
          Stop
        </button>

        <Show when={openUrl() !== null}>
          <a
            class="btn--open"
            href={openUrl()!}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${props.instance.name} in browser`}
          >
            Open ↗
          </a>
        </Show>
      </div>
    </div>
  );
};

export default InstanceRow;
