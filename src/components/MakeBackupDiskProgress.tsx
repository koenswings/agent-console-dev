/**
 * In-panel progress for a makeBackupDisk Operation (idea#404).
 * Engine step tokens (Check, Erase, Re-dock, Create) are mapped to plain
 * Console labels. Erase is omitted when the stick is already an empty IDEA disk.
 */
import { For, Show, type Component } from 'solid-js';
import {
  makeBackupDiskProgress,
  makeBackupDiskStepsFor,
} from '../store/makeBackupDisk';
import type { Operation } from '../types/store';

interface MakeBackupDiskProgressProps {
  op: () => Operation | null | undefined;
  /** True while we are waiting for the first Operation or trace. */
  waiting?: boolean;
  /** Adopted empty IDEA disk: skip the Erase step. */
  skipErase?: boolean;
}

const MakeBackupDiskProgress: Component<MakeBackupDiskProgressProps> = (props) => {
  const skip = () => props.skipErase === true;
  const view = () => makeBackupDiskProgress(props.op(), skip());
  const steps = () => makeBackupDiskStepsFor(skip());
  const ids = () => steps().map((s) => s.id);
  return (
    <div class="make-backup-progress" role="status" data-testid="make-backup-disk-progress">
      <Show when={view().label}>
        <p class="erase-dialog__progress" data-make-backup-step={view().currentId ?? ''}>
          {view().label}
          <Show when={view().percent != null}>
            {' '}({view().percent}%)
          </Show>
        </p>
      </Show>
      <Show when={props.waiting && !props.op()}>
        <p class="edp-form__hint" data-testid="make-backup-disk-pending">Waiting for the Engine…</p>
      </Show>
      <ol class="erase-dialog__steps">
        <For each={ids()}>
          {(id) => {
            const step = () => steps().find((s) => s.id === id)!;
            const current = () => view().currentId;
            const idx = () => steps().findIndex((s) => s.id === id);
            const curIdx = () => steps().findIndex((s) => s.id === current());
            return (
              <li
                data-step={id}
                classList={{
                  'erase-dialog__step--current': current() === id,
                  'erase-dialog__step--done': curIdx() > idx(),
                }}
              >
                {step().label}
              </li>
            );
          }}
        </For>
      </ol>
    </div>
  );
};

export default MakeBackupDiskProgress;
