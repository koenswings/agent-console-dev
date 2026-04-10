/**
 * EmptyDiskPanel — shown in the right pane when an operator selects an empty disk.
 *
 * Lets the operator choose what to do with the disk:
 *   1. Configure as Backup Disk — pick instances + backup mode → createBackupDisk command
 *   2. Configure as Files Disk  — single confirm → createFilesDisk command
 *   3. Create new App Instance  — requires Engine to surface available app sources;
 *      currently shows a placeholder until the Engine API supports it.
 */
import { For, Show, createSignal, type Component } from 'solid-js';
import { createBackupDisk, createFilesDisk } from '../store/commands';
import type { Disk, Instance, Store, BackupMode } from '../types/store';

interface EmptyDiskPanelProps {
  disk: () => Disk | undefined;
  store: () => Store | null;
  /** Engine ID that owns this disk */
  engineId: () => string | undefined;
}

type Panel = 'menu' | 'backup' | 'files' | 'app';

const BACKUP_MODES: { value: BackupMode; label: string; description: string }[] = [
  {
    value: 'on-demand',
    label: 'On demand',
    description: 'Backup only when you press the Back up button manually.',
  },
  {
    value: 'immediate',
    label: 'Immediate',
    description: 'Backup runs as soon as the disk is docked. Apps are stopped one by one during backup.',
  },
  {
    value: 'scheduled',
    label: 'Scheduled',
    description: 'Backup runs on a schedule (configured on the disk). Apps are stopped during backup.',
  },
];

const EmptyDiskPanel: Component<EmptyDiskPanelProps> = (props) => {
  const [panel, setPanel] = createSignal<Panel>('menu');
  const [submitted, setSubmitted] = createSignal(false);
  const [error, setError] = createSignal('');

  // ── Backup Disk configuration ─────────────────────────────────────────────
  const [backupMode, setBackupMode] = createSignal<BackupMode>('on-demand');
  const [selectedInstanceIds, setSelectedInstanceIds] = createSignal<string[]>([]);

  const allInstances = (): Instance[] => {
    const s = props.store();
    if (!s) return [];
    return Object.values(s.instanceDB);
  };

  const toggleInstance = (id: string) => {
    setSelectedInstanceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const instanceName = (id: string): string => {
    const s = props.store();
    if (!s) return id;
    return s.instanceDB[id]?.name ?? id;
  };

  const handleConfigureBackup = () => {
    setError('');
    const engineId = props.engineId();
    const disk = props.disk();
    if (!engineId || !disk) return;

    const ids = selectedInstanceIds();
    if (ids.length === 0) {
      setError('Select at least one instance to back up.');
      return;
    }

    const s = props.store();
    const names = ids.map((id) => s?.instanceDB[id]?.name ?? id);
    createBackupDisk(engineId, disk.name, backupMode(), names);
    setSubmitted(true);
  };

  const handleConfigureFiles = () => {
    setError('');
    const engineId = props.engineId();
    const disk = props.disk();
    if (!engineId || !disk) return;
    createFilesDisk(engineId, disk.name);
    setSubmitted(true);
  };

  const reset = () => {
    setPanel('menu');
    setSubmitted(false);
    setError('');
    setSelectedInstanceIds([]);
    setBackupMode('on-demand');
  };

  return (
    <section class="empty-disk-panel" aria-label="Empty disk configuration">
      <header class="empty-disk-panel__header">
        <span class="empty-disk-panel__disk-icon">💾</span>
        <div>
          <div class="empty-disk-panel__title">{props.disk()?.name ?? 'Empty disk'}</div>
          <div class="empty-disk-panel__subtitle">Empty disk — ready to configure</div>
        </div>
      </header>

      {/* ── Success state ─────────────────────────────────────────── */}
      <Show when={submitted()}>
        <div class="empty-disk-panel__success">
          <span class="empty-disk-panel__success-icon">✓</span>
          <p>Command sent. The Engine is configuring the disk.</p>
          <button class="btn" onClick={reset}>Back</button>
        </div>
      </Show>

      {/* ── Menu ─────────────────────────────────────────────────── */}
      <Show when={!submitted() && panel() === 'menu'}>
        <p class="empty-disk-panel__intro">
          What would you like to do with this disk?
        </p>
        <div class="empty-disk-panel__options">
          <button
            class="empty-disk-option"
            onClick={() => setPanel('backup')}
          >
            <span class="empty-disk-option__icon">🗄</span>
            <div>
              <div class="empty-disk-option__title">Configure as Backup Disk</div>
              <div class="empty-disk-option__desc">
                Link instances to this disk and choose a backup schedule.
              </div>
            </div>
          </button>

          <button
            class="empty-disk-option"
            onClick={() => setPanel('files')}
          >
            <span class="empty-disk-option__icon">📁</span>
            <div>
              <div class="empty-disk-option__title">Configure as Files Disk</div>
              <div class="empty-disk-option__desc">
                Create a shared network file system mounted by the Engine.
              </div>
            </div>
          </button>

          <button
            class="empty-disk-option empty-disk-option--unavailable"
            onClick={() => setPanel('app')}
          >
            <span class="empty-disk-option__icon">📦</span>
            <div>
              <div class="empty-disk-option__title">Create new App Instance</div>
              <div class="empty-disk-option__desc">
                Install an app from the network or a catalog disk.
              </div>
            </div>
          </button>
        </div>
      </Show>

      {/* ── Configure as Backup Disk ──────────────────────────────── */}
      <Show when={!submitted() && panel() === 'backup'}>
        <div class="empty-disk-panel__form">
          <h3 class="empty-disk-panel__form-title">Configure as Backup Disk</h3>

          <label class="empty-disk-panel__label">Backup mode</label>
          <div class="empty-disk-panel__radio-group">
            <For each={BACKUP_MODES}>
              {(m) => (
                <label class={`radio-option ${backupMode() === m.value ? 'radio-option--selected' : ''}`}>
                  <input
                    type="radio"
                    name="backupMode"
                    value={m.value}
                    checked={backupMode() === m.value}
                    onChange={() => setBackupMode(m.value)}
                  />
                  <div>
                    <div class="radio-option__label">{m.label}</div>
                    <div class="radio-option__desc">{m.description}</div>
                  </div>
                </label>
              )}
            </For>
          </div>

          <label class="empty-disk-panel__label">Link to instances</label>
          <Show
            when={allInstances().length > 0}
            fallback={<p class="empty-disk-panel__hint">No instances found on the network.</p>}
          >
            <div class="empty-disk-panel__instance-list">
              <For each={allInstances()}>
                {(inst) => (
                  <label class={`checkbox-option ${selectedInstanceIds().includes(inst.id) ? 'checkbox-option--selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selectedInstanceIds().includes(inst.id)}
                      onChange={() => toggleInstance(inst.id)}
                    />
                    <span class="checkbox-option__label">{inst.name}</span>
                    <span class="checkbox-option__status">{inst.status}</span>
                  </label>
                )}
              </For>
            </div>
          </Show>

          <Show when={error()}>
            <p class="empty-disk-panel__error">{error()}</p>
          </Show>

          <div class="empty-disk-panel__actions">
            <button class="btn" onClick={() => { setError(''); setPanel('menu'); }}>Cancel</button>
            <button class="btn btn--primary" onClick={handleConfigureBackup}>
              Configure Backup Disk
            </button>
          </div>
        </div>
      </Show>

      {/* ── Configure as Files Disk ───────────────────────────────── */}
      <Show when={!submitted() && panel() === 'files'}>
        <div class="empty-disk-panel__form">
          <h3 class="empty-disk-panel__form-title">Configure as Files Disk</h3>
          <p class="empty-disk-panel__hint">
            The Engine will format this disk as a shared network file system.
            Apps configured to use a Files Disk will have it mounted automatically.
          </p>
          <Show when={error()}>
            <p class="empty-disk-panel__error">{error()}</p>
          </Show>
          <div class="empty-disk-panel__actions">
            <button class="btn" onClick={() => setPanel('menu')}>Cancel</button>
            <button class="btn btn--primary" onClick={handleConfigureFiles}>
              Configure Files Disk
            </button>
          </div>
        </div>
      </Show>

      {/* ── Create App Instance (placeholder) ────────────────────── */}
      <Show when={!submitted() && panel() === 'app'}>
        <div class="empty-disk-panel__form">
          <h3 class="empty-disk-panel__form-title">Create new App Instance</h3>
          <div class="empty-disk-panel__unavailable-notice">
            <p>
              <strong>Coming soon.</strong> The Engine needs to surface the list of available
              app sources (docked app disks, backup/catalog disks, network) before this can
              be built. Once that API is available this flow will let you pick an app and
              install it onto this disk.
            </p>
          </div>
          <div class="empty-disk-panel__actions">
            <button class="btn" onClick={() => setPanel('menu')}>Back</button>
          </div>
        </div>
      </Show>
    </section>
  );
};

export default EmptyDiskPanel;
