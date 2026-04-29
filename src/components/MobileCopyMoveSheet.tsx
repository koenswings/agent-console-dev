/**
 * MobileCopyMoveSheet
 *
 * Bottom sheet that lets the user copy or move an instance to a different disk.
 * Shown when the ⋯ menu on a mobile app card is tapped.
 */
import { For, Show, createSignal, type Component } from 'solid-js';
import { copyApp, moveApp } from '../store/commands';
import type { Store, Instance, Disk } from '../types/store';

interface TargetDisk {
  disk: Disk;
  engineHostname: string;
}

interface MobileCopyMoveSheetProps {
  instance: Instance;
  store: () => Store | null;
  onClose: () => void;
}

const MobileCopyMoveSheet: Component<MobileCopyMoveSheetProps> = (props) => {
  const [selectedDiskId, setSelectedDiskId] = createSignal<string | null>(null);
  const [op, setOp] = createSignal<'copy' | 'move' | null>(null);

  /** App disks on any engine, excluding the disk the instance currently lives on. */
  const targetDisks = (): TargetDisk[] => {
    const s = props.store();
    if (!s) return [];
    return Object.values(s.diskDB)
      .filter(
        (d) =>
          d.device !== null &&
          (d.diskTypes ?? []).includes('app') &&
          d.id !== props.instance.storedOn
      )
      .map((d) => ({
        disk: d,
        engineHostname: d.dockedTo
          ? (s.engineDB[String(d.dockedTo)]?.hostname ?? String(d.dockedTo))
          : '?',
      }))
      .sort((a, b) => a.engineHostname.localeCompare(b.engineHostname));
  };

  const sourceDisk = (): Disk | undefined => {
    const s = props.store();
    if (!s || !props.instance.storedOn) return undefined;
    return s.diskDB[props.instance.storedOn];
  };

  const sourceEngineId = (): string | undefined => {
    const d = sourceDisk();
    return d?.dockedTo ? String(d.dockedTo) : undefined;
  };

  const handleConfirm = () => {
    const diskId = selectedDiskId();
    const operation = op();
    const engineId = sourceEngineId();
    const src = sourceDisk();
    if (!diskId || !operation || !engineId || !src) return;

    if (operation === 'copy') {
      copyApp(engineId, props.instance.name, String(src.id), diskId);
    } else {
      moveApp(engineId, props.instance.name, String(src.id), diskId);
    }
    props.onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div class="mobile-sheet-backdrop" onClick={props.onClose} />

      {/* Sheet */}
      <div class="mobile-sheet" role="dialog" aria-modal="true" aria-label="Copy or Move">
        <div class="mobile-sheet__handle" />
        <div class="mobile-sheet__title">
          Move or copy <strong>{props.instance.name}</strong>
        </div>
        <div class="mobile-sheet__subtitle">
          Currently on <em>{sourceDisk()?.name ?? '—'}</em>
        </div>

        {/* Op selector */}
        <div class="mobile-sheet__op-row">
          <button
            class={`mobile-sheet__op-btn${op() === 'move' ? ' mobile-sheet__op-btn--active' : ''}`}
            onClick={() => setOp('move')}
          >
            ✂️ Move
          </button>
          <button
            class={`mobile-sheet__op-btn${op() === 'copy' ? ' mobile-sheet__op-btn--active' : ''}`}
            onClick={() => setOp('copy')}
          >
            📋 Copy
          </button>
        </div>

        {/* Target disk list */}
        <div class="mobile-sheet__section-label">Target disk</div>
        <Show
          when={targetDisks().length > 0}
          fallback={<div class="mobile-sheet__empty">No other app disks available</div>}
        >
          <div class="mobile-sheet__disk-list">
            <For each={targetDisks()}>
              {({ disk, engineHostname }) => (
                <button
                  class={`mobile-sheet__disk-row${selectedDiskId() === String(disk.id) ? ' mobile-sheet__disk-row--selected' : ''}`}
                  onClick={() => setSelectedDiskId(String(disk.id))}
                >
                  <span class="mobile-sheet__disk-name">{disk.name}</span>
                  <span class="mobile-sheet__disk-engine">{engineHostname}</span>
                  <Show when={selectedDiskId() === String(disk.id)}>
                    <span class="mobile-sheet__check">✓</span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Show>

        {/* Confirm button */}
        <button
          class="btn btn--primary mobile-sheet__confirm"
          disabled={!selectedDiskId() || !op()}
          onClick={handleConfirm}
        >
          {op() === 'move' ? 'Move' : op() === 'copy' ? 'Copy' : 'Select an action'}
          <Show when={selectedDiskId() && op()}>
            {' '}to {targetDisks().find((t) => String(t.disk.id) === selectedDiskId())?.disk.name}
          </Show>
        </button>

        <button class="mobile-sheet__cancel" onClick={props.onClose}>Cancel</button>
      </div>
    </>
  );
};

export default MobileCopyMoveSheet;
