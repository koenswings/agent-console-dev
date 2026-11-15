/**
 * idea#404 — UnformattedDiskView "Make a Backup Disk" + EraseDialog confirm,
 * progress and failure wording, gated on the makeBackupDisk capability.
 * Coded to Engine bc5bd78 (agent-engine-dev#355): the blank-stick path sends
 * makeBackupDisk <candidateId> <summaryTraceId> <typed label>.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import UnformattedDiskView from '../src/components/UnformattedDiskView';
import { setSendCommandFn } from '../src/store/commands';
import {
  MAKE_BACKUP_DISK_BLANK_CONFIRM,
  MAKE_BACKUP_DISK_ERROR_TEXT,
  MAKE_BACKUP_DISK_SUCCESS_HINT,
} from '../src/store/makeBackupDisk';
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
  args: { targetId: CAND, rest: ['sum-mb', ...LABEL.split(' ')] },
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

  it('capability on: typed confirm names the stick, warns it erases, then sends makeBackupDisk with the summary and label (not eraseDisk)', () => {
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
    expect(sent).toHaveBeenCalledWith(I.ENGINE_A, `makeBackupDisk ${CAND} sum-mb ${LABEL}`);
    expect(sent.mock.calls.some(([, cmd]) => String(cmd).startsWith('eraseDisk '))).toBe(false);
  });

  it('capability on: progress shows Check, Erase, Re-dock, Create from the Operation', () => {
    const t = renderView(withFlag(MOCK_FILES_STORE));
    confirmBlank(t);
    const running: Operation = {
      id: 'op-mb',
      kind: 'makeBackupDisk',
      args: { targetId: CAND, summaryTraceId: 'sum-mb', confirmName: LABEL },
      cause: 'console-command',
      subject: { type: 'disk', id: CAND },
      engineId: I.ENGINE_A,
      status: 'Running',
      progressPercent: 25,
      currentStep: 1,
      totalSteps: 4,
      stepLabel: 'Erase',
      startedAt: Date.now(),
      completedAt: null,
      error: null,
    };
    t.setStore({ ...t.store()!, operationDB: { [running.id]: running } });
    const progress = screen.getByTestId('make-backup-disk-progress');
    expect(progress.textContent).toContain('Checking the disk');
    expect(progress.textContent).toContain('Erasing the disk');
    expect(progress.textContent).toContain('Waiting for the disk to come back');
    expect(progress.textContent).toContain('Setting up the Backup Disk');
    expect(progress.querySelector('[data-step="Erase"]')?.className).toMatch(/current/);
    expect(progress.querySelector('[data-step="Check"]')?.className).toMatch(/done/);
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
          backupConfig: { mode: 'scheduled', links: [], schedule: { daily: '02:30' } },
        },
      },
    });
    t.setCls(log(summariseOk(), mbTrace({ status: 'ok', completedAt: Date.now() })));
    const ok = screen.getByTestId('make-backup-disk-success').textContent ?? '';
    expect(ok).toMatch(/this disk is now a backup disk/i);
    expect(ok).toContain(MAKE_BACKUP_DISK_SUCCESS_HINT);
  });

  it.each([
    ['TOO_SMALL', 'TOO_SMALL: this disk is 4000000000 bytes; a Backup Disk must be at least 8589934592 bytes (8 GiB).'],
    ['UNPLUGGED', 'UNPLUGGED: the disk was unplugged during setup; plug it back in and try again'],
    ['REDOCK_TIMEOUT', 'REDOCK_TIMEOUT: Erase finished but the disk did not come back as empty (id X).'],
    ['SUMMARY_STALE', 'SUMMARY_STALE: The summary is missing, for another disk, or older than 10 minutes. Check the disk again.'],
    ['CONFIRM_MISMATCH', "CONFIRM_MISMATCH: Typed name does not match the disk label 'X'."],
    ['SYSTEM_DISK', "SYSTEM_DISK: X is this Pi's system disk and cannot become a Backup Disk."],
    ['BUSY', 'BUSY: An erase is already in progress; try again later.'],
    ['WRITE_FAILED', 'WRITE_FAILED: EIO'],
  ] as const)('capability on: maps %s to plain wording', (code, errorMessage) => {
    const t = renderView(withFlag(MOCK_FILES_STORE));
    confirmBlank(t);
    t.setCls(log(summariseOk(), mbTrace({ status: 'error', errorMessage, errorCode: code, completedAt: Date.now() })));
    const err = screen.getByRole('alert');
    expect(err.textContent).toBe(MAKE_BACKUP_DISK_ERROR_TEXT[code]);
    expect(err.textContent).not.toMatch(/[A-Z]{3,}_[A-Z]+|borg|YAML|helper/i);
  });

  describe('size gate (Engine 8 GiB minimum, unformattedDisks[].sizeBytes)', () => {
    const GIB = 1024 * 1024 * 1024;
    const sized = (sizeBytes: number): Store => {
      const store = withFlag(MOCK_FILES_STORE);
      const eng = store.engineDB[I.ENGINE_A] as Engine;
      return {
        ...store,
        engineDB: {
          ...store.engineDB,
          [I.ENGINE_A]: {
            ...eng,
            unformattedDisks: (eng.unformattedDisks ?? []).map((u) => (u.candidateId === CAND ? { ...u, sizeBytes } : u)),
          },
        },
      };
    };

    it('under 8 GiB: greyed out with the plain reason; no summariseDisk is sent', () => {
      renderView(sized(4 * GIB));
      const btn = screen.getByTestId('make-backup-disk-unformatted') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(btn.title).toBe('Too small: needs 8 GB or more');
      expect(screen.getByTestId('make-backup-disk-unformatted-hint').textContent?.trim()).toBe('Too small: needs 8 GB or more');
      fireEvent.click(btn);
      expect(screen.queryByTestId('make-backup-disk-dialog')).not.toBeInTheDocument();
      expect(sent).not.toHaveBeenCalled();
    });

    it('exactly 8 GiB: allowed', () => {
      renderView(sized(8 * GIB));
      expect((screen.getByTestId('make-backup-disk-unformatted') as HTMLButtonElement).disabled).toBe(false);
    });

    it('over 8 GiB: allowed, normal hint', () => {
      renderView(sized(8 * GIB + 1));
      expect((screen.getByTestId('make-backup-disk-unformatted') as HTMLButtonElement).disabled).toBe(false);
      expect(screen.getByTestId('make-backup-disk-unformatted-hint').textContent).toMatch(/Erases this stick/);
    });

    it('unknown size (0): allowed, the Engine decides', () => {
      renderView(sized(0));
      expect((screen.getByTestId('make-backup-disk-unformatted') as HTMLButtonElement).disabled).toBe(false);
    });
  });
});

