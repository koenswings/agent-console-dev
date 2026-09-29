/**
 * DiskView — right pane for a selected disk that isn't in the Empty disk
 * state (files-disk.md §8, idea#132). A header with one badge per role in
 * fixed order, then one section per role: Apps (instances), Backups (restore)
 * and Files. On a disk with Apps or backups that isn't a Files Disk yet it
 * offers "Add Files to this disk", greyed out unless the Engine advertises a
 * fresh 'filesDisk' capability.
 */
import { Show, createMemo, createSignal, type Accessor, type Component } from 'solid-js';
import InstanceList from './InstanceList';
import RestorePanel from './RestorePanel';
import FilesSection from './FilesSection';
import FilesRoleForm from './FilesRoleForm';
import RoleBadges from './RoleBadges';
import { UPDATE_ENGINE_TOOLTIP, engineHasCapability } from '../store/commands';
import { canAddFiles, hasAppRole } from '../store/diskRoles';
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
}

/** Text of the Add Files confirmation (files-disk.md §4). */
export const ADD_FILES_CONFIRMATION =
  'Nothing on this disk is changed. Your Apps and backups stay as they are, and the disk also becomes a shared file store.';

const DiskView: Component<DiskViewProps> = (props) => {
  const disk = () => props.store()?.diskDB[props.diskId] as Disk | undefined;
  const engineId = () => (disk()?.dockedTo ? String(disk()!.dockedTo) : undefined);
  const types = () => disk()?.diskTypes ?? [];

  const showApps = createMemo(() => { const d = disk(); return !!d && hasAppRole(d, props.store()); });
  const showBackups = createMemo(() => types().includes('backup'));
  const showFiles = createMemo(() => types().includes('files'));
  const noRoleSection = () => !showApps() && !showBackups() && !showFiles();
  const offerAddFiles = createMemo(() => { const d = disk(); return !!d && canAddFiles(d, props.store()); });

  const filesBlocked = createMemo((): string | undefined => {
    const id = engineId();
    const engine = id ? props.store()?.engineDB[id] : undefined;
    return engineHasCapability(engine, 'filesDisk') ? undefined : UPDATE_ENGINE_TOOLTIP;
  });

  const [addFilesOpen, setAddFilesOpen] = createSignal(false);
  const selection = (): Selection => ({ type: 'disk', id: props.diskId });

  return (
    <section class="disk-view" aria-label="Disk">
      <header class="disk-view__header">
        <span class="disk-view__icon" aria-hidden="true">💾</span>
        <span class="disk-view__title">{disk()?.name ?? props.diskId}</span>
        <span class="disk-view__badges">
          <RoleBadges disk={disk} store={props.store} />
        </span>
      </header>

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
            />
            <div class="edp-form__actions">
              <button class="btn" onClick={() => setAddFilesOpen(false)}>Close</button>
            </div>
          </Show>
        </section>
      </Show>
    </section>
  );
};

export default DiskView;
