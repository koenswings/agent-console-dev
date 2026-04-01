import type { Component } from 'solid-js';
import type { Instance, App } from '../types/store';

interface AppCardProps {
  instance: Instance;
  app: App | undefined;
  engineHostname: string;
}

const AppCard: Component<AppCardProps> = (props) => {
  const isRunning = () => props.instance.status === 'Running';

  const appUrl = () =>
    `http://${props.engineHostname}:${props.instance.port}`;

  const handleOpen = () => {
    if (!isRunning()) return;
    window.open(appUrl(), '_blank', 'noopener,noreferrer');
  };

  return (
    <div class={`app-card${isRunning() ? '' : ' app-card--unavailable'}`}>
      <div class="app-card__header">
        <span class="app-card__title">
          {props.app?.title ?? props.instance.name}
        </span>
        {props.app?.category && (
          <span class="app-card__category">{props.app.category}</span>
        )}
      </div>
      {props.app?.description && (
        <p class="app-card__description">{props.app.description}</p>
      )}
      <div class="app-card__footer">
        {isRunning() ? (
          <button class="app-card__open-btn" onClick={handleOpen}>
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
