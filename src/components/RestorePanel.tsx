import { For, Show, createMemo, createSignal, type Accessor, type Component } from 'solid-js';
import { restoreApp } from '../store/commands';
import { createCommandResult, type CommandResult } from '../store/commandResult';
import type { CommandLogState } from '../store/commandLog';
import { isInstanceLocked } from '../store/operations';
import CommandFeedback from './CommandFeedback';
import { confirmNewOperation, remoteWatchFor } from '../store/remoteConfirm';
import type { Disk, Instance, Store } from '../types/store';

interface RestorePanelProps {
  disk: () => Disk | undefined;
  store: () => Store | null;
  /** Engine ID that owns this disk */
  engineId: () => string | undefined;
  /** Header text override (the disk view shows this panel as its "Backups" section). */
  title?: string;
  /** The Engine's command log: a refused or failed restoreApp is shown on its row. */
  commandLogStore?: Accessor<CommandLogState>;
}

const BACKUP_MODE_LABELS: Record<string, string> = {
  immediate: 'Immediate',
  'on-demand': 'On demand',
  scheduled: 'Scheduled',
};

const RestorePanel: Component<RestorePanelProps> = (props) => {
  // Per-instance target disk selections: instanceId → targetDiskId
  const [targetSelections, setTargetSelections] = createSignal<Record<string, string>>({});
  // Which instance is in the confirmation step
  const [confirmingId, setConfirmingId] = createSignal<string | null>(null);

  const backupConfig = () => props.disk()?.backupConfig ?? null;

  const linkedInstances = createMemo((): Instance[] => {
    const s = props.store();
    const cfg = backupConfig();
    if (!s || !cfg) return [];
    return cfg.links
      .map((id) => s.instanceDB[id])
      .filter((inst): inst is Instance => inst !== undefined);
  });

  const targetDisks = createMemo((): Disk[] => {
    const s = props.store();
    const disk = props.disk();
    if (!s) return [];
    return Object.values(s.diskDB).filter(
      (d) =>
        d.device !== null &&
        d.id !== disk?.id &&
        (d.diskTypes.includes('app') || d.diskTypes.includes('empty'))
    );
  });

  const formatLastBackup = (ts: number | null): string => {
    if (!ts) return 'Never backed up';
    return `Last backup: ${new Date(ts).toLocaleString()}`;
  };

  const setTarget = (instanceId: string, diskId: string) => {
    setTargetSelections((prev) => ({ ...prev, [instanceId]: diskId }));
    setConfirmingId(null); // reset confirmation if target changes
  };

  const handleRestoreClick = (instanceId: string) => {
    setConfirmingId(instanceId);
  };

  const handleConfirm = (inst: Instance, result: CommandResult) => {
    const engineId = props.engineId();
    const s = props.store();
    const targetDiskId = targetSelections()[inst.id];
    if (!engineId || !targetDiskId || !s) return;
    const targetDisk = s.diskDB[targetDiskId];
    if (!targetDisk) return;
    // Instance and disk by ID (names may contain spaces; two instances can
    // share a name). The Engine's answer (e.g. "Too many arguments", "Target
    // disk … not found") is shown on this row by CommandFeedback — never
    // silent. On another Engine: "Sent to …" until the restore op is Done.
    result.start(inst.id, () => restoreApp(engineId, inst.id, targetDisk.id), {
      engineId,
      remote: remoteWatchFor(props.store, engineId, 'restoreApp', confirmNewOperation(props.store, 'restoreApp', inst.id)),
    });
    setConfirmingId(null);
    // Clear the target selection so the button re-disables
    setTargetSelections((prev) => {
      const next = { ...prev };
      delete next[inst.id];
      return next;
    });
  };

  const handleCancel = () => {
    setConfirmingId(null);
  };

  return (
    <section class="restore-panel" aria-label="Backup disk restore" data-testid="restore-panel">
      <header class="restore-panel__header">
        <span class="restore-panel__disk-icon">🗄</span>
        <div>
          <div class="restore-panel__title">{props.title ?? props.disk()?.name ?? 'Backup disk'}</div>
          <div class="restore-panel__subtitle">
            <span class="restore-panel__badge">Backup Disk</span>
            <Show when={backupConfig()}>
              <span class="restore-panel__mode">
                {BACKUP_MODE_LABELS[backupConfig()!.mode] ?? backupConfig()!.mode}
              </span>
            </Show>
          </div>
        </div>
      </header>

      {/* No backup configuration */}
      <Show when={!backupConfig()}>
        <p class="restore-panel__empty">This disk has no backup configuration.</p>
      </Show>

      {/* Instance list */}
      <Show when={backupConfig()}>
        <Show
          when={linkedInstances().length > 0}
          fallback={
            <p class="restore-panel__empty">No instances backed up to this disk yet.</p>
          }
        >
          <div class="restore-panel__instance-list">
            <For each={linkedInstances()}>
              {(inst) => {
                const locked = () => isInstanceLocked(props.store(), inst.id);
                const selectedDiskId = () => targetSelections()[inst.id] ?? '';
                const isConfirming = () => confirmingId() === inst.id;
                const result = createCommandResult({
                  commandLog: () => props.commandLogStore?.() ?? null,
                  command: 'restoreApp',
                  argKey: 'instanceName',
                  longRunning: true,
                });

                const selectedDiskName = () => {
                  const s = props.store();
                  const id = selectedDiskId();
                  return id && s ? (s.diskDB[id]?.name ?? id) : '';
                };

                return (
                  <div class="restore-panel__instance-row" data-testid={`restore-instance-${inst.id}`}>
                    <div class="restore-panel__instance-info">
                      <span class="restore-panel__instance-name">{inst.name}</span>
                      <span class="restore-panel__instance-backup">
                        {formatLastBackup(inst.lastBackup)}
                      </span>
                    </div>

                    {/* Target disk selector */}
                    <Show when={targetDisks().length > 0} fallback={
                      <p class="restore-panel__empty">No available target disks.</p>
                    }>
                      <select
                        class="restore-panel__target-select"
                        data-testid={`restore-target-${inst.id}`}
                        value={selectedDiskId()}
                        disabled={locked() || isConfirming()}
                        onChange={(e) => setTarget(inst.id, e.currentTarget.value)}
                      >
                        <option value="">Select target disk…</option>
                        <For each={targetDisks()}>
                          {(d) => (
                            <option value={d.id}>{d.name}</option>
                          )}
                        </For>
                      </select>
                    </Show>

                    {/* Restore button — disabled until target selected */}
                    <Show when={!isConfirming()}>
                      <button
                        class="btn"
                        data-testid={`restore-btn-${inst.id}`}
                        disabled={locked() || !selectedDiskId()}
                        onClick={() => handleRestoreClick(inst.id)}
                      >
                        {locked() ? 'Operation in progress' : 'Restore'}
                      </button>
                    </Show>

                    {/* Inline confirmation */}
                    <Show when={isConfirming()}>
                      <div class="restore-panel__confirm">
                        <p class="restore-panel__confirm-text">
                          Are you sure? This will overwrite <strong>{inst.name}</strong> on <strong>{selectedDiskName()}</strong>.
                        </p>
                        <div class="restore-panel__confirm-actions">
                          <button class="btn" data-testid={`restore-cancel-${inst.id}`} onClick={handleCancel}>Cancel</button>
                          <button class="btn btn--danger" data-testid={`restore-confirm-${inst.id}`} onClick={() => handleConfirm(inst, result)}>
                            Confirm Restore
                          </button>
                        </div>
                      </div>
                    </Show>

                    <CommandFeedback
                      result={result}
                      subject={() => inst.name}
                      testId={`restore-feedback-${inst.id}`}
                    />
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </Show>
    </section>
  );
};

export default RestorePanel;
