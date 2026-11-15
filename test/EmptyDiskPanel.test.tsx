import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import EmptyDiskPanel from '../src/components/EmptyDiskPanel';
import { setSendCommandFn } from '../src/store/commands';
import { MOCK_STORE, MOCK_IDS } from '../src/mock/mockStore';
import { BACKUP_DISK_TOO_SMALL_MIN } from '../src/store/backupDiskSizeGate';
import type { Disk, Instance, Store } from '../src/types/store';

afterEach(() => cleanup());

const emptyDisk: Disk = {
  id: MOCK_IDS.DISK_5_ID,
  name: 'empty-disk',
  device: 'sde',
  created: 0,
  lastDocked: 0,
  dockedTo: MOCK_IDS.ENGINE_1_ID,
  diskTypes: ['empty'],
  backupConfig: null,
};

const renderPanel = () =>
  render(() => (
    <EmptyDiskPanel
      disk={() => emptyDisk}
      store={() => MOCK_STORE}
      engineId={() => MOCK_IDS.ENGINE_1_ID}
    />
  ));

describe('EmptyDiskPanel', () => {
  it('renders the disk name', () => {
    renderPanel();
    expect(screen.getByText('empty-disk')).toBeInTheDocument();
  });

  it('shows the three options; Files is greyed out without the filesDisk flag', () => {
    renderPanel();
    expect(screen.getByText('Make this a Backup Disk')).toBeInTheDocument();
    const files = screen.getByText('Make this a Files Disk').closest('button')!;
    expect(files).toBeDisabled();
    expect(files.getAttribute('title')).toBe('Update this Engine to manage this disk');
    expect(screen.getByText('Install App')).toBeInTheDocument();
  });

  it('navigates to backup configuration on click', () => {
    renderPanel();
    fireEvent.click(screen.getByText('Make this a Backup Disk'));
    expect(screen.getByText('Backup mode')).toBeInTheDocument();
    expect(screen.getByText('Link to instances')).toBeInTheDocument();
  });

  it('shows backup mode options', () => {
    renderPanel();
    fireEvent.click(screen.getByText('Make this a Backup Disk'));
    expect(screen.getByText('On demand')).toBeInTheDocument();
    expect(screen.getByText('Immediate')).toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
  });

  it('shows instances from the store', () => {
    renderPanel();
    fireEvent.click(screen.getByText('Make this a Backup Disk'));
    // Mock store has several instances; at least kolibri should appear
    expect(screen.getByText('kolibri')).toBeInTheDocument();
  });

  it('shows error when submitting backup with no instances selected', () => {
    renderPanel();
    fireEvent.click(screen.getByText('Make this a Backup Disk'));
    fireEvent.click(screen.getByRole('button', { name: /configure backup disk/i }));
    expect(screen.getByText(/at least one/i)).toBeInTheDocument();
  });

  it('dispatches createBackupDisk command when form is submitted with an instance', () => {
    const mock = vi.fn();
    setSendCommandFn(mock);
    renderPanel();
    fireEvent.click(screen.getByText('Make this a Backup Disk'));
    // Select the kolibri instance checkbox
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByRole('button', { name: /configure backup disk/i }));
    expect(mock).toHaveBeenCalledOnce();
    const [engineId, cmd] = mock.mock.calls[0];
    expect(engineId).toBe(MOCK_IDS.ENGINE_1_ID);
    // ENGINE_1 is a 0b Engine (fresh 'diskIdArgs') → disk ID (idea#129)
    expect(cmd).toMatch(new RegExp(`^createBackupDisk ${MOCK_IDS.DISK_5_ID} on-demand `));
  });

  it('shows waiting state after backup submission until the Engine answers (idea#122)', () => {
    const mock = vi.fn();
    setSendCommandFn(mock);
    renderPanel();
    fireEvent.click(screen.getByText('Make this a Backup Disk'));
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByRole('button', { name: /configure backup disk/i }));
    // No longer claims success on send — waits for the createBackupDisk trace.
    expect(screen.queryByText(/command sent/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('backup-pending')).toHaveTextContent(/waiting for the engine/i);
  });


  it('navigates to install dialog for Install App', () => {
    renderPanel();
    // The card title and the panel heading are both 'Install App'
    const installCards = screen.getAllByText('Install App');
    fireEvent.click(installCards[0]);
    // After clicking, the install form should show app list
    expect(screen.getAllByText('Install App').length).toBeGreaterThan(0);
  });

  it('shows apps from the store in the install dialog', () => {
    renderPanel();
    const installCards = screen.getAllByText('Install App');
    fireEvent.click(installCards[0]);
    // Mock store has kolibri, nextcloud, wikipedia, etc.
    expect(screen.getByText('Kolibri Learning Platform')).toBeInTheDocument();
  });

  it('dispatches installApp command when an app is selected and Install clicked', () => {
    const mock = vi.fn();
    setSendCommandFn(mock);
    renderPanel();
    const installCards = screen.getAllByText('Install App');
    fireEvent.click(installCards[0]);
    // Select the first radio
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[0]);
    fireEvent.click(screen.getByRole('button', { name: /^install app$/i }));
    expect(mock).toHaveBeenCalledOnce();
    const [engineId, cmd] = mock.mock.calls[0];
    expect(engineId).toBe(MOCK_IDS.ENGINE_1_ID);
    expect(cmd).toMatch(new RegExp(`^installApp \\S+ ${MOCK_IDS.DISK_5_ID}( |$)`));
  });

  it('Install button is disabled when no app is selected', () => {
    renderPanel();
    const installCards = screen.getAllByText('Install App');
    fireEvent.click(installCards[0]);
    const installBtn = screen.getByRole('button', { name: /^install app$/i });
    expect(installBtn).toBeDisabled();
  });

  it('Back button in backup form returns to menu', () => {
    renderPanel();
    fireEvent.click(screen.getByText('Make this a Backup Disk'));
    fireEvent.click(screen.getByRole('button', { name: /← Back/i }));
    // Back at menu
    expect(screen.getByText('What would you like to do with this disk?')).toBeInTheDocument();
  });

  it('shows how much App data this Pi holds on the Backup Disk form (engine#441)', () => {
    const store: Store = {
      ...MOCK_STORE,
      instanceDB: {
        ...MOCK_STORE.instanceDB,
        [MOCK_IDS.INST_KOLIBRI_ID]: {
          ...MOCK_STORE.instanceDB[MOCK_IDS.INST_KOLIBRI_ID],
          dataBytes: 2_000_000_000,
        },
        [MOCK_IDS.INST_CHANNEL_BUILDER_ID]: {
          ...MOCK_STORE.instanceDB[MOCK_IDS.INST_CHANNEL_BUILDER_ID],
          dataBytes: null,
        },
      },
    };
    render(() => (
      <EmptyDiskPanel
        disk={() => emptyDisk}
        store={() => store}
        engineId={() => MOCK_IDS.ENGINE_1_ID}
      />
    ));
    fireEvent.click(screen.getByText('Make this a Backup Disk'));
    expect(screen.getByTestId('backup-sizing')).toHaveTextContent(
      "This Pi's Apps use about 2.0 GB (1 App not measured yet)",
    );
  });
});


const GB = 1_000_000_000;
const GIB = 1024 * 1024 * 1024;

const diskWithSize = (sizeBytes: number | null): Disk => ({ ...emptyDisk, sizeBytes });

const storeWithData = (over: Record<string, Partial<Instance>>): Store => ({
  ...MOCK_STORE,
  instanceDB: Object.fromEntries(
    Object.entries(MOCK_STORE.instanceDB).map(([id, inst]) => [
      id,
      { ...inst, ...(over[id] ?? {}) } as Instance,
    ]),
  ),
});

const renderSized = (sizeBytes: number | null, store: Store = MOCK_STORE) =>
  render(() => (
    <EmptyDiskPanel
      disk={() => diskWithSize(sizeBytes)}
      store={() => store}
      engineId={() => MOCK_IDS.ENGINE_1_ID}
    />
  ));

describe('EmptyDiskPanel — Backup Disk size gate (console#219)', () => {
  afterEach(() => cleanup());

  it('disables Configure when the ticked Apps need more than 1.5× the disk, and enables it again on a larger disk or a smaller selection', () => {
    const mock = vi.fn();
    setSendCommandFn(mock);
    const store = storeWithData({
      [MOCK_IDS.INST_KOLIBRI_ID]: { dataBytes: 12 * GB },
    });
    const { unmount } = renderSized(16 * GB, store);
    fireEvent.click(screen.getByText('Make this a Backup Disk'));
    fireEvent.click(screen.getByTestId(`backup-link-instance-${MOCK_IDS.INST_KOLIBRI_ID}`));
    const btn = screen.getByTestId('configure-backup-disk') as HTMLButtonElement;
    expect(btn).toBeDisabled();
    expect(screen.getByTestId('backup-disk-size-block')).toHaveTextContent(
      'This disk is too small for the Apps you chose. They use about 12 GB, so the Backup Disk needs about 18 GB. Choose a larger disk.',
    );
    fireEvent.click(btn);
    expect(mock).not.toHaveBeenCalled();
    unmount();

    renderSized(20 * GB, store);
    fireEvent.click(screen.getByText('Make this a Backup Disk'));
    fireEvent.click(screen.getByTestId(`backup-link-instance-${MOCK_IDS.INST_KOLIBRI_ID}`));
    expect(screen.getByTestId('configure-backup-disk')).not.toBeDisabled();
    expect(screen.queryByTestId('backup-disk-size-block')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('configure-backup-disk'));
    expect(mock).toHaveBeenCalledOnce();
  });

  it('warns and leaves Configure enabled when the chosen Apps have not been measured', () => {
    const mock = vi.fn();
    setSendCommandFn(mock);
    renderSized(32 * GB, storeWithData({ [MOCK_IDS.INST_KOLIBRI_ID]: { dataBytes: null } }));
    fireEvent.click(screen.getByText('Make this a Backup Disk'));
    fireEvent.click(screen.getByTestId(`backup-link-instance-${MOCK_IDS.INST_KOLIBRI_ID}`));
    expect(screen.getByTestId('configure-backup-disk')).not.toBeDisabled();
    expect(screen.getByTestId('backup-disk-size-warn')).toHaveTextContent(
      "The Apps you chose haven't been measured yet, so we can't check whether this disk is big enough. You can continue, or wait until the sizes appear.",
    );
    fireEvent.click(screen.getByTestId('configure-backup-disk'));
    expect(mock).toHaveBeenCalledOnce();
  });

  it('blocks a disk under 8 GiB even when no App has been measured', () => {
    renderSized(8 * GIB - 1, storeWithData({ [MOCK_IDS.INST_KOLIBRI_ID]: { dataBytes: null } }));
    fireEvent.click(screen.getByText('Make this a Backup Disk'));
    expect(screen.getByTestId('configure-backup-disk')).toBeDisabled();
    expect(screen.getByTestId('backup-disk-size-block')).toHaveTextContent(BACKUP_DISK_TOO_SMALL_MIN);
    expect(screen.queryByTestId('backup-disk-size-warn')).not.toBeInTheDocument();
  });
});
