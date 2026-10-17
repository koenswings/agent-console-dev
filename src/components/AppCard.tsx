import type { Component } from 'solid-js';
import type { Instance, App } from '../types/store';

interface AppCardProps {
  instance: () => Instance | undefined;
  app: () => App | undefined;
  /** Open link from `buildAppUrl` (appUrl.ts); null = no usable host/port → disabled. */
  appUrl: () => string | null;
}

const AppCard: Component<AppCardProps> = (props) => {
  const isRunning = () => props.instance()?.status === 'Running';

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
    >
      <div class="app-card__header">
        <span class="app-card__title">
          {props.app()?.title ?? props.instance()?.name}
        </span>
        {props.app()?.category && (
          <span class="app-card__category">{props.app()!.category}</span>
        )}
      </div>
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
