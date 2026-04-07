/**
 * EnginePickerPanel — shown inside the onboarding card when 2+ engines are found.
 *
 * Lists each discovered engine as a row with hostname and a Connect button.
 * Calls onSelect when the operator picks one.
 */
import { For, type Component } from 'solid-js';
import type { DiscoveryResult } from '../store/discovery';

interface EnginePickerPanelProps {
  results: DiscoveryResult[];
  onSelect: (result: DiscoveryResult) => void;
  onManual: () => void;
}

const EnginePickerPanel: Component<EnginePickerPanelProps> = (props) => {
  return (
    <div class="engine-picker">
      <p class="engine-picker__lead">
        Multiple engines found on this network. Select one to connect.
      </p>
      <ul class="engine-picker__list">
        <For each={props.results}>
          {(result) => (
            <li class="engine-picker__item">
              <span class="engine-picker__hostname">{result.hostname}</span>
              <button
                class="engine-picker__connect-btn"
                onClick={() => props.onSelect(result)}
              >
                Connect
              </button>
            </li>
          )}
        </For>
      </ul>
      <button class="engine-picker__manual-btn" onClick={props.onManual}>
        Enter hostname manually
      </button>
    </div>
  );
};

export default EnginePickerPanel;
