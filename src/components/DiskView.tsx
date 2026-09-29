/**
 * DiskView — right pane for a selected disk that isn't in the Empty disk
 * state (files-disk.md §8, idea#132 / idea#136). A header with one badge per
 * role in fixed order, then one section per role: Apps, Backups and Files.
 * "Add Files" / "Erase the disk first" on App/Backup disks; "Erase this
 * disk…" at the bottom of every non-system disk.
 */
import { Show, createMemo, createSignal, type Accessor, type Component } from 'solid-js';
import InstanceList from './InstanceList';
import RestorePanel from './RestorePanel';
import FilesSection from './FilesSection';
import FilesRoleForm from './FilesRoleForm';
import EraseDialog, { type EraseMode } from './EraseDialog';
import RoleBadges from './RoleBadges';
import {
  DEFAULT_SHARE_NAME,
  UPDATE_ENGINE_TOOLTIP,
  engineHasCapability,
  validateShareName,
} from '../store/commands';
import { canAddFiles, hasAppRole } from '../store/diskRoles';
import { canEraseDisk, eraseBlockedReason } from '../store/erase';
import type { Selection } from './NetworkTree';
import type { CommandLogState } from '../store/commandLog';
import type { Disk, Store } from '../types/store';
import type { DragAppData } from '../types/drag';

interface DiskViewProps {
  diskId: string;
  store: () => Store | null;
  commandLogStore?: Accessor<CommandLogState>;
  onDragStart?: (data: DragAppData) => void;
  onDragEnd?: () => void;
  onSelect?: (selection: Selection) => void;
  /** Pre-open erase-then-files (e.g. after createFilesDisk failure on Empty Disk). */
  initialEraseMode?: EraseMode | null;
  /** Error to show when landing here after a failed createFilesDisk in the shortcut. */
  filesError?: string | null;
  onClearFilesError?: () => void;
  onFilesFailed?: (diskId: string, message: string) => void;
}

/** Text of the Add Files confirmation (files-disk.md §4). */
export const ADD_FILES_CONFIRMATION =
  'Nothing on this disk is changed. Your Apps and backups stay as they are, and the disk also becomes a shared file store.';

export const ERASE_FIRST_NOTE = 'Removes everything on it, then makes it a Files Disk.';

const DiskView: Component<DiskViewProps> = (props) => {
  const disk = () => props.store()?.diskDB[props.diskId] as Disk | undefined;
  const engineId = () => (disk()?.dockedTo ? String(disk()!.dockedTo) : undefined);
  const engine = () => {
    const id = engineId();
    return id ? props.store()?.engineDB[id] : undefined;
  };
  const types = () => disk()?.diskTypes ?? [];

  const showApps = createMemo(() => { const d = disk(); return !!d && hasAppRole(d, props.store()); });
  const showBackups = createMemo(() => types().includes('backup'));
  const showFiles = createMemo(() => types().includes('files'));
  const noRoleSection = () => !showApps() && !showBackups() && !showFiles();
  const offerAddFiles = createMemo(() => { const d = disk(); return !!d && canAddFiles(d, props.store()); });
  const offerErase = createMemo(() => { const d = disk(); return !!d && canEraseDisk(d); });

  const filesBlocked = createMemo((): string | undefined =>
    engineHasCapability(engine(), 'filesDisk') ? undefined : UPDATE_ENGINE_TOOLTIP
  );
  const eraseBlocked = createMemo(() =>
    eraseBlockedReason(engine(), props.store(), props.diskId)
  );

  const [addFilesOpen, setAddFilesOpen] = createSignal(false);
  const [dialog, setDialog] = createSignal<{ mode: EraseMode; shareName?: string } | null>(
    props.initialEraseMode ? { mode: props.initialEraseMode } : null
  );
  const selection = (): Selection => ({ type: 'disk', id: props.diskId });

  const openErase = (mode: EraseMode, shareName = DEFAULT_SHARE_NAME) => {
    if (eraseBlocked()) return;
    if (mode === 'erase-then-files' && (filesBlocked() || validateShareName(shareName))) return;
    setDialog({ mode, shareName });
  };

  return (
    <section class="disk-view" aria-label="Disk">
      <header class="disk-view__header">
        <span class="disk-view__icon" aria-hidden="true">💾</span>
        <span class="disk-view__title">{disk()?.name ?? props.diskId}</span>
        <span class="disk-view__badges">
          <RoleBadges disk={disk} store={props.store} />
        </span>
      </header>

      <Show when={props.filesError}>
        <p class="edp-form__error" role="alert">{props.filesError}</p>
      </Show>

      <Show when={!dialog()}>
        <Show when={showApps() || noRoleSection()}>
          <InstanceList
            selection={selection()}
            store={props.store}
            commandLogStore={props.commandLogStore}
            onDragStart={props.onDragStart}
            onDragEnd={props.onDragEnd}
            title={showApps() ? 'Apps' : undefined}
          />
        </Show>

        <Show when={showBackups()}>
          <RestorePanel disk={disk} store={props.store} engineId={engineId} title="Backups" />
        </Show>

        <Show when={showFiles()}>
          <FilesSection disk={disk} store={props.store} commandLogStore={props.commandLogStore} />
        </Show>

        <Show when={offerAddFiles() || addFilesOpen()}>
          <section class="disk-section disk-section--add-files" aria-label="Add Files">
            <Show
              when={addFilesOpen()}
              fallback={
                <button
                  class="btn disk-view__add-files"
                  disabled={!!filesBlocked()}
                  title={filesBlocked()}
                  onClick={() => setAddFilesOpen(true)}
                >
                  Add Files to this disk
                </button>
              }
            >
              <h3 class="disk-section__title">Add Files to this disk</h3>
              <FilesRoleForm
                disk={disk}
                engineId={engineId}
                commandLogStore={props.commandLogStore}
                intro={ADD_FILES_CONFIRMATION}
                submitLabel="Add Files"
                blockedReason={filesBlocked}
                footer={(f) => (
                  <div class="erase-first">
                    <p class="edp-form__hint">{ERASE_FIRST_NOTE}</p>
                    <button
                      class="btn btn--danger disk-view__erase-first"
                      disabled={!!eraseBlocked() || !!f.blocked || !!f.shareNameError || f.pending}
                      title={eraseBlocked() || f.blocked}
                      onClick={() => openErase('erase-then-files', f.shareName)}
                    >
                      Erase the disk first
                    </button>
                  </div>
                )}
              />
              <div class="edp-form__actions">
                <button class="btn" onClick={() => setAddFilesOpen(false)}>Close</button>
              </div>
            </Show>
          </section>
        </Show>

        <Show when={offerErase()}>
          <div class="disk-view__erase">
            <button
              class="btn-text btn-text--danger"
              disabled={!!eraseBlocked()}
              title={eraseBlocked()}
              data-testid="erase-this-disk"
              onClick={() => openErase('erase')}
            >
              Erase this disk…
            </button>
          </div>
        </Show>
      </Show>

      <Show when={dialog()}>
        {(d) => (
          <EraseDialog
            targetId={props.diskId}
            engineId={engineId()!}
            fallbackLabel={disk()?.name ?? props.diskId}
            mode={d().mode}
            shareName={d().shareName}
            store={props.store}
            commandLogStore={props.commandLogStore}
            onClose={() => {
              setDialog(null);
              props.onClearFilesError?.();
            }}
            onErasedEmpty={(id) => {
              setDialog(null);
              props.onSelect?.({ type: 'disk', id });
            }}
            onBecameFiles={(id) => {
              setDialog(null);
              props.onSelect?.({ type: 'disk', id });
            }}
            onFilesFailed={(id, msg) => {
              setDialog(null);
              if (props.onFilesFailed) props.onFilesFailed(id, msg);
              else props.onSelect?.({ type: 'disk', id });
            }}
          />
        )}
      </Show>
    </section>
  );
};

export default DiskView;
