import { Show, type Component } from 'solid-js';
import type { Instance, App, Engine } from '../types/store';
import { engineDisplayName } from '../store/appUrl';

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

  const handleOpen = () => {
    const url = props.appUrl();
    if (!isRunning() || !url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      class={`app-card${isRunning() ? '' : ' app-card--unavailable'}`}
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
          <button
            class="app-card__open-btn"
            data-testid={`open-instance-${props.instance()?.id ?? ''}`}
            data-href={props.appUrl() ?? undefined}
            disabled={!props.appUrl()}
            title={props.appUrl() ? undefined : 'No address or port known for this app yet'}
            onClick={handleOpen}
          >
            Open
          </button>
        ) : (
          <span class="app-card__unavailable-label">Not available</span>
        )}
      </div>
    </div>
  );
};

export default AppCard;
