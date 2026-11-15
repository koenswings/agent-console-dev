import { For, createMemo, type Component } from 'solid-js';
import type { BackupStatusLine } from '../store/backupStatus';

interface BackupStatusLinesProps {
  lines: () => BackupStatusLine[];
  /** Prefix for data-testid, e.g. "restore-status" or "instance-backup-status". */
  testId?: string;
}

/**
 * Renders §5 Backup Disk status lines. The parent decides whether to show
 * this (capability flag). ID-keyed <For>.
 */
const BackupStatusLines: Component<BackupStatusLinesProps> = (props) => {
  const testId = () => props.testId ?? 'backup-status';
  const ids = createMemo(() => props.lines().map((l) => l.id));
  return (
    <ul
      class="backup-status"
      data-testid={testId()}
      aria-label="Backup status"
    >
      <For each={ids()}>
        {(id) => {
          const line = () => props.lines().find((l) => l.id === id);
          return (
            <li
              class={`backup-status__line backup-status__line--${line()?.tone ?? 'neutral'}`}
              data-testid={`${testId()}-${id}`}
              data-tone={line()?.tone}
            >
              {line()?.text}
            </li>
          );
        }}
      </For>
    </ul>
  );
};

export default BackupStatusLines;
