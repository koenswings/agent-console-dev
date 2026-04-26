import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import RestorePanel from '../components/RestorePanel';
import { setSendCommandFn } from '../store/commands';
import { MOCK_STORE, MOCK_IDS } from '../mock/mockStore';
import type { Disk, Store, Operation } from '../types/store';

const backupDisk: Disk = MOCK_STORE.diskDB[MOCK_IDS.DISK_4_ID];

const renderPanel = (opts?: { store?: Store; disk?: Disk }) =>
  render(() => (
    <RestorePanel
      disk={() => opts?.disk ?? backupDisk}
      store={() => opts?.store ?? MOCK_STORE}
      engineId={() => MOCK_IDS.ENGINE_1_ID}
    />
  ));

describe('RestorePanel', () => {
  it('renders linked instances from backupConfig.links', () => {
    renderPanel();
    // backupDisk links to kolibri-inst-001 → name 'kolibri'
    expect(screen.getByText('kolibri')).toBeInTheDocument();
  });

  it('shows the disk name and Backup Disk badge', () => {
    renderPanel();
    expect(screen.getByText('backup-disk')).toBeInTheDocument();
    expect(screen.getByText('Backup Disk')).toBeInTheDocument();
  });

  it('shows the backup mode', () => {
    renderPanel();
    // backupDisk mode is 'on-demand' → label 'On demand'
    expect(screen.getByText('On demand')).toBeInTheDocument();
  });

  it('shows "No apps configured" when links is empty', () => {
    const emptyLinksDisk: Disk = {
      ...backupDisk,
      backupConfig: { mode: 'on-demand', links: [] },
    };
    renderPanel({ disk: emptyLinksDisk });
    expect(screen.getByText(/no apps configured for backup on this disk/i)).toBeInTheDocument();
  });

  it('shows "no backup configuration" when backupConfig is null', () => {
    const noBcDisk: Disk = { ...backupDisk, backupConfig: null };
    renderPanel({ disk: noBcDisk });
    expect(screen.getByText(/this disk has no backup configuration/i)).toBeInTheDocument();
  });

  it('Restore button is disabled when instance is locked', () => {
    const op: Operation = {
      id: 'op-1',
      kind: 'restoreApp',
      args: { instanceId: MOCK_IDS.INST_KOLIBRI_ID },
      engineId: MOCK_IDS.ENGINE_1_ID,
      status: 'Running',
      progressPercent: null,
      startedAt: Date.now(),
      completedAt: null,
      error: null,
    };
    const lockedStore: Store = { ...MOCK_STORE, operationDB: { 'op-1': op } };
    renderPanel({ store: lockedStore });
    const btn = screen.getByRole('button', { name: /operation in progress/i });
    expect(btn).toBeDisabled();
  });

  it('clicking Restore to… opens the target disk picker', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /restore to/i }));
    // Should now show the target disk picker heading
    expect(screen.getByText(/restore/i, { selector: 'h3' })).toBeInTheDocument();
    // Should have radio options for target disks
    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBeGreaterThan(0);
  });

  it('selecting target disk + clicking Restore calls sendCommand with correct args', () => {
    const mock = vi.fn();
    setSendCommandFn(mock);
    renderPanel();
    // Click "Restore to…" for kolibri
    fireEvent.click(screen.getByRole('button', { name: /restore to/i }));
    // Select first radio — kolibri-disk (first app disk in MOCK_STORE)
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[0]);
    // Click Restore
    fireEvent.click(screen.getByRole('button', { name: /^restore$/i }));
    expect(mock).toHaveBeenCalledOnce();
    const [engineId, cmd] = mock.mock.calls[0];
    expect(engineId).toBe(MOCK_IDS.ENGINE_1_ID);
    expect(cmd).toBe('restoreApp kolibri kolibri-disk');
  });

  it('Restore button in picker is disabled until a target disk is selected', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /restore to/i }));
    const restoreBtn = screen.getByRole('button', { name: /^restore$/i });
    expect(restoreBtn).toBeDisabled();
  });

  it('shows success state after restore is submitted', () => {
    const mock = vi.fn();
    setSendCommandFn(mock);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /restore to/i }));
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[0]);
    fireEvent.click(screen.getByRole('button', { name: /^restore$/i }));
    expect(screen.getByText(/restore command sent/i)).toBeInTheDocument();
  });

  it('Cancel in picker returns to instance list', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /restore to/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.getByText('kolibri')).toBeInTheDocument();
  });
});
