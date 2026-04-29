/**
 * MobileCopyMoveSheet
 *
 * Bottom sheet for the ⋯ menu on a mobile app card.
 * Supports Move, Copy (to another app disk) and Back up (to a backup disk).
 */
import { For, Show, createSignal, createMemo, type Component } from 'solid-js';
import { copyApp, moveApp } from '../store/commands';
import type { Store, Instance, Disk } from '../types/store';

type Op = 'copy' | 'move';

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
  const [op, setOp] = createSignal<Op | null>(null);

  const sourceDisk = (): Disk | undefined => {
    const s = props.store();
    if (!s || !props.instance.storedOn) return undefined;
    return s.diskDB[props.instance.storedOn];
  };

  const sourceEngineId = (): string | undefined => {
    const d = sourceDisk();
    return d?.dockedTo ? String(d.dockedTo) : undefined;
  };

  const diskLabel = (d: Disk, s: Store): string =>
    d.dockedTo ? (s.engineDB[String(d.dockedTo)]?.hostname ?? String(d.dockedTo)) : '?';

  /** App disks on any engine, excluding the current disk — for copy/move */
  const appDisks = createMemo((): TargetDisk[] => {
    const s = props.store();
    if (!s) return [];
    return Object.values(s.diskDB)
      .filter(
        (d) =>
          d.device !== null &&
          (d.diskTypes ?? []).includes('app') &&
          String(d.id) !== String(props.instance.storedOn)
      )
      .map((d) => ({ disk: d, engineHostname: diskLabel(d, s) }))
      .sort((a, b) => a.engineHostname.localeCompare(b.engineHostname));
  });

  const targetDisks = createMemo((): TargetDisk[] => appDisks());

  const selectOp = (next: Op) => {
    setOp(next);
    setSelectedDiskId(null); // reset disk when switching op
  };

  const handleConfirm = () => {
    const diskId = selectedDiskId();
    const operation = op();
    const engineId = sourceEngineId();
    const src = sourceDisk();
    if (!diskId || !operation || !engineId) return;

    if (!src) return;
    if (operation === 'copy') {
      copyApp(engineId, props.instance.name, String(src.id), diskId);
    } else if (operation === 'move') {
      moveApp(engineId, props.instance.name, String(src.id), diskId);
    }
    props.onClose();
  };

  const confirmLabel = (): string => {
    const diskName = targetDisks().find((t) => String(t.disk.id) === selectedDiskId())?.disk.name;
    if (!op()) return 'Select an action';
    if (!diskName) return op() === 'move' ? 'Move' : 'Copy';
    return op() === 'move' ? `Move to ${diskName}` : `Copy to ${diskName}`;
  };

  const isReady = () => !!selectedDiskId() && !!op();

  return (
    <>
      {/* Backdrop */}
      <div class="mobile-sheet-backdrop" onClick={props.onClose} />

      {/* Sheet */}
      <div class="mobile-sheet" role="dialog" aria-modal="true" aria-label="App actions">
        <div class="mobile-sheet__handle" />
        <div class="mobile-sheet__title">
          <strong>{props.instance.name}</strong>
        </div>
        <div class="mobile-sheet__subtitle">
          On <em>{sourceDisk()?.name ?? '—'}</em>
        </div>

        {/* Op selector */}
        <div class="mobile-sheet__op-row">
          <button
            class={`mobile-sheet__op-btn${op() === 'move' ? ' mobile-sheet__op-btn--active' : ''}`}
            onClick={() => selectOp('move')}
          >
            ✂️ Move
          </button>
          <button
            class={`mobile-sheet__op-btn${op() === 'copy' ? ' mobile-sheet__op-btn--active' : ''}`}
            onClick={() => selectOp('copy')}
          >
            📋 Copy
          </button>
        </div>

        {/* Target disk list — only shown once an op is selected */}
        <Show when={op()}>
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
        </Show>

        {/* Confirm button */}
        <button
          class="btn btn--primary mobile-sheet__confirm"
          disabled={!isReady()}
          onClick={handleConfirm}
        >
          {confirmLabel()}
        </button>

        <button class="mobile-sheet__cancel" onClick={props.onClose}>Cancel</button>
      </div>
    </>
  );
};

export default MobileCopyMoveSheet;
