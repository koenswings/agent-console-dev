/**
 * PasswordToggle: the show / hide button next to a password input. Tabler
 * eye (password hidden, press to show) or eye-off (password shown, press to
 * hide), with a matching aria-label and tooltip.
 */
import type { Component } from 'solid-js';
import Icon from '../icons/tabler';

interface PasswordToggleProps {
  shown: boolean;
  onToggle: () => void;
}

const PasswordToggle: Component<PasswordToggleProps> = (props) => {
  const label = () => (props.shown ? 'Hide password' : 'Show password');
  return (
    <button
      type="button"
      class="form-field__show-pw"
      data-testid="password-toggle"
      aria-label={label()}
      aria-pressed={props.shown}
      data-tooltip={label()}
      onClick={() => props.onToggle()}
    >
      <Icon name={props.shown ? 'eye-off' : 'eye'} />
    </button>
  );
};

export default PasswordToggle;
