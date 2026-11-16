/**
 * agent-console-dev#209 — DiskView "Make this also a Backup Disk" on an App or
 * Files disk: flag gating, confirm copy, same-disk warning, size grey-out,
 * command shape, progress, success and refusal wording, cross-Engine send.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import DiskView from '../src/components/DiskView';
import { setSendCommandFn } from '../src/store/commands';
import {
  ADOPT_BACKUP_DISK_KEEP,
  ADOPT_BACKUP_DISK_SAME_DISK_WARNING,
  ADOPT_BACKUP_DISK_SCHEDULE,
  ADOPT_BACKUP_DISK_SUCCESS_HINT,
  ADOPT_BACKUP_DISK_SUCCESS_MESSAGE,
  ADOPT_BACKUP_DISK_TOO_SMALL_REASON,
} from '../src/store/adoptBackupDisk';
import { MAKE_BACKUP_DISK_ERROR_TEXT } from '../src/store/makeBackupDisk';
import { MOCK_FILES_STORE, FILES_IDS as I } from '../src/mock/filesFixtures';
import { noteConnectedEngine } from '../src/store/connectedEngine';
import type { CommandLogState } from '../src/store/commandLog';
import type { CommandLogStore, CommandTrace } from '../src/types/commandLog';
import type { Disk, Engine, Operation, Store } from '../src/types/store';

const GIB = 1024 * 1024 * 1024;

const withFlag = (s: Store, engineId: string, fresh = true): Store => {
  const eng = s.engineDB[engineId] as Engine;
  return {
    ...s,
    engineDB: {
      ...s.engineDB,
      [engineId]: {
        ...eng,
        capabilities: [...(eng.capabilities ?? []), 'makeBackupDisk'],
        capabilitiesBootedAt: fresh ? eng.lastBooted : (eng.lastBooted ?? 1) - 10_000,
      },
    },
  };
};
const withDisk = (s: Store, id: string, patch: Partial<Disk>): Store => ({
  ...s,
  diskDB: { ...s.diskDB, [id]: { ...s.diskDB[id], ...patch } },
});
const ON = withFlag(MOCK_FILES_STORE, I.ENGINE_A);

const log = (...t: CommandTrace[]): CommandLogStore => ({
  traces: Object.fromEntries(t.map((x) => [x.traceId, x])),
  recentTraceIds: t.map((x) => x.traceId),
});
const mbTrace = (diskId: string, over: Partial<CommandTrace> = {}): CommandTrace => ({
  traceId: 'mb-209',
  command: 'makeBackupDisk',
  args: { targetId: diskId, rest: [] },
  startedAt: 1,
  completedAt: 2,
  status: 'ok',
  errorMessage: null,
  logs: [],
  ...over,
});

const renderView = (diskId: string, initial: Store = ON) => {
  const [store, setStore] = createSignal<Store | null>(initial);
  const [cls, setCls] = createSignal<CommandLogState>({ traces: {}, recentTraceIds: [] });
  const utils = render(() => <DiskView diskId={diskId} store={store} commandLogStore={cls} />);
  return { ...utils, store, setStore, setCls };
};

let sent: ReturnType<typeof vi.fn>;
beforeEach(() => {
  noteConnectedEngine(I.ENGINE_A);
  sent = vi.fn();
  setSendCommandFn(sent);
});
afterEach(() => cleanup());

const openConfirm = () => fireEvent.click(screen.getByTestId('adopt-backup-disk'));

describe('DiskView — Make this also a Backup Disk (#209): offer', () => {
  it('flag on: shown on an App Disk and on a Files Disk', () => {
    renderView(I.FA_APP);
    expect(screen.getByTestId('adopt-backup-disk').textContent).toBe('Make this also a Backup Disk');
    cleanup();
    renderView(I.FA_FILES);
    expect(screen.getByTestId('adopt-backup-disk')).not.toBeDisabled();
  });

  it('flag absent or stale: hidden', () => {
    renderView(I.FA_APP, MOCK_FILES_STORE);
    expect(screen.queryByTestId('adopt-backup-disk')).not.toBeInTheDocument();
    cleanup();
    renderView(I.FA_APP, withFlag(MOCK_FILES_STORE, I.ENGINE_A, false));
    expect(screen.queryByTestId('adopt-backup-disk')).not.toBeInTheDocument();
  });

  it('already a Backup Disk: hidden', () => {
    renderView(I.FA_ABF);
    expect(screen.queryByTestId('adopt-backup-disk')).not.toBeInTheDocument();
  });
});

describe('DiskView — #209: confirm', () => {
  it('names the disk, says nothing is erased, every App on this Pi; same-disk warning when it holds instances', () => {
    renderView(I.FA_APP);
    openConfirm();
    const c = screen.getByTestId('adopt-backup-disk-confirm').textContent ?? '';
    expect(c).toContain('Make Kolibri Disk also a Backup Disk?');
    expect(c).toContain(ADOPT_BACKUP_DISK_KEEP);
    expect(c).toContain(ADOPT_BACKUP_DISK_SCHEDULE);
    expect(c).toContain('for every App on this Pi');
    expect(screen.getByTestId('adopt-backup-disk-same-disk').textContent).toBe(ADOPT_BACKUP_DISK_SAME_DISK_WARNING);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('Files Disk without instances: no same-disk warning', () => {
    renderView(I.FA_FILES);
    openConfirm();
    expect(screen.getByTestId('adopt-backup-disk-confirm')).toBeInTheDocument();
    expect(screen.queryByTestId('adopt-backup-disk-same-disk')).not.toBeInTheDocument();
  });

  it('sends exactly makeBackupDisk <diskId> to the docked Engine; never eraseDisk or summariseDisk', () => {
    renderView(I.FA_APP);
    openConfirm();
    fireEvent.click(screen.getByTestId('confirm-adopt-backup-disk'));
    expect(sent).toHaveBeenCalledOnce();
    expect(sent).toHaveBeenCalledWith(I.ENGINE_A, `makeBackupDisk ${I.FA_APP}`);
    expect(sent.mock.calls.flat().join(' ')).not.toMatch(/eraseDisk|summariseDisk/);
  });

  it('a disk docked to another Engine: sent to that Engine (dockedTo)', () => {
    const s = withFlag(MOCK_FILES_STORE, I.ENGINE_B);
    renderView(I.FB_APP, s);
    openConfirm();
    fireEvent.click(screen.getByTestId('confirm-adopt-backup-disk'));
    expect(sent).toHaveBeenCalledWith(I.ENGINE_B, `makeBackupDisk ${I.FB_APP}`);
    expect(screen.getByTestId('adopt-backup-disk-sent').textContent).toContain('files-b');
  });

  it('Cancel closes the confirm without sending', () => {
    renderView(I.FA_APP);
    openConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('adopt-backup-disk-confirm')).not.toBeInTheDocument();
    expect(sent).not.toHaveBeenCalled();
  });
});

describe('DiskView — #209: size gate', () => {
  it.each([
    ['under 8 GiB', 8 * GIB - 1, true],
    ['exactly 8 GiB', 8 * GIB, false],
    ['over 8 GiB', 64 * GIB, false],
    ['unknown', null, false],
  ] as const)('%s', (_name, size, greyed) => {
    renderView(I.FA_APP, withDisk(ON, I.FA_APP, { sizeBytes: size }));
    const btn = screen.getByTestId('adopt-backup-disk') as HTMLButtonElement;
    expect(btn.disabled).toBe(greyed);
    if (greyed) {
      expect(btn.title).toBe('Too small: needs more than 8 GB. Choose a disk larger than all the App data on this Pi.');
      expect(screen.getByTestId('adopt-backup-disk-blocked').textContent).toBe(ADOPT_BACKUP_DISK_TOO_SMALL_REASON);
    } else {
      expect(screen.queryByTestId('adopt-backup-disk-blocked')).not.toBeInTheDocument();
    }
  });
});

describe('DiskView — #209: progress and result', () => {
  it('progress shows Check → Create from the Operation (Erase / Re-dock skipped)', () => {
    const t = renderView(I.FA_APP);
    openConfirm();
    fireEvent.click(screen.getByTestId('confirm-adopt-backup-disk'));
    const running: Operation = {
      id: 'op-209',
      kind: 'makeBackupDisk',
      args: { targetId: I.FA_APP },
      cause: 'console-command',
      subject: { type: 'disk', id: I.FA_APP },
      engineId: I.ENGINE_A,
      status: 'Running',
      progressPercent: 50,
      currentStep: 2,
      totalSteps: 4,
      stepLabel: 'Re-dock (skipped)',
      startedAt: Date.now(),
      completedAt: null,
      error: null,
    };
    t.setStore({ ...t.store()!, operationDB: { [running.id]: running } });
    const p = screen.getByTestId('make-backup-disk-progress');
    expect(p.querySelector('[data-step="Erase"]')).toBeNull();
    expect(p.querySelector('[data-step="Re-dock"]')).toBeNull();
    expect(p.querySelector('[data-step="Check"]')?.className).toMatch(/done/);
    expect(p.querySelector('[data-step="Create"]')?.className).toMatch(/current/);
  });

  it('trace ok alone is not success; ok + backup role is, and all roles and instances stay', () => {
    const t = renderView(I.FA_APP);
    openConfirm();
    fireEvent.click(screen.getByTestId('confirm-adopt-backup-disk'));
    t.setCls(log(mbTrace(I.FA_APP, { completedAt: Date.now() })));
    expect(screen.queryByTestId('adopt-backup-disk-success')).not.toBeInTheDocument();
    t.setStore(withDisk(t.store()!, I.FA_APP, { diskTypes: ['app', 'backup'] }));
    const ok = screen.getByTestId('adopt-backup-disk-success');
    expect(ok.textContent).toContain(ADOPT_BACKUP_DISK_SUCCESS_MESSAGE);
    expect(screen.getByTestId('adopt-backup-disk-success-hint').textContent).toBe(ADOPT_BACKUP_DISK_SUCCESS_HINT);
    expect(ADOPT_BACKUP_DISK_SUCCESS_HINT).toContain('Apps pause for a moment while a backup runs.');
    expect(ADOPT_BACKUP_DISK_SUCCESS_HINT).toContain('every App on this Pi');
    const badges = Array.from(document.querySelectorAll('.disk-view__header [data-role]')).map((b) => b.getAttribute('data-role'));
    expect(badges).toEqual(['app', 'backup']);
    expect(t.store()!.instanceDB[I.INST_KOLIBRI_A].status).toBe('Running');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('adopt-backup-disk')).not.toBeInTheDocument();
  });

  it.each([
    ['ALREADY_BACKUP: X is already a Backup Disk; use setBackupMode to change mode or time.', MAKE_BACKUP_DISK_ERROR_TEXT.ALREADY_BACKUP],
    ['BUSY: try again later: a backup is running on this disk', MAKE_BACKUP_DISK_ERROR_TEXT.BUSY],
    ['TOO_SMALL: this disk is 2000000000 bytes; a Backup Disk must be at least 8589934592 bytes (8 GiB).', ADOPT_BACKUP_DISK_TOO_SMALL_REASON],
    ["NOT_DOCKED: Disk 'X' (X) is not docked to this Engine.", MAKE_BACKUP_DISK_ERROR_TEXT.NOT_DOCKED],
  ] as const)('refusal %s → plain sentence', (errorMessage, text) => {
    const t = renderView(I.FA_APP);
    openConfirm();
    fireEvent.click(screen.getByTestId('confirm-adopt-backup-disk'));
    t.setCls(log(mbTrace(I.FA_APP, { status: 'error', errorMessage, completedAt: Date.now() })));
    const err = screen.getByTestId('adopt-backup-disk-error');
    expect(err.textContent).toBe(text);
    expect(err.textContent).not.toMatch(/[A-Z]{3,}_[A-Z]+|borg|YAML|helper|setBackupMode/i);
  });
});

describe('DiskView — Make this also a Backup Disk (#209): App data against free space', () => {
  const DEC_GB = 1_000_000_000;
  const appsOn = (freeBytes: number | null, dataBytes: number | null): Store => ({
    ...withDisk(ON, I.FA_APP, { sizeBytes: 500 * GIB, freeBytes }),
    instanceDB: {
      x: { ...Object.values(ON.instanceDB)[0], id: 'x', storedOn: I.FA_FILES, dataBytes, demo: false, backupMethod: 'stop' },
    } as unknown as Store['instanceDB'],
  });

  it('greyed out when the other Apps do not fit in the free space', () => {
    renderView(I.FA_APP, appsOn(10 * GIB, 12 * DEC_GB));
    const btn = screen.getByTestId('adopt-backup-disk') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByTestId('adopt-backup-disk-blocked').textContent).toBe(
      "This disk is too small for this Pi's Apps. They use about 12 GB, so the Backup Disk needs about 18 GB. Choose a larger disk.",
    );
    expect(sent).not.toHaveBeenCalled();
  });

  it('unknown free space: allowed, with a calm warning on the confirm', () => {
    renderView(I.FA_APP, appsOn(null, 12 * DEC_GB));
    openConfirm();
    expect(screen.getByTestId('adopt-backup-disk-size-warn').textContent).toMatch(/free space isn't known yet/);
    expect(screen.getByTestId('confirm-adopt-backup-disk')).not.toBeDisabled();
  });

  it('enough free space: no size warning', () => {
    renderView(I.FA_APP, appsOn(100 * GIB, 12 * DEC_GB));
    openConfirm();
    expect(screen.queryByTestId('adopt-backup-disk-size-warn')).not.toBeInTheDocument();
  });
});
