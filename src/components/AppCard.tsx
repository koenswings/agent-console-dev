import { Show, type Component } from 'solid-js';
import type { Instance, App, Engine } from '../types/store';
import { appEngineOffline, engineDisplayName, offlineAppHint } from '../store/appUrl';

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
  /** The app's Engine is offline: Open is greyed out and not clickable. */
  const offline = () => appEngineOffline(props.engine?.());

  const handleOpen = () => {
    const url = props.appUrl();
    if (!isRunning() || !url || offline()) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      class={`app-card${isRunning() ? '' : ' app-card--unavailable'}${isRunning() && offline() ? ' app-card--offline' : ''}`}
      data-testid={`instance-${props.instance()?.id ?? ''}`}
      data-instance-id={props.instance()?.id}
      data-engine-id={props.engine?.()?.id}
      data-engine-hostname={engineName() || undefined}
      data-engine-lan={props.engine?.()?.lanAddress ?? ''}
    >
      <div class="app-card__header">
        <span class="app-card__title">
          {props.app()?.title ?? props.instance()?.name}
        </span>
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
            disabled={!props.appUrl() || offline()}
            title={offline() ? offlineAppHint(props.engine?.()?.hostname) : props.appUrl() ? undefined : 'No address or port known for this app yet'}
            onClick={handleOpen}
          >
            Open
          </button>
          <Show when={offline()}>
            <span class="app-offline-hint" data-testid={`app-offline-hint-${props.instance()?.id ?? ''}`}>
              {offlineAppHint(props.engine?.()?.hostname)}
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
