/**
 * Line icons from Tabler Icons v3.53.0 (outline set), MIT licence:
 * see ./LICENSE. Only the paths the Console uses are copied here, so the
 * icons are bundled with the app and work offline (no runtime dependency,
 * no CDN). Size and stroke width come from `.icon` in main.css.
 */
import { For, type Component } from 'solid-js';

export const ICON_PATHS = {
  'plug-connected': [
    'M7 12l5 5l-1.5 1.5a3.536 3.536 0 1 1 -5 -5l1.5 -1.5',
    'M17 12l-5 -5l1.5 -1.5a3.536 3.536 0 1 1 5 5l-1.5 1.5',
    'M3 21l2.5 -2.5',
    'M18.5 5.5l2.5 -2.5',
    'M10 11l-2 2',
    'M13 14l-2 2',
  ],
  'user': [
    'M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0',
    'M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2',
  ],
  'history': [
    'M12 8l0 4l2 2',
    'M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5',
  ],
  'settings': [
    'M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065',
    'M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0',
  ],
  'x': [
    'M18 6l-12 12',
    'M6 6l12 12',
  ],
  'package': [
    'M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5',
    'M12 12l8 -4.5',
    'M12 12l0 9',
    'M12 12l-8 -4.5',
    'M16 5.25l-8 4.5',
  ],
  'network': [
    'M6 9a6 6 0 1 0 12 0a6 6 0 0 0 -12 0',
    'M12 3c1.333 .333 2 2.333 2 6s-.667 5.667 -2 6',
    'M12 3c-1.333 .333 -2 2.333 -2 6s.667 5.667 2 6',
    'M6 9h12',
    'M3 20h7',
    'M14 20h7',
    'M10 20a2 2 0 1 0 4 0a2 2 0 0 0 -4 0',
    'M12 15v3',
  ],
  'bolt': [
    'M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11',
  ],
  'eye': [
    'M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0',
    'M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6',
  ],
  'eye-off': [
    'M10.585 10.587a2 2 0 0 0 2.829 2.828',
    'M16.681 16.673a8.717 8.717 0 0 1 -4.681 1.327c-3.6 0 -6.6 -2 -9 -6c1.272 -2.12 2.712 -3.678 4.32 -4.674m2.86 -1.146a9.055 9.055 0 0 1 1.82 -.18c3.6 0 6.6 2 9 6c-.666 1.11 -1.379 2.067 -2.138 2.87',
    'M3 3l18 18',
  ],
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof ICON_PATHS;

interface IconProps {
  name: IconName;
  class?: string;
}

/** Decorative line icon; the control around it carries the accessible name. */
const Icon: Component<IconProps> = (props) => (
  <svg
    class={props.class ? `icon ${props.class}` : 'icon'}
    data-icon={props.name}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <For each={ICON_PATHS[props.name]}>{(d) => <path d={d} />}</For>
  </svg>
);

export default Icon;
