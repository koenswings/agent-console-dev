/**
 * UsbStickRow — a read-only USB stick under its Engine in the network tree
 * (idea#193 §5). No actions except the existing Erase (via the unformatted
 * candidate view, when the Engine listed the stick there).
 */
import { Show, type Component } from 'solid-js';
import type { Engine, Store, UsbStickPublic } from '../types/store';
import { currentAppHostContext } from '../store/appUrl';
import {
  BUILDER_LINK_TEXT,
  STICK_TEAMS_LINE,
  builderUrl,
  stickBuilderState,
  stickRowLabel,
} from '../store/usbSticks';

interface UsbStickRowProps {
  engineId: string;
  engine: Engine;
  stick: UsbStickPublic;
  store: () => Store | null;
  /** Erase candidate id (same device in unformattedDisks); absent = Engine did not list it. */
  candidateId?: string;
  selected: boolean;
  onSelect?: () => void;
}

const UsbStickRow: Component<UsbStickRowProps> = (props) => {
  const state = () => stickBuilderState(props.store(), props.engineId, props.stick);
  const link = () => {
    const s = state();
    if (s.kind !== 'running') return null;
    const n = Object.keys(props.store()?.engineDB ?? {}).length;
    return builderUrl(props.engine, s.instance, currentAppHostContext(n));
  };
  const hint = () => {
    const s = state();
    return s.kind === 'no-builder' || s.kind === 'stopped' ? s.hint : null;
  };
  const select = () => props.onSelect?.();

  return (
    <div
      data-testid={`usb-stick-${props.stick.stickId}`}
      data-stick-id={props.stick.stickId}
      data-engine-id={props.engineId}
      data-candidate-id={props.candidateId}
      class={`tree-item tree-item--disk tree-item--usb-stick ${props.selected ? 'tree-item--selected' : ''}`}
      role="treeitem"
      tabIndex={0}
      aria-selected={props.selected}
      onClick={select}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          select();
        }
      }}
    >
      <span class="tree-item__icon" aria-hidden="true">🔌</span>
      <span class="tree-item__label">
        <span data-testid="usb-stick-label">{stickRowLabel(props.stick)}</span>
        <span class="tree-item__sub" data-testid="usb-stick-teachers">{STICK_TEAMS_LINE}</span>
        <Show when={link()}>
          {(href) => (
            <a
              class="tree-item__link"
              data-testid="usb-stick-builder-link"
              href={href()}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              {BUILDER_LINK_TEXT}
            </a>
          )}
        </Show>
        <Show when={hint()}>
          {(h) => (
            <span class="tree-item__hint" data-testid="usb-stick-hint" data-hint={state().kind}>
              {h()}
            </span>
          )}
        </Show>
      </span>
      <span class="tree-item__badge-readonly">read-only</span>
    </div>
  );
};

export default UsbStickRow;
