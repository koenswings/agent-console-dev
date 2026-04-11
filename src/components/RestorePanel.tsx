import { For, Show, createMemo, createSignal, type Component } from 'solid-js';
import { restoreApp } from '../store/commands';
import { isInstanceLocked } from '../store/operations';
import type { Disk, Instance, Store } from '../types/store';

interface RestorePanelProps {
  disk: () => Disk | undefined;
  store: () => Store | null;
  /** Engine ID that owns this disk */
  engineId: () => string | undefined;
}

const BACKUP_MODE_LABELS: Record<string, string> = {
  immediate: 'Immediate',
  'on-demand': 'On demand',
  scheduled: 'Scheduled',
};

const RestorePanel: Component<RestorePanelProps> = (props) => {
  const [activeInstanceId, setActiveInstanceId] = createSignal<string | null>(null);
  const [selectedTargetDiskId, setSelectedTargetDiskId] = createSignal<string | null>(null);
  const [submitted, setSubmitted] = createSignal(false);

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

  const activeInstance = (): Instance | undefined => {
    const id = activeInstanceId();
    if (!id) return undefined;
    return props.store()?.instanceDB[id];
  };

  const formatLastBackup = (ts: number | null): string => {
    if (!ts) return 'Never backed up';
    return `Last backup: ${new Date(ts).toLocaleString()}`;
  };

  const handleRestoreClick = (instanceId: string) => {
    setActiveInstanceId(instanceId);
    setSelectedTargetDiskId(null);
  };

  const handleSubmit = () => {
    const engineId = props.engineId();
    const inst = activeInstance();
    const s = props.store();
    const targetDiskId = selectedTargetDiskId();
    if (!engineId || !inst || !targetDiskId || !s) return;
    const targetDisk = s.diskDB[targetDiskId];
    if (!targetDisk) return;
    restoreApp(engineId, inst.name, targetDisk.name);
    setSubmitted(true);
  };

  const reset = () => {
    setActiveInstanceId(null);
    setSelectedTargetDiskId(null);
    setSubmitted(false);
  };

  return (
    <section class="restore-panel" aria-label="Backup disk restore">
      <header class="restore-panel__header">
        <span class="restore-panel__disk-icon">🗄</span>
        <div>
          <div class="restore-panel__title">{props.disk()?.name ?? 'Backup disk'}</div>
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

      {/* ── Success state ─────────────────────────────────────────── */}
      <Show when={submitted()}>
        <div class="restore-panel__success">
          <span class="restore-panel__success-icon">✓</span>
          <p>Restore command sent.</p>
          <button class="btn" onClick={reset}>Back</button>
        </div>
      </Show>

      {/* ── No backup configuration ───────────────────────────────── */}
      <Show when={!submitted() && !backupConfig()}>
        <p class="restore-panel__empty">This disk has no backup configuration.</p>
      </Show>

      {/* ── Instance list ─────────────────────────────────────────── */}
      <Show when={!submitted() && backupConfig() && !activeInstanceId()}>
        <Show
          when={linkedInstances().length > 0}
          fallback={
            <p class="restore-panel__empty">
              No instances configured for backup on this disk.
            </p>
          }
        >
          <div class="restore-panel__instance-list">
            <For each={linkedInstances()}>
              {(inst) => {
                const locked = () => isInstanceLocked(props.store(), inst.id);
                return (
                  <div class="restore-panel__instance-row">
                    <div class="restore-panel__instance-info">
                      <span class="restore-panel__instance-name">{inst.name}</span>
                      <span class="restore-panel__instance-backup">
                        {formatLastBackup(inst.lastBackup)}
                      </span>
                    </div>
                    <button
                      class="btn"
                      disabled={locked()}
                      onClick={() => handleRestoreClick(inst.id)}
                    >
                      {locked() ? 'Operation in progress' : 'Restore to\u2026'}
                    </button>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </Show>

      {/* ── Target disk picker ────────────────────────────────────── */}
      <Show when={!submitted() && activeInstanceId()}>
        <div class="restore-panel__form">
          <h3 class="restore-panel__form-title">
            Restore <strong>{activeInstance()?.name}</strong> to…
          </h3>
          <Show
            when={targetDisks().length > 0}
            fallback={<p class="restore-panel__empty">No available target disks.</p>}
          >
            <div class="restore-panel__disk-list">
              <For each={targetDisks()}>
                {(d) => (
                  <label
                    class={`radio-option ${selectedTargetDiskId() === d.id ? 'radio-option--selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="targetDisk"
                      value={d.id}
                      checked={selectedTargetDiskId() === d.id}
                      onChange={() => setSelectedTargetDiskId(d.id)}
                    />
                    <div>
                      <div class="radio-option__label">{d.name}</div>
                      <div class="radio-option__desc">{d.diskTypes.join(', ')}</div>
                    </div>
                  </label>
                )}
              </For>
            </div>
          </Show>
          <div class="restore-panel__actions">
            <button class="btn" onClick={reset}>Cancel</button>
            <button
              class="btn btn--primary"
              disabled={!selectedTargetDiskId()}
              onClick={handleSubmit}
            >
              Restore
            </button>
          </div>
        </div>
      </Show>
    </section>
  );
};

export default RestorePanel;
