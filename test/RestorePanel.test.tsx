import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import RestorePanel from '../src/components/RestorePanel';
import { setSendCommandFn } from '../src/store/commands';
import { MOCK_STORE, MOCK_IDS } from '../src/mock/mockStore';
import type { Disk, Store, Operation } from '../src/types/store';

const backupDisk: Disk = MOCK_STORE.diskDB[MOCK_IDS.DISK_4_ID];

const renderPanel = (opts?: { store?: Store; disk?: Disk }) =>
  render(() => (
    <RestorePanel
      disk={() => opts?.disk ?? backupDisk}
      store={() => opts?.store ?? MOCK_STORE}
      engineId={() => MOCK_IDS.ENGINE_1_ID}
    />
  ));

/** Select the first real target disk option (skips the placeholder). */
const selectFirstTargetDisk = () => {
  const select = screen.getByRole('combobox') as HTMLSelectElement;
  const option = Array.from(select.options).find((o) => o.value !== '');
  if (!option) throw new Error('No target disk options');
  fireEvent.change(select, { target: { value: option.value } });
  return option;
};

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

  it('shows empty copy when links is empty', () => {
    const emptyLinksDisk: Disk = {
      ...backupDisk,
      backupConfig: { mode: 'on-demand', links: [] },
    };
    renderPanel({ disk: emptyLinksDisk });
    expect(screen.getByText(/no instances backed up to this disk yet/i)).toBeInTheDocument();
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
      cause: 'console-command' as const,
      subject: { type: 'instance' as const, id: MOCK_IDS.INST_KOLIBRI_ID },
      engineId: MOCK_IDS.ENGINE_1_ID,
      status: 'Running',
      progressPercent: null,
      currentStep: null,
      totalSteps: null,
      stepLabel: null,
      startedAt: Date.now(),
      completedAt: null,
      error: null,
    };
    const lockedStore: Store = { ...MOCK_STORE, operationDB: { 'op-1': op } };
    renderPanel({ store: lockedStore });
    const btn = screen.getByRole('button', { name: /operation in progress/i });
    expect(btn).toBeDisabled();
  });

  it('Restore button is disabled until a target disk is selected', () => {
    renderPanel();
    const restoreBtn = screen.getByRole('button', { name: /^restore$/i });
    expect(restoreBtn).toBeDisabled();
    selectFirstTargetDisk();
    expect(screen.getByRole('button', { name: /^restore$/i })).not.toBeDisabled();
  });

  it('clicking Restore opens inline Confirm Restore / Cancel', () => {
    renderPanel();
    selectFirstTargetDisk();
    fireEvent.click(screen.getByRole('button', { name: /^restore$/i }));
    expect(screen.getByRole('button', { name: /confirm restore/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByText(/are you sure/i)).toBeInTheDocument();
  });

  it('Confirm Restore calls sendCommand with correct args', () => {
    const mock = vi.fn();
    setSendCommandFn(mock);
    renderPanel();
    const option = selectFirstTargetDisk();
    fireEvent.click(screen.getByRole('button', { name: /^restore$/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm restore/i }));
    expect(mock).toHaveBeenCalledOnce();
    const [engineId, cmd] = mock.mock.calls[0];
    expect(engineId).toBe(MOCK_IDS.ENGINE_1_ID);
    expect(cmd).toBe(`restoreApp kolibri ${option.textContent}`);
  });

  it('after Confirm Restore, confirmation UI is dismissed', () => {
    const mock = vi.fn();
    setSendCommandFn(mock);
    renderPanel();
    selectFirstTargetDisk();
    fireEvent.click(screen.getByRole('button', { name: /^restore$/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm restore/i }));
    expect(screen.queryByRole('button', { name: /confirm restore/i })).not.toBeInTheDocument();
    expect(screen.getByText('kolibri')).toBeInTheDocument();
    // Selection cleared → Restore disabled again
    expect(screen.getByRole('button', { name: /^restore$/i })).toBeDisabled();
  });

  it('Cancel in confirmation returns to instance list', () => {
    renderPanel();
    selectFirstTargetDisk();
    fireEvent.click(screen.getByRole('button', { name: /^restore$/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('button', { name: /confirm restore/i })).not.toBeInTheDocument();
    expect(screen.getByText('kolibri')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^restore$/i })).toBeInTheDocument();
  });
});
