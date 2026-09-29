/**
 * EmptyDiskPanel — shown in the right pane when an operator selects an empty disk.
 *
 * Lets the operator choose what to do with the disk:
 *   1. Make this a Files Disk   — share name → createFilesDisk <diskId> <shareName> (idea#132)
 *   2. Make this a Backup Disk  — pick instances + backup mode → createBackupDisk command
 *   3. Install App              — pick from appDB → installApp command
 *
 * Disk arguments go through diskArgFor (idea#129): the disk ID on an Engine
 * with 'diskIdArgs', a unique name on an older one; otherwise Backup and
 * Install are greyed out with UPDATE_ENGINE_TOOLTIP. Make this a Files Disk is
 * greyed out with the same tooltip unless the Engine advertises a fresh
 * 'filesDisk' (idea#132 addendum).
 */
import { For, Show, createMemo, createSignal, type Accessor, type Component } from 'solid-js';
import {
  createBackupDisk,
  diskArgFor,
  engineHasCapability,
  installApp,
  type DiskArg,
  UPDATE_ENGINE_TOOLTIP,
} from '../store/commands';
import { canEraseDisk, eraseBlockedReason } from '../store/erase';
import {
  createCommandResult,
} from '../store/commandResult';
import FilesRoleForm from './FilesRoleForm';
import EraseDialog, { type EraseMode } from './EraseDialog';
import type { CommandLogState } from '../store/commandLog';
import type { App, Disk, Engine, Store, BackupMode } from '../types/store';

/** installApp can take minutes (image load); keep waiting longer than Files/Backup. */
export const INSTALL_RESULT_TIMEOUT_MS = 5 * 60_000;

export const BACKUP_TIMEOUT_MESSAGE = "The Engine didn't respond. Check History for createBackupDisk.";
export const INSTALL_TIMEOUT_MESSAGE = "The Engine didn't finish installing in time. Check History for installApp.";

interface EmptyDiskPanelProps {
  disk: () => Disk | undefined;
  store: () => Store | null;
  /** Engine ID that owns this disk */
  engineId: () => string | undefined;
  /** Engine command log — used to wait for the createFilesDisk result. */
  commandLogStore?: Accessor<CommandLogState>;
  /** After erase republish: parent selects the empty disk (same ID). */
  onSelectDisk?: (diskId: string) => void;
  /** Optional error shown after a failed Files shortcut createFilesDisk. */
  filesError?: string | null;
  onFilesFailed?: (diskId: string, message: string) => void;
}

type Panel = 'menu' | 'backup' | 'files' | 'install';

/** Files explanation on an empty disk (files-disk.md §4). */
export const FILES_INTRO =
  'This disk becomes a shared file store. Apps that support Files Disks (such as Nextcloud) on this Engine will show its files. Nothing on the disk is erased.';

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
  const [error, setError] = createSignal('');

  // Wait for Engine traces instead of claiming success on send (idea#122).
  const backupResult = createCommandResult({
    commandLog: () => props.commandLogStore?.() ?? null,
    command: 'createBackupDisk',
    argKey: 'diskId',
    isSuccess: () => (props.disk()?.diskTypes ?? []).includes('backup'),
  });
  const installResult = createCommandResult({
    commandLog: () => props.commandLogStore?.() ?? null,
    command: 'installApp',
    argKey: 'diskId', // unused in 'includes' mode; value is matched in args JSON
    matchMode: 'includes',
    timeoutMs: INSTALL_RESULT_TIMEOUT_MS,
  });

  // ── Target Engine (the disk's dockedTo) and its disk argument ─────────────
  const targetEngine = (): Engine | undefined => {
    const id = props.disk()?.dockedTo ?? props.engineId();
    return id ? props.store()?.engineDB[id] : undefined;
  };
  const diskArg = createMemo((): DiskArg | null => {
    const disk = props.disk();
    return disk ? diskArgFor(targetEngine(), disk, props.store()?.diskDB) : null;
  });
  const diskBlocked = (): string | undefined => {
    const a = diskArg();
    return a && !a.ok ? a.reason : undefined;
  };
  const filesSupported = createMemo(() => engineHasCapability(targetEngine(), 'filesDisk'));
  const filesBlocked = (): string | undefined => (filesSupported() ? undefined : UPDATE_ENGINE_TOOLTIP);
  const eraseBlocked = createMemo(() => {
    const d = props.disk();
    if (!d || !canEraseDisk(d)) return 'Cannot erase this disk';
    return eraseBlockedReason(targetEngine(), props.store(), d.id);
  });
  const [eraseDialog, setEraseDialog] = createSignal<{ mode: EraseMode; shareName?: string } | null>(null);

  // ── Backup Disk configuration ─────────────────────────────────────────────
  const [backupMode, setBackupMode] = createSignal<BackupMode>('on-demand');
  const [selectedInstanceIds, setSelectedInstanceIds] = createSignal<string[]>([]);

  /** ID-keyed list so Automerge updates don't re-render every row (idea#83). */
  const allInstanceIds = createMemo((): string[] => {
    const s = props.store();
    if (!s) return [];
    return Object.keys(s.instanceDB);
  });

  // ── Install App configuration ──────────────────────────────────────────────
  const [appFilter, setAppFilter] = createSignal('');
  const [selectedAppId, setSelectedAppId] = createSignal<string | null>(null);

  const allAppIds = createMemo((): string[] => {
    const s = props.store();
    if (!s) return [];
    return Object.keys(s.appDB);
  });

  const filteredAppIds = createMemo((): string[] => {
    const s = props.store();
    if (!s) return [];
    const q = appFilter().toLowerCase();
    return allAppIds().filter((id) => {
      const a = s.appDB[id];
      if (!a) return false;
      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.category ?? '').toLowerCase().includes(q)
      );
    });
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

    const arg = diskArg();
    if (!arg || !arg.ok) return;
    const s = props.store();
    const names = ids.map((id) => s?.instanceDB[id]?.name ?? id);
    // Match on disk.id (named args.diskId on 0b Engines); name-only Engines still
    // get a trace the operator can read in History if matching fails.
    backupResult.start(arg.arg, () => createBackupDisk(engineId, arg.arg, backupMode(), names));
  };

  const handleInstallApp = () => {
    setError('');
    const engineId = props.engineId();
    const disk = props.disk();
    const appId = selectedAppId();
    if (!engineId || !disk || !appId) return;

    const arg = diskArg();
    if (!arg || !arg.ok) return;

    // --source: the source disk ID on a 0b Engine, its name otherwise (as before).
    const app = props.store()?.appDB[appId];
    const source = app?.source === 'disk'
      ? (arg.byId ? app.sourceDiskId ?? app.sourceDiskName : app.sourceDiskName)
      : undefined;
    const opts = source ? { source } : undefined;

    // Match the disk argument inside installApp's positional args blob (idea#122).
    installResult.start(arg.arg, () => installApp(engineId, appId, arg.arg, opts));
  };

  const reset = () => {
    setPanel('menu');
    setError('');
    backupResult.reset();
    installResult.reset();
    setSelectedInstanceIds([]);
    setBackupMode('on-demand');
    setAppFilter('');
    setSelectedAppId(null);
  };

  const backupPending = () => backupResult.state().kind === 'pending';
  const installPending = () => installResult.state().kind === 'pending';
  const actionDone = () =>
    backupResult.state().kind === 'success' || installResult.state().kind === 'success';

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
        <Show when={panel() !== 'menu' && !actionDone() && !backupPending() && !installPending()}>
          <button class="edp__back" onClick={goMenu}>← Back</button>
        </Show>
      </header>

      <div class="edp__body">

        {/* ── Success (after Engine confirms) ─────────────────────────────── */}
        <Show when={actionDone()}>
          <div class="edp__success">
            <div class="edp__success-icon">✓</div>
            <p class="edp__success-msg">
              {backupResult.state().kind === 'success'
                ? 'Done. This disk is now a Backup Disk.'
                : 'Done. The app is installed on this disk.'}
            </p>
            <button class="btn" onClick={reset}>← Back</button>
          </div>
        </Show>

        {/* ── Menu ─────────────────────────────────────────────────────────── */}
        <Show when={!actionDone() && panel() === 'menu'}>
          <p class="edp__prompt">What would you like to do with this disk?</p>
          <div class="edp__menu">

            <button
              class="edp-card"
              disabled={!!filesBlocked()}
              title={filesBlocked()}
              onClick={() => setPanel('files')}
            >
              <div class="edp-card__icon edp-card__icon--files">
                <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden="true">
                  <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
                </svg>
              </div>
              <div class="edp-card__text">
                <span class="edp-card__title">Make this a Files Disk</span>
                <span class="edp-card__desc">A shared file store for Apps on this Engine</span>
              </div>
              <span class="edp-card__chevron">›</span>
            </button>

            <button
              class="edp-card"
              disabled={!!diskBlocked()}
              title={diskBlocked()}
              onClick={() => setPanel('backup')}
            >
              <div class="edp-card__icon edp-card__icon--backup">
                <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden="true">
                  <path d="M4 3a1 1 0 011-1h10a1 1 0 011 1v2H4V3zM2 7a1 1 0 011-1h14a1 1 0 011 1v2H2V7zM2 11h16v6a1 1 0 01-1 1H3a1 1 0 01-1-1v-6z"/>
                </svg>
              </div>
              <div class="edp-card__text">
                <span class="edp-card__title">Make this a Backup Disk</span>
                <span class="edp-card__desc">Link instances and choose a backup schedule</span>
              </div>
              <span class="edp-card__chevron">›</span>
            </button>


            <button
              class="edp-card"
              disabled={!!diskBlocked()}
              title={diskBlocked()}
              onClick={() => setPanel('install')}
            >
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
        <Show when={!actionDone() && panel() === 'backup'}>
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
              when={allInstanceIds().length > 0}
              fallback={<p class="edp-form__hint">No instances found on the network.</p>}
            >
              <div class="edp-checks">
                <For each={allInstanceIds()}>
                  {(id) => {
                    const inst = () => props.store()?.instanceDB[id];
                    return (
                      <Show when={inst()}>
                        {(i) => (
                          <label class={`edp-check ${selectedInstanceIds().includes(id) ? 'edp-check--on' : ''}`}>
                            <input
                              type="checkbox"
                              checked={selectedInstanceIds().includes(id)}
                              onChange={() => toggleInstance(id)}
                            />
                            <span class="edp-check__name">{i().name}</span>
                            <span class="edp-check__status">{i().status}</span>
                          </label>
                        )}
                      </Show>
                    );
                  }}
                </For>
              </div>
            </Show>

            <Show when={error()}><p class="edp-form__error">{error()}</p></Show>
            <Show when={backupPending()}>
              <p class="edp-form__hint" data-testid="backup-pending">Waiting for the Engine…</p>
            </Show>
            <Show when={(() => { const s = backupResult.state(); return s.kind === 'error' ? s.message : null; })()}>
              {(msg) => <p class="edp-form__error" role="alert" data-testid="backup-error">{msg()}</p>}
            </Show>
            <Show when={backupResult.state().kind === 'timeout'}>
              <p class="edp-form__error" role="status" data-testid="backup-timeout">{BACKUP_TIMEOUT_MESSAGE}</p>
            </Show>
            <div class="edp-form__actions">
              <button
                class="btn btn--primary"
                disabled={backupPending()}
                onClick={handleConfigureBackup}
              >
                Configure Backup Disk
              </button>
            </div>

          </div>
        </Show>

        {/* ── Files Disk form (idea#132) + erase-first (idea#136) ─────────── */}
        <Show when={!actionDone() && panel() === 'files' && !eraseDialog()}>
          <FilesRoleForm
            disk={props.disk}
            engineId={props.engineId}
            commandLogStore={props.commandLogStore}
            intro={FILES_INTRO}
            submitLabel="Make this a Files Disk"
            blockedReason={filesBlocked}
            footer={(f) => (
              <div class="erase-first">
                <p class="edp-form__hint">Removes everything on it, then makes it a Files Disk.</p>
                <button
                  class="btn btn--danger"
                  disabled={!!eraseBlocked() || !!f.blocked || !!f.shareNameError || f.pending}
                  title={eraseBlocked() || f.blocked}
                  onClick={() => setEraseDialog({ mode: 'erase-then-files', shareName: f.shareName })}
                >
                  Erase the disk first
                </button>
              </div>
            )}
          />
        </Show>

        {/* ── Install App form ─────────────────────────────────────────────── */}
        <Show when={!actionDone() && panel() === 'install'}>
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
              when={filteredAppIds().length > 0}
              fallback={<p class="edp-form__hint">No apps found.</p>}
            >
              <div class="edp-applist">
                <For each={filteredAppIds()}>
                  {(id) => {
                    const app = () => props.store()?.appDB[id];
                    return (
                      <Show when={app()}>
                        {(a) => (
                          <label class={`edp-appitem ${selectedAppId() === id ? 'edp-appitem--on' : ''}`}>
                            <input
                              type="radio"
                              name="installApp"
                              value={id}
                              checked={selectedAppId() === id}
                              onChange={() => setSelectedAppId(id)}
                            />
                            <div class="edp-appitem__info">
                              <span class="edp-appitem__title">{a().title}</span>
                              <span class="edp-appitem__meta">v{a().version} · {appSourceLabel(a())}</span>
                            </div>
                          </label>
                        )}
                      </Show>
                    );
                  }}
                </For>
              </div>
            </Show>
            <Show when={error()}><p class="edp-form__error">{error()}</p></Show>
            <Show when={installPending()}>
              <p class="edp-form__hint" data-testid="install-pending">Waiting for the Engine…</p>
            </Show>
            <Show when={(() => { const s = installResult.state(); return s.kind === 'error' ? s.message : null; })()}>
              {(msg) => <p class="edp-form__error" role="alert" data-testid="install-error">{msg()}</p>}
            </Show>
            <Show when={installResult.state().kind === 'timeout'}>
              <p class="edp-form__error" role="status" data-testid="install-timeout">{INSTALL_TIMEOUT_MESSAGE}</p>
            </Show>
            <div class="edp-form__actions">
              <button
                class="btn btn--primary"
                disabled={!selectedAppId() || installPending()}
                onClick={handleInstallApp}
              >
                Install App
              </button>
            </div>
          </div>
        </Show>

        {/* ── Erase this disk… (idea#136) ─────────────────────────────────── */}
        <Show when={!actionDone() && panel() === 'menu' && !eraseDialog() && props.disk() && canEraseDisk(props.disk()!)}>
          <div class="disk-view__erase">
            <button
              class="btn-text btn-text--danger"
              disabled={!!eraseBlocked()}
              title={eraseBlocked()}
              data-testid="erase-this-disk"
              onClick={() => setEraseDialog({ mode: 'erase' })}
            >
              Erase this disk…
            </button>
          </div>
        </Show>

        <Show when={props.filesError}>
          <p class="edp-form__error" role="alert">{props.filesError}</p>
        </Show>

        <Show when={eraseDialog()}>
          {(d) => (
            <EraseDialog
              targetId={props.disk()!.id}
              engineId={String(props.disk()!.dockedTo ?? props.engineId())}
              fallbackLabel={props.disk()!.name}
              mode={d().mode}
              shareName={d().shareName}
              store={props.store}
              commandLogStore={props.commandLogStore}
              onClose={() => setEraseDialog(null)}
              onErasedEmpty={(id) => {
                setEraseDialog(null);
                props.onSelectDisk?.(id);
              }}
              onBecameFiles={(id) => {
                setEraseDialog(null);
                props.onSelectDisk?.(id);
              }}
              onFilesFailed={(id, msg) => {
                setEraseDialog(null);
                if (props.onFilesFailed) props.onFilesFailed(id, msg);
                else props.onSelectDisk?.(id);
              }}
            />
          )}
        </Show>

      </div>
    </section>
  );
};

export default EmptyDiskPanel;
