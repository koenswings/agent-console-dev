/**
 * idea#404 — EmptyDiskPanel makeBackupDisk confirm (capability on) vs the
 * existing createBackupDisk form (capability off).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import EmptyDiskPanel from '../src/components/EmptyDiskPanel';
import { setSendCommandFn } from '../src/store/commands';
import { MAKE_BACKUP_DISK_EMPTY_CONFIRM, MAKE_BACKUP_DISK_ERROR_TEXT } from '../src/store/makeBackupDisk';
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
  args: { diskId: emptyDisk.id },
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

  it('capability on: simple confirm (02:30, apps linked afterwards), no mode or instance picker, no size greying', () => {
    const store = withFlag(MOCK_STORE, [...(MOCK_STORE.engineDB[MOCK_IDS.ENGINE_1_ID].capabilities ?? []), 'makeBackupDisk']);
    renderPanel(store);
    const card = screen.getByTestId('make-backup-disk') as HTMLButtonElement;
    expect(card.disabled).toBe(false);
    expect(card.textContent).toContain('Back up every App daily at 02:30');
    fireEvent.click(card);
    expect(screen.getByTestId('make-backup-disk-confirm').textContent).toContain(MAKE_BACKUP_DISK_EMPTY_CONFIRM);
    expect(screen.queryByText('Backup mode')).not.toBeInTheDocument();
    expect(screen.queryByText('Link to instances')).not.toBeInTheDocument();
    // 2 GB stick is still enabled — Engine owns TOO_SMALL
    expect(screen.getByTestId('confirm-make-backup-disk')).not.toBeDisabled();
  });

  it('capability on: confirm sends makeBackupDisk <diskId>', () => {
    const store = withFlag(MOCK_STORE, [...(MOCK_STORE.engineDB[MOCK_IDS.ENGINE_1_ID].capabilities ?? []), 'makeBackupDisk']);
    renderPanel(store);
    fireEvent.click(screen.getByTestId('make-backup-disk'));
    fireEvent.click(screen.getByTestId('confirm-make-backup-disk'));
    expect(sent).toHaveBeenCalledWith(MOCK_IDS.ENGINE_1_ID, `makeBackupDisk ${emptyDisk.id}`);
  });

  it('capability on: shows Check / Create progress (Erase skipped) from the Operation', () => {
    const store = withFlag(MOCK_STORE, [...(MOCK_STORE.engineDB[MOCK_IDS.ENGINE_1_ID].capabilities ?? []), 'makeBackupDisk']);
    const t = renderPanel(store);
    fireEvent.click(screen.getByTestId('make-backup-disk'));
    fireEvent.click(screen.getByTestId('confirm-make-backup-disk'));
    const running: Operation = {
      id: 'op-mb',
      kind: 'makeBackupDisk',
      args: { diskId: emptyDisk.id },
      cause: 'console-command',
      subject: { type: 'disk', id: emptyDisk.id },
      engineId: MOCK_IDS.ENGINE_1_ID,
      status: 'Running',
      progressPercent: 20,
      currentStep: 1,
      totalSteps: 3,
      stepLabel: 'Check',
      startedAt: Date.now(),
      completedAt: null,
      error: null,
    };
    t.setStore({ ...t.store()!, operationDB: { [running.id]: running } });
    const progress = screen.getByTestId('make-backup-disk-progress');
    expect(progress.textContent).toContain('Checking the stick');
    expect(progress.textContent).toContain('Setting up the Backup Disk');
    expect(progress.querySelector('[data-step="Erase"]')).toBeNull();
    expect(progress.querySelector('[data-step="Check"]')).not.toBeNull();
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
  });

  it.each([
    ['TOO_SMALL: 4 GB min', MAKE_BACKUP_DISK_ERROR_TEXT.TOO_SMALL],
    ['NOT_DOCKED: gone', MAKE_BACKUP_DISK_ERROR_TEXT.NOT_DOCKED],
    ['SYSTEM_DISK: root', MAKE_BACKUP_DISK_ERROR_TEXT.SYSTEM_DISK],
    ['NOT_EMPTY: files', MAKE_BACKUP_DISK_ERROR_TEXT.NOT_EMPTY],
    ['UNKNOWN: boom', MAKE_BACKUP_DISK_ERROR_TEXT.UNKNOWN],
  ] as const)('capability on: maps %s to plain wording', (errorMessage, wording) => {
    const store = withFlag(MOCK_STORE, [...(MOCK_STORE.engineDB[MOCK_IDS.ENGINE_1_ID].capabilities ?? []), 'makeBackupDisk']);
    const t = renderPanel(store);
    fireEvent.click(screen.getByTestId('make-backup-disk'));
    fireEvent.click(screen.getByTestId('confirm-make-backup-disk'));
    t.setCls(log(mbTrace({ status: 'error', errorMessage, completedAt: Date.now() })));
    const err = screen.getByTestId('backup-error');
    expect(err.textContent).toBe(wording);
    expect(err.textContent).not.toMatch(/TOO_SMALL|NOT_DOCKED|SYSTEM_DISK|NOT_EMPTY|UNKNOWN|borg|YAML|helper/i);
  });
});
