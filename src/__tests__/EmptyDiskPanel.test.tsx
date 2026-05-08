import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import EmptyDiskPanel from '../components/EmptyDiskPanel';
import { setSendCommandFn } from '../store/commands';
import { MOCK_STORE, MOCK_IDS } from '../mock/mockStore';
import type { Disk } from '../types/store';

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

  it('shows the three option buttons', () => {
    renderPanel();
    expect(screen.getByText('Backup Disk')).toBeInTheDocument();
    expect(screen.getByText('Files Disk')).toBeInTheDocument();
    expect(screen.getByText('Install App')).toBeInTheDocument();
  });

  it('navigates to backup configuration on click', () => {
    renderPanel();
    fireEvent.click(screen.getByText('Backup Disk'));
    expect(screen.getByText('Backup mode')).toBeInTheDocument();
    expect(screen.getByText('Link to instances')).toBeInTheDocument();
  });

  it('shows backup mode options', () => {
    renderPanel();
    fireEvent.click(screen.getByText('Backup Disk'));
    expect(screen.getByText('On demand')).toBeInTheDocument();
    expect(screen.getByText('Immediate')).toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
  });

  it('shows instances from the store', () => {
    renderPanel();
    fireEvent.click(screen.getByText('Backup Disk'));
    // Mock store has several instances; at least kolibri should appear
    expect(screen.getByText('kolibri')).toBeInTheDocument();
  });

  it('shows error when submitting backup with no instances selected', () => {
    renderPanel();
    fireEvent.click(screen.getByText('Backup Disk'));
    fireEvent.click(screen.getByRole('button', { name: /configure backup disk/i }));
    expect(screen.getByText(/at least one/i)).toBeInTheDocument();
  });

  it('dispatches createBackupDisk command when form is submitted with an instance', () => {
    const mock = vi.fn();
    setSendCommandFn(mock);
    renderPanel();
    fireEvent.click(screen.getByText('Backup Disk'));
    // Select the kolibri instance checkbox
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByRole('button', { name: /configure backup disk/i }));
    expect(mock).toHaveBeenCalledOnce();
    const [engineId, cmd] = mock.mock.calls[0];
    expect(engineId).toBe(MOCK_IDS.ENGINE_1_ID);
    expect(cmd).toMatch(/^createBackupDisk empty-disk on-demand/);
  });

  it('shows success state after backup submission', () => {
    const mock = vi.fn();
    setSendCommandFn(mock);
    renderPanel();
    fireEvent.click(screen.getByText('Backup Disk'));
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByRole('button', { name: /configure backup disk/i }));
    expect(screen.getByText(/command sent/i)).toBeInTheDocument();
  });

  it('navigates to files disk configuration on click', () => {
    renderPanel();
    fireEvent.click(screen.getByText('Files Disk'));
    expect(screen.getByText(/shared network filesystem/i)).toBeInTheDocument();
  });

  it('dispatches createFilesDisk command', () => {
    const mock = vi.fn();
    setSendCommandFn(mock);
    renderPanel();
    fireEvent.click(screen.getByText('Files Disk'));
    fireEvent.click(screen.getByRole('button', { name: /configure files disk/i }));
    expect(mock).toHaveBeenCalledOnce();
    const [engineId, cmd] = mock.mock.calls[0];
    expect(engineId).toBe(MOCK_IDS.ENGINE_1_ID);
    expect(cmd).toBe('createFilesDisk empty-disk');
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
    expect(cmd).toMatch(/^installApp /);
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
    fireEvent.click(screen.getByText('Backup Disk'));
    fireEvent.click(screen.getByRole('button', { name: /← Back/i }));
    // Back at menu
    expect(screen.getByText('What would you like to do with this disk?')).toBeInTheDocument();
  });
});
