/**
 * idea#404 — EmptyDiskPanel makeBackupDisk confirm (capability on) vs the
 * existing createBackupDisk form (capability off).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import EmptyDiskPanel from '../src/components/EmptyDiskPanel';
import { setSendCommandFn } from '../src/store/commands';
import {
  MAKE_BACKUP_DISK_EMPTY_CONFIRM,
  MAKE_BACKUP_DISK_ERROR_TEXT,
  MAKE_BACKUP_DISK_SUCCESS_HINT,
} from '../src/store/makeBackupDisk';
import { MOCK_STORE, MOCK_IDS } from '../src/mock/mockStore';
import type { CommandLogState } from '../src/store/commandLog';
import type { CommandLogStore, CommandTrace } from '../src/types/commandLog';
import type { Disk, Engine, Operation, Store } from '../src/types/store';

const emptyDisk: Disk = {
  id: MOCK_IDS.DISK_5_ID,
  name: 'empty-disk',
  device: 'sde',
  created: 0,
  lastDocked: 0,
  dockedTo: MOCK_IDS.ENGINE_1_ID,
  diskTypes: ['empty'],
  backupConfig: null,
  sizeBytes: 2 * 1024 * 1024 * 1024,
};

const log = (...t: CommandTrace[]): CommandLogStore => ({
  traces: Object.fromEntries(t.map((x) => [x.traceId, x])),
  recentTraceIds: t.map((x) => x.traceId),
});

const mbTrace = (over: Partial<CommandTrace> = {}): CommandTrace => ({
  traceId: 'mb-1',
  command: 'makeBackupDisk',
  args: { targetId: emptyDisk.id, rest: [] },
  startedAt: 1,
  completedAt: 2,
  status: 'ok',
  errorMessage: null,
  logs: [],
  ...over,
});

const withFlag = (store: Store, caps: string[]): Store => {
  const eng = store.engineDB[MOCK_IDS.ENGINE_1_ID] as Engine;
  return {
    ...store,
    engineDB: {
      ...store.engineDB,
      [MOCK_IDS.ENGINE_1_ID]: {
        ...eng,
        capabilities: caps,
        capabilitiesBootedAt: eng.lastBooted,
      },
    },
  };
};

describe('EmptyDiskPanel — makeBackupDisk (idea#404)', () => {
  let sent: ReturnType<typeof vi.fn>;
  beforeEach(() => { sent = vi.fn(); setSendCommandFn(sent); });
  afterEach(() => cleanup());

  const renderPanel = (store: Store, cls: CommandLogState = { traces: {}, recentTraceIds: [] }) => {
    const [s, setStore] = createSignal<Store | null>(store);
    const [logState, setCls] = createSignal<CommandLogState>(cls);
    const utils = render(() => (
      <EmptyDiskPanel
        disk={() => s()?.diskDB[emptyDisk.id] ?? emptyDisk}
        store={s}
        engineId={() => MOCK_IDS.ENGINE_1_ID}
        commandLogStore={logState}
      />
    ));
    return { ...utils, setStore, setCls, store: s };
  };

  it('capability off: keeps the createBackupDisk form and does not send makeBackupDisk', () => {
    renderPanel(MOCK_STORE);
    fireEvent.click(screen.getByTestId('make-backup-disk'));
    expect(screen.getByText('Backup mode')).toBeInTheDocument();
    expect(screen.getByText('Link to instances')).toBeInTheDocument();
    expect(screen.queryByTestId('make-backup-disk-confirm')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: /configure backup disk/i }));
    expect(sent).toHaveBeenCalledOnce();
    expect(sent.mock.calls[0][1]).toMatch(new RegExp(`^createBackupDisk ${emptyDisk.id} on-demand `));
  });

  it('stale makeBackupDisk flag (capabilitiesBootedAt !== lastBooted) keeps the old form', () => {
    const eng = MOCK_STORE.engineDB[MOCK_IDS.ENGINE_1_ID] as Engine;
    const store: Store = {
      ...MOCK_STORE,
      engineDB: {
        ...MOCK_STORE.engineDB,
        [MOCK_IDS.ENGINE_1_ID]: {
          ...eng,
          capabilities: [...(eng.capabilities ?? []), 'makeBackupDisk'],
          capabilitiesBootedAt: (eng.lastBooted ?? 1) - 10_000,
        },
      },
    };
    renderPanel(store);
    fireEvent.click(screen.getByTestId('make-backup-disk'));
    expect(screen.getByText('Backup mode')).toBeInTheDocument();
    expect(screen.queryByTestId('confirm-make-backup-disk')).not.toBeInTheDocument();
  });

  it('capability on: simple confirm naming the disk (nothing erased, 02:30), no mode or instance picker, no size greying', () => {
    const store = withFlag(MOCK_STORE, [...(MOCK_STORE.engineDB[MOCK_IDS.ENGINE_1_ID].capabilities ?? []), 'makeBackupDisk']);
    renderPanel(store);
    const card = screen.getByTestId('make-backup-disk') as HTMLButtonElement;
    expect(card.disabled).toBe(false);
    expect(card.textContent).toContain('Daily backups at 02:30, nothing erased');
    fireEvent.click(card);
    const confirm = screen.getByTestId('make-backup-disk-confirm').textContent ?? '';
    expect(confirm).toContain(MAKE_BACKUP_DISK_EMPTY_CONFIRM);
    expect(confirm).toContain(`Make ${emptyDisk.name} a Backup Disk?`);
    expect(screen.queryByText('Backup mode')).not.toBeInTheDocument();
    expect(screen.queryByText('Link to instances')).not.toBeInTheDocument();
    // MOCK_STORE's empty disk has no sizeBytes: unknown size is left to the Engine
    expect(screen.getByTestId('confirm-make-backup-disk')).not.toBeDisabled();
  });

  it('capability on: confirm sends makeBackupDisk <diskId> with no summary or typed label (Erase skipped)', () => {
    const store = withFlag(MOCK_STORE, [...(MOCK_STORE.engineDB[MOCK_IDS.ENGINE_1_ID].capabilities ?? []), 'makeBackupDisk']);
    renderPanel(store);
    fireEvent.click(screen.getByTestId('make-backup-disk'));
    fireEvent.click(screen.getByTestId('confirm-make-backup-disk'));
    expect(sent).toHaveBeenCalledWith(MOCK_IDS.ENGINE_1_ID, `makeBackupDisk ${emptyDisk.id}`);
  });

  it('capability on: shows Check / Create progress (Erase and Re-dock skipped) from the Operation', () => {
    const store = withFlag(MOCK_STORE, [...(MOCK_STORE.engineDB[MOCK_IDS.ENGINE_1_ID].capabilities ?? []), 'makeBackupDisk']);
    const t = renderPanel(store);
    fireEvent.click(screen.getByTestId('make-backup-disk'));
    fireEvent.click(screen.getByTestId('confirm-make-backup-disk'));
    const running: Operation = {
      id: 'op-mb',
      kind: 'makeBackupDisk',
      args: { targetId: emptyDisk.id },
      cause: 'console-command',
      subject: { type: 'disk', id: emptyDisk.id },
      engineId: MOCK_IDS.ENGINE_1_ID,
      status: 'Running',
      progressPercent: 25,
      currentStep: 1,
      totalSteps: 4,
      stepLabel: 'Erase (skipped)',
      startedAt: Date.now(),
      completedAt: null,
      error: null,
    };
    t.setStore({ ...t.store()!, operationDB: { [running.id]: running } });
    const progress = screen.getByTestId('make-backup-disk-progress');
    expect(progress.textContent).toContain('Checking the disk');
    expect(progress.textContent).toContain('Setting up the Backup Disk');
    expect(progress.querySelector('[data-step="Erase"]')).toBeNull();
    expect(progress.querySelector('[data-step="Re-dock"]')).toBeNull();
    expect(progress.querySelector('[data-step="Check"]')?.className).toMatch(/done/);
    expect(progress.querySelector('[data-step="Create"]')?.className).toMatch(/current/);
  });

  it('capability on: success when the trace is ok and diskTypes includes backup', () => {
    const store = withFlag(MOCK_STORE, [...(MOCK_STORE.engineDB[MOCK_IDS.ENGINE_1_ID].capabilities ?? []), 'makeBackupDisk']);
    const t = renderPanel(store);
    fireEvent.click(screen.getByTestId('make-backup-disk'));
    fireEvent.click(screen.getByTestId('confirm-make-backup-disk'));
    t.setStore({
      ...t.store()!,
      diskDB: {
        ...t.store()!.diskDB,
        [emptyDisk.id]: { ...emptyDisk, diskTypes: ['backup'] },
      },
    });
    t.setCls(log(mbTrace({ status: 'ok', completedAt: Date.now() })));
    expect(screen.getByTestId('backup-configured-success').textContent).toMatch(/this disk is now a backup disk/i);
    expect(screen.getByTestId('make-backup-disk-success-hint').textContent).toBe(MAKE_BACKUP_DISK_SUCCESS_HINT);
  });

  it.each([
    ['TOO_SMALL: this disk is 2000000000 bytes; a Backup Disk must be at least 8589934592 bytes (8 GiB).', MAKE_BACKUP_DISK_ERROR_TEXT.TOO_SMALL],
    ["NOT_DOCKED: Disk 'X' (X) is not docked to this Engine.", MAKE_BACKUP_DISK_ERROR_TEXT.NOT_DOCKED],
    ["SYSTEM_DISK: X is this Pi's system disk and cannot become a Backup Disk.", MAKE_BACKUP_DISK_ERROR_TEXT.SYSTEM_DISK],
    ['ALREADY_BACKUP: X is already a Backup Disk; use setBackupMode to change mode or time.', MAKE_BACKUP_DISK_ERROR_TEXT.ALREADY_BACKUP],
    ['WRITE_FAILED: EACCES', MAKE_BACKUP_DISK_ERROR_TEXT.WRITE_FAILED],
  ] as const)('capability on: maps %s to plain wording', (errorMessage, wording) => {
    const store = withFlag(MOCK_STORE, [...(MOCK_STORE.engineDB[MOCK_IDS.ENGINE_1_ID].capabilities ?? []), 'makeBackupDisk']);
    const t = renderPanel(store);
    fireEvent.click(screen.getByTestId('make-backup-disk'));
    fireEvent.click(screen.getByTestId('confirm-make-backup-disk'));
    t.setCls(log(mbTrace({ status: 'error', errorMessage, completedAt: Date.now() })));
    const err = screen.getByTestId('backup-error');
    expect(err.textContent).toBe(wording);
    expect(err.textContent).not.toMatch(/[A-Z]{3,}_[A-Z]+|borg|YAML|helper|setBackupMode/i);
  });

  describe('size gate (Engine 8 GiB minimum, Disk.sizeBytes)', () => {
    const GIB = 1024 * 1024 * 1024;
    const sized = (sizeBytes: number | null | undefined): Store => {
      const base = withFlag(MOCK_STORE, [...(MOCK_STORE.engineDB[MOCK_IDS.ENGINE_1_ID].capabilities ?? []), 'makeBackupDisk']);
      return { ...base, diskDB: { ...base.diskDB, [emptyDisk.id]: { ...emptyDisk, sizeBytes } } };
    };

    it('under 8 GiB: card greyed out with the plain reason, before anything is typed', () => {
      renderPanel(sized(8 * GIB - 1));
      const card = screen.getByTestId('make-backup-disk') as HTMLButtonElement;
      expect(card.disabled).toBe(true);
      expect(card.title).toBe('Too small: needs more than 8 GB. Choose a disk larger than all the App data on this Pi.');
      expect(screen.getByTestId('make-backup-disk-desc').textContent).toBe('Too small: needs more than 8 GB. Choose a disk larger than all the App data on this Pi.');
      fireEvent.click(card);
      expect(screen.queryByTestId('make-backup-disk-confirm')).not.toBeInTheDocument();
      expect(sent).not.toHaveBeenCalled();
    });

    it('exactly 8 GiB: allowed (the Engine refuses only below the limit)', () => {
      renderPanel(sized(8 * GIB));
      expect(screen.getByTestId('make-backup-disk')).not.toBeDisabled();
    });

    it('over 8 GiB: allowed', () => {
      renderPanel(sized(32 * GIB));
      expect(screen.getByTestId('make-backup-disk')).not.toBeDisabled();
      expect(screen.getByTestId('make-backup-disk-desc').textContent).toBe('Daily backups at 02:30, nothing erased');
    });

    it('unknown size (null): allowed, the Engine decides', () => {
      renderPanel(sized(null));
      expect(screen.getByTestId('make-backup-disk')).not.toBeDisabled();
    });

    it('capability off: a small disk keeps the old createBackupDisk card enabled', () => {
      renderPanel({ ...MOCK_STORE, diskDB: { ...MOCK_STORE.diskDB, [emptyDisk.id]: { ...emptyDisk, sizeBytes: 2 * GIB } } });
      expect(screen.getByTestId('make-backup-disk')).not.toBeDisabled();
    });
  });
});
