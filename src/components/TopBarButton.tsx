/**
 * TopBarButton: one icon button on the right of the status bar (Connections,
 * Account, History, Settings). Shows a line icon plus a short visible label
 * (hidden on narrow screens), a tooltip with the full name on hover and
 * keyboard focus, and an aria-label. While its panel is open the icon turns
 * into a close (x) icon and the button reads "Close <name>".
 */
import type { Component } from 'solid-js';
import Icon, { type IconName } from '../icons/tabler';

interface TopBarButtonProps {
  /** Existing per-button class, e.g. `status-bar__settings-btn` (e2e selectors rely on it). */
  class: string;
  testId: string;
  icon: IconName;
  /** Short visible label, e.g. "History". */
  label: string;
  /** Full name for the tooltip and aria-label, e.g. "Command History". */
  name: string;
  open: boolean;
  onClick: () => void;
}

const TopBarButton: Component<TopBarButtonProps> = (props) => {
  const accessibleName = () => (props.open ? `Close ${props.name}` : props.name);
  return (
    <button
      type="button"
      class={`status-bar__icon-btn ${props.class}${props.open ? ' status-bar__icon-btn--open' : ''}`}
      data-testid={props.testId}
      aria-label={accessibleName()}
      aria-expanded={props.open}
      data-tooltip={accessibleName()}
      onClick={() => props.onClick()}
    >
      <Icon name={props.open ? 'x' : props.icon} />
      <span class="status-bar__btn-label" aria-hidden="true">{props.label}</span>
    </button>
  );
};

export default TopBarButton;
