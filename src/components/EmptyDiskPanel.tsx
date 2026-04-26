/**
 * EmptyDiskPanel — shown in the right pane when an operator selects an empty disk.
 *
 * Lets the operator choose what to do with the disk:
 *   1. Configure as Backup Disk — pick instances + backup mode → createBackupDisk command
 *   2. Configure as Files Disk  — single confirm → createFilesDisk command
 *   3. Install App              — pick from appDB → installApp command
 */
import { For, Show, createMemo, createSignal, type Component } from 'solid-js';
import { createBackupDisk, createFilesDisk, installApp } from '../store/commands';
import type { App, Disk, Instance, Store, BackupMode } from '../types/store';

interface EmptyDiskPanelProps {
  disk: () => Disk | undefined;
  store: () => Store | null;
  /** Engine ID that owns this disk */
  engineId: () => string | undefined;
}

type Panel = 'menu' | 'backup' | 'files' | 'install';

const BACKUP_MODES: { value: BackupMode; label: string; description: string }[] = [
  {
    value: 'on-demand',
    label: 'On demand',
    description: 'Backup only when you press the Back up button manually.',
  },
  {
    value: 'immediate',
    label: 'Immediate',
    description: 'Backup runs as soon as the disk is docked.',
  },
  {
    value: 'scheduled',
    label: 'Scheduled',
    description: 'Backup runs on a schedule configured on the disk.',
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

  // ── Install App configuration ──────────────────────────────────────────────
  const [appFilter, setAppFilter] = createSignal('');
  const [selectedAppId, setSelectedAppId] = createSignal<string | null>(null);

  const allApps = createMemo((): App[] => {
    const s = props.store();
    if (!s) return [];
    return Object.values(s.appDB);
  });

  const filteredApps = createMemo((): App[] => {
    const q = appFilter().toLowerCase();
    if (!q) return allApps();
    return allApps().filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.category ?? '').toLowerCase().includes(q)
    );
  });

  const appSourceLabel = (app: App): string => {
    if (app.source === 'disk' && app.sourceDiskName) return app.sourceDiskName;
    if (app.source === 'github') return 'GitHub';
    return 'catalog';
  };

  const toggleInstance = (id: string) => {
    setSelectedInstanceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleConfigureBackup = () => {
    setError('');
    const engineId = props.engineId();
    const disk = props.disk();
    if (!engineId || !disk) return;

    const ids = selectedInstanceIds();
    if (ids.length === 0) {
      setError('Select at least one app to back up.');
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

  const handleInstallApp = () => {
    setError('');
    const engineId = props.engineId();
    const disk = props.disk();
    const appId = selectedAppId();
    if (!engineId || !disk || !appId) return;

    const app = props.store()?.appDB[appId];
    const opts = app?.source === 'disk' && app?.sourceDiskName
      ? { source: app.sourceDiskName }
      : undefined;

    installApp(engineId, appId, disk.name, opts);
    setSubmitted(true);
  };

  const reset = () => {
    setPanel('menu');
    setSubmitted(false);
    setError('');
    setSelectedInstanceIds([]);
    setBackupMode('on-demand');
    setAppFilter('');
    setSelectedAppId(null);
  };

  const goMenu = () => { setError(''); setPanel('menu'); };

  return (
    <section class="edp" aria-label="Empty disk configuration">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header class="edp__header">
        <div class="edp__header-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="22" height="22" aria-hidden="true">
            <ellipse cx="12" cy="6" rx="9" ry="3"/>
            <path d="M3 6v6c0 1.657 4.03 3 9 3s9-1.343 9-3V6"/>
            <path d="M3 12v6c0 1.657 4.03 3 9 3s9-1.343 9-3v-6"/>
          </svg>
        </div>
        <div class="edp__header-text">
          <div class="edp__title">{props.disk()?.name ?? 'Empty disk'}</div>
          <div class="edp__subtitle">Empty — ready to configure</div>
        </div>
        <Show when={panel() !== 'menu' && !submitted()}>
          <button class="edp__back" onClick={goMenu}>← Back</button>
        </Show>
      </header>

      <div class="edp__body">

        {/* ── Success ──────────────────────────────────────────────────────── */}
        <Show when={submitted()}>
          <div class="edp__success">
            <div class="edp__success-icon">✓</div>
            <p class="edp__success-msg">Command sent. The Engine is configuring the disk.</p>
            <button class="btn" onClick={reset}>← Back</button>
          </div>
        </Show>

        {/* ── Menu ─────────────────────────────────────────────────────────── */}
        <Show when={!submitted() && panel() === 'menu'}>
          <p class="edp__prompt">What would you like to do with this disk?</p>
          <div class="edp__menu">

            <button class="edp-card" onClick={() => setPanel('backup')}>
              <div class="edp-card__icon edp-card__icon--backup">
                <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden="true">
                  <path d="M4 3a1 1 0 011-1h10a1 1 0 011 1v2H4V3zM2 7a1 1 0 011-1h14a1 1 0 011 1v2H2V7zM2 11h16v6a1 1 0 01-1 1H3a1 1 0 01-1-1v-6z"/>
                </svg>
              </div>
              <div class="edp-card__text">
                <span class="edp-card__title">Backup Disk</span>
                <span class="edp-card__desc">Link instances and choose a backup schedule</span>
              </div>
              <span class="edp-card__chevron">›</span>
            </button>

            <button class="edp-card" onClick={() => setPanel('files')}>
              <div class="edp-card__icon edp-card__icon--files">
                <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden="true">
                  <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
                </svg>
              </div>
              <div class="edp-card__text">
                <span class="edp-card__title">Files Disk</span>
                <span class="edp-card__desc">Shared network filesystem for the Engine</span>
              </div>
              <span class="edp-card__chevron">›</span>
            </button>

            <button class="edp-card" onClick={() => setPanel('install')}>
              <div class="edp-card__icon edp-card__icon--install">
                <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden="true">
                  <path d="M10 2a8 8 0 100 16A8 8 0 0010 2zm1 5a1 1 0 10-2 0v3H6a1 1 0 100 2h3v3a1 1 0 102 0v-3h3a1 1 0 100-2h-3V7z"/>
                </svg>
              </div>
              <div class="edp-card__text">
                <span class="edp-card__title">Install App</span>
                <span class="edp-card__desc">Install an app from the network or catalog</span>
              </div>
              <span class="edp-card__chevron">›</span>
            </button>

          </div>
        </Show>

        {/* ── Backup Disk form ─────────────────────────────────────────────── */}
        <Show when={!submitted() && panel() === 'backup'}>
          <div class="edp-form">

            <p class="edp-form__label">Backup mode</p>
            <div class="edp-radios">
              <For each={BACKUP_MODES}>
                {(m) => (
                  <label class={`edp-radio ${backupMode() === m.value ? 'edp-radio--on' : ''}`}>
                    <input
                      type="radio"
                      name="backupMode"
                      value={m.value}
                      checked={backupMode() === m.value}
                      onChange={() => setBackupMode(m.value)}
                    />
                    <div>
                      <div class="edp-radio__title">{m.label}</div>
                      <div class="edp-radio__desc">{m.description}</div>
                    </div>
                  </label>
                )}
              </For>
            </div>

            <p class="edp-form__label">Link to instances</p>
            <Show
              when={allInstances().length > 0}
              fallback={<p class="edp-form__hint">No instances found on the network.</p>}
            >
              <div class="edp-checks">
                <For each={allInstances()}>
                  {(inst) => (
                    <label class={`edp-check ${selectedInstanceIds().includes(inst.id) ? 'edp-check--on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={selectedInstanceIds().includes(inst.id)}
                        onChange={() => toggleInstance(inst.id)}
                      />
                      <span class="edp-check__name">{inst.name}</span>
                      <span class="edp-check__status">{inst.status}</span>
                    </label>
                  )}
                </For>
              </div>
            </Show>

            <Show when={error()}><p class="edp-form__error">{error()}</p></Show>
            <div class="edp-form__actions">
              <button class="btn btn--primary" onClick={handleConfigureBackup}>Configure Backup Disk</button>
            </div>

          </div>
        </Show>

        {/* ── Files Disk form ──────────────────────────────────────────────── */}
        <Show when={!submitted() && panel() === 'files'}>
          <div class="edp-form">
            <p class="edp-form__hint">
              The Engine will format this disk as a shared network filesystem.
              Apps configured to use a Files Disk will have it mounted automatically.
            </p>
            <Show when={error()}><p class="edp-form__error">{error()}</p></Show>
            <div class="edp-form__actions">
              <button class="btn btn--primary" onClick={handleConfigureFiles}>Configure Files Disk</button>
            </div>
          </div>
        </Show>

        {/* ── Install App form ─────────────────────────────────────────────── */}
        <Show when={!submitted() && panel() === 'install'}>
          <div class="edp-form">
            <p class="edp-form__hint">
              Choose an app to install onto <strong>{props.disk()?.name}</strong>.
            </p>
            <input
              class="edp-form__search"
              type="text"
              placeholder="Search apps…"
              value={appFilter()}
              onInput={(e) => setAppFilter((e.target as HTMLInputElement).value)}
            />
            <Show
              when={filteredApps().length > 0}
              fallback={<p class="edp-form__hint">No apps found.</p>}
            >
              <div class="edp-applist">
                <For each={filteredApps()}>
                  {(app) => (
                    <label class={`edp-appitem ${selectedAppId() === app.id ? 'edp-appitem--on' : ''}`}>
                      <input
                        type="radio"
                        name="installApp"
                        value={app.id}
                        checked={selectedAppId() === app.id}
                        onChange={() => setSelectedAppId(app.id)}
                      />
                      <div class="edp-appitem__info">
                        <span class="edp-appitem__title">{app.title}</span>
                        <span class="edp-appitem__meta">v{app.version} · {appSourceLabel(app)}</span>
                      </div>
                    </label>
                  )}
                </For>
              </div>
            </Show>
            <Show when={error()}><p class="edp-form__error">{error()}</p></Show>
            <div class="edp-form__actions">
              <button class="btn btn--primary" disabled={!selectedAppId()} onClick={handleInstallApp}>
                Install App
              </button>
            </div>
          </div>
        </Show>

      </div>
    </section>
  );
};

export default EmptyDiskPanel;
