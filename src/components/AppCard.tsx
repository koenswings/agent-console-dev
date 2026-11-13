import { Show, type Component } from 'solid-js';
import type { Instance, App, Engine } from '../types/store';
import { appEngineStatus, connectingAppHint, engineDisplayName, offlineAppHint } from '../store/appUrl';
import { instanceCardTitle } from '../store/instanceTitle';

interface AppCardProps {
  instance: () => Instance | undefined;
  app: () => App | undefined;
  /** Open link from `buildAppUrl` (appUrl.ts); null = no usable host/port → disabled. */
  appUrl: () => string | null;
  /** Engine the instance's disk is docked to: shown as "on <name>" (several Engines look alike). */
  engine?: () => Engine | undefined;
}

const AppCard: Component<AppCardProps> = (props) => {
  const isRunning = () => props.instance()?.status === 'Running';
  const engineName = () => engineDisplayName(props.engine?.()?.hostname);
  const cardTitle = () => instanceCardTitle(props.instance(), props.app());
  /** Engine liveness when an Engine record is known; no record → no offline/connecting chrome. */
  const status = () => {
    const e = props.engine?.();
    return e ? appEngineStatus(e) : null;
  };
  const offline = () => status() === 'offline';
  const connecting = () => status() === 'connecting';
  const notOpenable = () => offline() || connecting();

  const handleOpen = () => {
    const url = props.appUrl();
    if (!isRunning() || !url || notOpenable()) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const cardClass = () => {
    const extra = !isRunning() ? ' app-card--unavailable' : offline() ? ' app-card--offline' : connecting() ? ' app-card--connecting' : '';
    return `app-card${extra}`;
  };

  return (
    <div
      class={cardClass()}
      data-testid={`instance-${props.instance()?.id ?? ''}`}
      data-instance-id={props.instance()?.id}
      data-engine-id={props.engine?.()?.id}
      data-engine-hostname={engineName() || undefined}
      data-engine-lan={props.engine?.()?.lanAddress ?? ''}
    >
      <div class="app-card__header">
        <div class="app-card__titles">
          <span class="app-card__title">{cardTitle().title}</span>
          <Show when={cardTitle().subtitle}>
            <span class="app-card__subtitle">{cardTitle().subtitle}</span>
          </Show>
        </div>
        {props.app()?.category && (
          <span class="app-card__category">{props.app()!.category}</span>
        )}
      </div>
      <Show when={engineName()}>
        <span class="app-card__engine" data-testid={`app-engine-${props.instance()?.id ?? ''}`}>
          on {engineName()}
        </span>
      </Show>
      {props.app()?.description && (
        <p class="app-card__description">{props.app()!.description}</p>
      )}
      <div class="app-card__footer">
        {isRunning() ? (
          <>
          <button
            class="app-card__open-btn"
            data-testid={`open-instance-${props.instance()?.id ?? ''}`}
            data-href={props.appUrl() ?? undefined}
            disabled={!props.appUrl() || notOpenable()}
            title={offline() ? offlineAppHint(props.engine?.()?.hostname) : connecting() ? connectingAppHint(props.engine?.()?.hostname) : props.appUrl() ? undefined : 'No address or port known for this app yet'}
            onClick={handleOpen}
          >
            Open
          </button>
          <Show when={offline()}>
            <span class="app-offline-hint" data-testid={`app-offline-hint-${props.instance()?.id ?? ''}`}>
              {offlineAppHint(props.engine?.()?.hostname)}
            </span>
          </Show>
          <Show when={connecting()}>
            <span class="app-connecting-hint" data-testid={`app-connecting-hint-${props.instance()?.id ?? ''}`}>
              {connectingAppHint(props.engine?.()?.hostname)}
            </span>
          </Show>
          </>
        ) : (
          <span class="app-card__unavailable-label">Not available</span>
        )}
      </div>
    </div>
  );
};

export default AppCard;
