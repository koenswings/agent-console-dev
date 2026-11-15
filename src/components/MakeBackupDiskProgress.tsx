/**
 * In-panel progress for a makeBackupDisk Operation (idea#404, engine#355).
 * Engine step tokens (Check, Erase, Re-dock, Create) are mapped to plain
 * Console labels. On an adopted IDEA disk the Engine skips Erase and Re-dock,
 * so only Check and Create are shown.
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
  /** Adopted IDEA disk (sent without a typed confirm): Erase and Re-dock are skipped. */
  adopted?: boolean;
}

const MakeBackupDiskProgress: Component<MakeBackupDiskProgressProps> = (props) => {
  const adopted = () => props.adopted === true;
  const view = () => makeBackupDiskProgress(props.op(), adopted());
  const steps = () => makeBackupDiskStepsFor(adopted());
  const ids = () => steps().map((s) => s.id);
  const indexOf = (id: string) => steps().findIndex((s) => s.id === id);
  return (
    <div class="make-backup-progress" role="status" data-testid="make-backup-disk-progress">
      <p class="erase-dialog__progress" data-make-backup-step={view().currentId}>
        {view().label}
        <Show when={view().percent != null}>
          {' '}({view().percent}%)
        </Show>
      </p>
      <Show when={props.waiting && !props.op()}>
        <p class="edp-form__hint" data-testid="make-backup-disk-pending">Waiting for the Engine…</p>
      </Show>
      <ol class="erase-dialog__steps">
        <For each={ids()}>
          {(id) => (
            <li
              data-step={id}
              classList={{
                'erase-dialog__step--current': view().currentId === id,
                'erase-dialog__step--done': indexOf(view().currentId) > indexOf(id),
              }}
            >
              {steps().find((s) => s.id === id)?.label}
            </li>
          )}
        </For>
      </ol>
    </div>
  );
};

export default MakeBackupDiskProgress;
