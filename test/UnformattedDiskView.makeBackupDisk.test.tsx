/**
 * idea#404 — UnformattedDiskView "Make a Backup Disk" + EraseDialog confirm,
 * progress and failure wording, gated on the makeBackupDisk capability.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import UnformattedDiskView from '../src/components/UnformattedDiskView';
import { setSendCommandFn } from '../src/store/commands';
import { MAKE_BACKUP_DISK_BLANK_CONFIRM, MAKE_BACKUP_DISK_ERROR_TEXT } from '../src/store/makeBackupDisk';
import { MOCK_FILES_STORE, FILES_IDS as I } from '../src/mock/filesFixtures';
import { UNREADABLE_SUMMARY } from '../src/mock/eraseFixtures';
import type { CommandLogState } from '../src/store/commandLog';
import type { CommandLogStore, CommandTrace } from '../src/types/commandLog';
import type { Engine, Operation, Store } from '../src/types/store';

const CAND = I.CAND_INTENSO;
const LABEL = 'Intenso 32 GB';

const log = (...t: CommandTrace[]): CommandLogStore => ({
  traces: Object.fromEntries(t.map((x) => [x.traceId, x])),
  recentTraceIds: t.map((x) => x.traceId),
});

const summariseOk = (over: Partial<CommandTrace> = {}): CommandTrace => ({
  traceId: 'sum-mb',
  command: 'summariseDisk',
  args: { targetId: CAND },
  startedAt: 1,
  completedAt: 2,
  status: 'ok',
  errorMessage: null,
  logs: [],
  result: JSON.stringify(UNREADABLE_SUMMARY({ label: LABEL, targetId: CAND })),
  ...over,
});

const mbTrace = (over: Partial<CommandTrace> = {}): CommandTrace => ({
  traceId: 'mb-1',
  command: 'makeBackupDisk',
  args: { candidateId: CAND },
  startedAt: 3,
  completedAt: 4,
  status: 'ok',
  errorMessage: null,
  logs: [],
  ...over,
});

const withFlag = (store: Store, extra: string[] = ['makeBackupDisk']): Store => {
  const eng = store.engineDB[I.ENGINE_A] as Engine;
  return {
    ...store,
    engineDB: {
      ...store.engineDB,
      [I.ENGINE_A]: {
        ...eng,
        capabilities: [...(eng.capabilities ?? []), ...extra],
        capabilitiesBootedAt: eng.lastBooted,
      },
    },
  };
};

describe('UnformattedDiskView — Make a Backup Disk (idea#404)', () => {
  let sent: ReturnType<typeof vi.fn>;
  beforeEach(() => { sent = vi.fn(); setSendCommandFn(sent); });
  afterEach(() => cleanup());

  const renderView = (store: Store) => {
    const [s, setStore] = createSignal<Store | null>(store);
    const [cls, setCls] = createSignal<CommandLogState>(log());
    const onSelect = vi.fn();
    const utils = render(() => (
      <UnformattedDiskView
        engineId={I.ENGINE_A}
        candidateId={CAND}
        store={s}
        commandLogStore={cls}
        onSelect={onSelect}
      />
    ));
    return { ...utils, setStore, setCls, onSelect, store: s };
  };

  const confirmBlank = (t: ReturnType<typeof renderView>) => {
    fireEvent.click(screen.getByTestId('make-backup-disk-unformatted'));
    t.setCls(log(summariseOk()));
    const input = screen.getByTestId('erase-confirm-name') as HTMLInputElement;
    fireEvent.input(input, { target: { value: LABEL } });
    fireEvent.click(screen.getByRole('button', { name: /erase and make a backup disk/i }));
  };

  it('capability off: no Make a Backup Disk action; Files and Erase stay as they are', () => {
    renderView(MOCK_FILES_STORE);
    expect(screen.queryByTestId('make-backup-disk-unformatted')).not.toBeInTheDocument();
    expect(screen.getByText('Make this a Files Disk')).toBeInTheDocument();
    expect(screen.getByText('Erase this disk…')).toBeInTheDocument();
  });

  it('capability on: shows Make a Backup Disk and does not grey it out by size', () => {
    renderView(withFlag(MOCK_FILES_STORE));
    const btn = screen.getByTestId('make-backup-disk-unformatted') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Make a Backup Disk');
  });

  it('capability on: typed confirm names the stick, warns it erases, then sends makeBackupDisk not eraseDisk', () => {
    const t = renderView(withFlag(MOCK_FILES_STORE));
    fireEvent.click(screen.getByTestId('make-backup-disk-unformatted'));
    expect(sent).toHaveBeenCalledWith(I.ENGINE_A, `summariseDisk ${CAND}`);
    t.setCls(log(summariseOk()));
    expect(screen.getByTestId('make-backup-disk-dialog').textContent).toContain(`Make a Backup Disk from ${LABEL}?`);
    expect(screen.getByTestId('make-backup-disk-blank-confirm').textContent).toContain(MAKE_BACKUP_DISK_BLANK_CONFIRM);
    expect(screen.getByText(/erases everything on the disk/i)).toBeInTheDocument();
    const input = screen.getByTestId('erase-confirm-name') as HTMLInputElement;
    const ok = screen.getByRole('button', { name: /erase and make a backup disk/i }) as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    fireEvent.input(input, { target: { value: LABEL } });
    expect(ok.disabled).toBe(false);
    fireEvent.click(ok);
    expect(sent).toHaveBeenCalledWith(I.ENGINE_A, `makeBackupDisk ${CAND}`);
    expect(sent.mock.calls.some(([, cmd]) => String(cmd).startsWith('eraseDisk '))).toBe(false);
  });

  it('capability on: progress shows Check, Erase, Re-dock, Create from the Operation', () => {
    const t = renderView(withFlag(MOCK_FILES_STORE));
    confirmBlank(t);
    const running: Operation = {
      id: 'op-mb',
      kind: 'makeBackupDisk',
      args: { candidateId: CAND },
      cause: 'console-command',
      subject: { type: 'disk', id: CAND },
      engineId: I.ENGINE_A,
      status: 'Running',
      progressPercent: 40,
      currentStep: 2,
      totalSteps: 4,
      stepLabel: 'Erase',
      startedAt: Date.now(),
      completedAt: null,
      error: null,
    };
    t.setStore({ ...t.store()!, operationDB: { [running.id]: running } });
    const progress = screen.getByTestId('make-backup-disk-progress');
    expect(progress.textContent).toContain('Checking the stick');
    expect(progress.textContent).toContain('Erasing the disk');
    expect(progress.textContent).toContain('Waiting for the disk to come back');
    expect(progress.textContent).toContain('Setting up the Backup Disk');
    expect(progress.querySelector('[data-step="Erase"]')?.className).toMatch(/current/);
  });

  it('capability on: success when the trace is ok and the disk has the backup role', () => {
    const t = renderView(withFlag(MOCK_FILES_STORE));
    confirmBlank(t);
    t.setStore({
      ...t.store()!,
      diskDB: {
        ...t.store()!.diskDB,
        [CAND]: {
          id: CAND,
          name: LABEL,
          device: 'sdi',
          created: 1,
          lastDocked: 1,
          dockedTo: I.ENGINE_A,
          diskTypes: ['backup'],
          backupConfig: { mode: 'scheduled', links: [] },
        },
      },
    });
    t.setCls(log(summariseOk(), mbTrace({ status: 'ok', completedAt: Date.now() })));
    expect(screen.getByTestId('make-backup-disk-success').textContent).toMatch(/this disk is now a backup disk/i);
  });

  it.each([
    ['TOO_SMALL: 4 GB min', MAKE_BACKUP_DISK_ERROR_TEXT.TOO_SMALL],
    ['NOT_DOCKED: gone', MAKE_BACKUP_DISK_ERROR_TEXT.NOT_DOCKED],
    ['SYSTEM_DISK: root', MAKE_BACKUP_DISK_ERROR_TEXT.SYSTEM_DISK],
    ['NOT_EMPTY: files', MAKE_BACKUP_DISK_ERROR_TEXT.NOT_EMPTY],
    ['UNKNOWN: boom', MAKE_BACKUP_DISK_ERROR_TEXT.UNKNOWN],
  ] as const)('capability on: maps %s to plain wording', (errorMessage, wording) => {
    const t = renderView(withFlag(MOCK_FILES_STORE));
    confirmBlank(t);
    t.setCls(log(summariseOk(), mbTrace({ status: 'error', errorMessage, completedAt: Date.now() })));
    const err = screen.getByRole('alert');
    expect(err.textContent).toBe(wording);
    expect(err.textContent).not.toMatch(/TOO_SMALL|NOT_DOCKED|SYSTEM_DISK|NOT_EMPTY|UNKNOWN|borg|YAML|helper/i);
  });
});
