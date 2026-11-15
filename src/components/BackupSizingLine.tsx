import { Show, createMemo, type Component } from 'solid-js';
import { deriveBackupSizing } from '../store/backupSizing';
import type { Store } from '../types/store';

interface BackupSizingLineProps {
  store: () => Store | null;
  engineId: () => string | undefined;
}

/**
 * Small teacher-facing line: how much App data this Pi holds (engine#441).
 * Hidden only when the Engine is unknown.
 */
const BackupSizingLine: Component<BackupSizingLineProps> = (props) => {
  const sizing = createMemo(() => deriveBackupSizing(props.store(), props.engineId()));
  return (
    <Show when={sizing().text}>
      {(text) => (
        <p class="backup-sizing" data-testid="backup-sizing">
          {text()}
        </p>
      )}
    </Show>
  );
};

export default BackupSizingLine;
