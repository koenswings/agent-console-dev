import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import BackupModeControls from '../src/components/BackupModeControls';
import RestorePanel from '../src/components/RestorePanel';
import { setSendCommandFn } from '../src/store/commands';
import {
  DEFAULT_BACKUP_TIME,
  SCHEDULED_BACKUPS_CAPABILITY,
  SCHEDULE_ERROR_COPY,
  SET_BACKUP_MODE_ERROR_TEXT,
  SET_BACKUP_MODE_TIMEOUT_MESSAGE,
} from '../src/store/setBackupMode';
import { MOCK_STORE, MOCK_IDS } from '../src/mock/mockStore';
import type { CommandLogState } from '../src/store/commandLog';
import type { CommandLogStore, CommandTrace } from '../src/types/commandLog';
import type { Disk, Engine, Store } from '../src/types/store';

const backupDisk: Disk = MOCK_STORE.diskDB[MOCK_IDS.DISK_4_ID];

const withFlag = (engine: Engine, caps: string[], bootedAt?: number): Engine => ({
  ...engine,
  capabilities: [...(engine.capabilities ?? []).filter((c) => c !== SCHEDULED_BACKUPS_CAPABILITY), ...caps],
  capabilitiesBootedAt: bootedAt ?? engine.lastBooted,
});

const flaggedStore = (over: { disk?: Partial<Disk>; engine?: Engine } = {}): Store => {
  const engine = over.engine ?? withFlag(MOCK_STORE.engineDB[MOCK_IDS.ENGINE_1_ID], [SCHEDULED_BACKUPS_CAPABILITY]);
  const disk: Disk = { ...backupDisk, ...over.disk };
  return {
    ...MOCK_STORE,
    engineDB: { ...MOCK_STORE.engineDB, [engine.id]: engine },
    diskDB: { ...MOCK_STORE.diskDB, [disk.id]: disk },
  };
};

const trace = (over: Partial<CommandTrace> = {}): CommandTrace => ({
  traceId: 't-sbm',
  command: 'setBackupMode',
  args: { backupDiskId: backupDisk.id, mode: 'scheduled', time: ['07:15'] },
  startedAt: 0,
  completedAt: 1,
  status: 'ok',
  errorMessage: null,
  logs: [],
  ...over,
});

const log = (...traces: CommandTrace[]): CommandLogStore => ({
  traces: Object.fromEntries(traces.map((t) => [t.traceId, t])),
  recentTraceIds: traces.map((t) => t.traceId),
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setSendCommandFn(() => {});
});

const renderControls = (opts?: {
  store?: Store;
  disk?: Disk;
  log?: CommandLogState;
  setLog?: (cls: CommandLogState) => void;
}) => {
  const store = opts?.store ?? flaggedStore();
  const disk = opts?.disk ?? store.diskDB[backupDisk.id];
  const [cls, setCls] = createSignal<CommandLogState>(opts?.log ?? { traces: {}, recentTraceIds: [] });
  const setLog = (next: CommandLogState) => {
    setCls(next);
    opts?.setLog?.(next);
  };
  const sent: { engineId: string; command: string }[] = [];
  setSendCommandFn((engineId, command) => { sent.push({ engineId, command }); });
  const view = render(() => (
    <BackupModeControls
      disk={() => store.diskDB[disk.id] ?? disk}
      store={() => store}
      engineId={() => disk.dockedTo ?? MOCK_IDS.ENGINE_1_ID}
      commandLogStore={cls}
    />
  ));
  return { ...view, store, disk, setCls: setLog, sent, cls };
};

describe('BackupModeControls — capability gate', () => {
  it('is hidden when the Engine has no scheduledBackups flag', () => {
    render(() => (
      <BackupModeControls
        disk={() => backupDisk}
        store={() => MOCK_STORE}
        engineId={() => MOCK_IDS.ENGINE_1_ID}
      />
    ));
    expect(screen.queryByTestId('backup-mode-controls')).not.toBeInTheDocument();
  });

  it('is hidden when the flag is stale (rolled back)', () => {
    const engine = withFlag(
      MOCK_STORE.engineDB[MOCK_IDS.ENGINE_1_ID],
      [SCHEDULED_BACKUPS_CAPABILITY],
      MOCK_STORE.engineDB[MOCK_IDS.ENGINE_1_ID].lastBooted - 1,
    );
    render(() => (
      <BackupModeControls
        disk={() => backupDisk}
        store={() => flaggedStore({ engine })}
        engineId={() => MOCK_IDS.ENGINE_1_ID}
      />
    ));
    expect(screen.queryByTestId('backup-mode-controls')).not.toBeInTheDocument();
  });

  it('RestorePanel without the flag is unchanged: no controls, still the mode badge', () => {
    render(() => (
      <RestorePanel
        disk={() => backupDisk}
        store={() => MOCK_STORE}
        engineId={() => MOCK_IDS.ENGINE_1_ID}
      />
    ));
    expect(screen.queryByTestId('backup-mode-controls')).not.toBeInTheDocument();
    expect(screen.getByText('On demand')).toBeInTheDocument();
    expect(screen.getByText('Backup Disk')).toBeInTheDocument();
  });
});

describe('BackupModeControls — flag on', () => {
  it('shows the three modes, with the current backupConfig mode selected, and no time field for on-demand', () => {
    renderControls();
    expect(screen.getByTestId('backup-mode-controls')).toBeInTheDocument();
    const onDemand = screen.getByTestId('backup-mode-on-demand').querySelector('input') as HTMLInputElement;
    expect(onDemand.checked).toBe(true);
    expect(screen.queryByTestId('backup-mode-time')).not.toBeInTheDocument();
    expect(screen.getByTestId('backup-mode-save')).toBeDisabled();
  });

  it('shows the time field when Scheduled is chosen, prefilled with the stored daily time or 02:30', () => {
    const store = flaggedStore({
      disk: { backupConfig: { mode: 'scheduled', links: backupDisk.backupConfig!.links, schedule: { daily: '07:15' } } },
    });
    renderControls({ store });
    const scheduled = screen.getByTestId('backup-mode-scheduled').querySelector('input') as HTMLInputElement;
    expect(scheduled.checked).toBe(true);
    expect((screen.getByTestId('backup-mode-time') as HTMLInputElement).value).toBe('07:15');
    expect(screen.getByTestId('backup-mode-save')).toBeDisabled();
  });

  it('prefills 02:30 and shows the scheduleError warning when the stored time is invalid', () => {
    const store = flaggedStore({
      disk: {
        backupConfig: {
          mode: 'scheduled',
          links: backupDisk.backupConfig!.links,
          schedule: null,
          scheduleError: 'BAD_TIME: daily "25:00" is not HH:MM',
        },
      },
    });
    renderControls({ store });
    expect((screen.getByTestId('backup-mode-time') as HTMLInputElement).value).toBe(DEFAULT_BACKUP_TIME);
    expect(screen.getByTestId('backup-mode-schedule-error').textContent).toBe(SCHEDULE_ERROR_COPY);
    expect(screen.getByTestId('backup-mode-schedule-error').textContent).not.toMatch(/BAD_TIME|25:00|YAML/);
  });

  it('switching to Scheduled shows a time field prefilled with 02:30 when none is stored', () => {
    renderControls();
    fireEvent.click(screen.getByTestId('backup-mode-scheduled').querySelector('input')!);
    expect((screen.getByTestId('backup-mode-time') as HTMLInputElement).value).toBe(DEFAULT_BACKUP_TIME);
  });

  it('blocks an invalid time on the client and does not send a command', () => {
    const { sent } = renderControls({
      store: flaggedStore({
        disk: { backupConfig: { mode: 'scheduled', links: backupDisk.backupConfig!.links, schedule: { daily: '02:30' } } },
      }),
    });
    fireEvent.input(screen.getByTestId('backup-mode-time'), { target: { value: '24:00' } });
    expect(screen.getByTestId('backup-mode-time-error').textContent).toBe(SET_BACKUP_MODE_ERROR_TEXT.BAD_TIME);
    expect(screen.getByTestId('backup-mode-save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('backup-mode-save'));
    expect(sent).toEqual([]);
  });

  it('sends setBackupMode <id> scheduled HH:MM to the docked Engine, never the disk name', () => {
    const { sent } = renderControls();
    fireEvent.click(screen.getByTestId('backup-mode-scheduled').querySelector('input')!);
    fireEvent.input(screen.getByTestId('backup-mode-time'), { target: { value: '7:15' } });
    fireEvent.click(screen.getByTestId('backup-mode-save'));
    expect(sent).toEqual([{ engineId: MOCK_IDS.ENGINE_1_ID, command: 'setBackupMode DISK004 scheduled 07:15' }]);
    expect(sent[0].command).not.toMatch(/backup-disk/);
  });

  it('sends on-demand and immediate without a time', () => {
    const store = flaggedStore({
      disk: { backupConfig: { mode: 'scheduled', links: backupDisk.backupConfig!.links, schedule: { daily: '02:30' } } },
    });
    const { sent } = renderControls({ store });
    fireEvent.click(screen.getByTestId('backup-mode-on-demand').querySelector('input')!);
    fireEvent.click(screen.getByTestId('backup-mode-save'));
    expect(sent).toEqual([{ engineId: MOCK_IDS.ENGINE_1_ID, command: 'setBackupMode DISK004 on-demand' }]);
  });

  it('shows a first-backup message when saving scheduled on a disk with no lastAttempt', () => {
    const { setCls } = renderControls();
    fireEvent.click(screen.getByTestId('backup-mode-scheduled').querySelector('input')!);
    fireEvent.input(screen.getByTestId('backup-mode-time'), { target: { value: '07:15' } });
    fireEvent.click(screen.getByTestId('backup-mode-save'));
    setCls(log(trace({
      result: JSON.stringify({
        backupDiskId: backupDisk.id,
        previousMode: 'on-demand',
        mode: 'scheduled',
        schedule: { daily: '07:15' },
        scheduleError: null,
        changed: true,
        note: 'daily at 07:15 (Engine local time)',
      }),
    })));
    expect(screen.getByTestId('backup-mode-success').textContent)
      .toBe('A first backup starts now, then daily at 07:15.');
  });

  it('keeps the normal scheduled wording when Disk.lastAttempt is already set', () => {
    const store = flaggedStore({
      disk: {
        lastAttempt: 1_700_000_000_000,
        backupConfig: { mode: 'on-demand', links: backupDisk.backupConfig!.links },
      },
    });
    const { setCls } = renderControls({ store });
    fireEvent.click(screen.getByTestId('backup-mode-scheduled').querySelector('input')!);
    fireEvent.input(screen.getByTestId('backup-mode-time'), { target: { value: '07:15' } });
    fireEvent.click(screen.getByTestId('backup-mode-save'));
    setCls(log(trace({
      result: JSON.stringify({
        backupDiskId: backupDisk.id,
        previousMode: 'on-demand',
        mode: 'scheduled',
        schedule: { daily: '07:15' },
        scheduleError: null,
        changed: true,
        note: 'daily at 07:15 (Engine local time)',
      }),
    })));
    expect(screen.getByTestId('backup-mode-success').textContent)
      .toBe('Saved. This disk will back up every day at 07:15 (this Pi\'s local time).');
  });

  it('leaves immediate wording unchanged when the disk has no lastAttempt', () => {
    const { setCls } = renderControls();
    fireEvent.click(screen.getByTestId('backup-mode-immediate').querySelector('input')!);
    fireEvent.click(screen.getByTestId('backup-mode-save'));
    setCls(log(trace({
      args: { backupDiskId: backupDisk.id, mode: 'immediate', time: [] },
      result: JSON.stringify({
        backupDiskId: backupDisk.id,
        previousMode: 'on-demand',
        mode: 'immediate',
        schedule: { daily: '02:30' },
        scheduleError: null,
        changed: true,
        note: 'backs up on the next dock',
      }),
    })));
    expect(screen.getByTestId('backup-mode-success').textContent)
      .toBe('Saved. This disk will back up when it is next plugged in.');
  });

  it('shows Already set this way when changed is false', () => {
    const { setCls } = renderControls();
    fireEvent.click(screen.getByTestId('backup-mode-immediate').querySelector('input')!);
    fireEvent.click(screen.getByTestId('backup-mode-save'));
    setCls(log(trace({
      args: { backupDiskId: backupDisk.id, mode: 'immediate', time: [] },
      result: JSON.stringify({
        backupDiskId: backupDisk.id,
        previousMode: 'immediate',
        mode: 'immediate',
        schedule: { daily: '02:30' },
        scheduleError: null,
        changed: false,
        note: 'backs up on the next dock',
      }),
    })));
    const text = screen.getByTestId('backup-mode-success').textContent ?? '';
    expect(text).toMatch(/^Already set this way\./);
    expect(text).not.toMatch(/backupApp|setBackupMode/);
  });

  it('maps every refusal code to plain wording', () => {
    const codes = Object.keys(SET_BACKUP_MODE_ERROR_TEXT);
    for (const code of codes) {
      cleanup();
      const { setCls } = renderControls();
      fireEvent.click(screen.getByTestId('backup-mode-immediate').querySelector('input')!);
      fireEvent.click(screen.getByTestId('backup-mode-save'));
      setCls(log(trace({
        status: 'error',
        args: { backupDiskId: backupDisk.id, mode: 'immediate', time: [] },
        errorMessage: `${code}: setBackupMode: engine detail`,
      })));
      const text = screen.getByTestId('backup-mode-error').textContent ?? '';
      expect(text).toBe(SET_BACKUP_MODE_ERROR_TEXT[code]);
      expect(text).not.toContain(code);
      expect(text).not.toContain('setBackupMode');
    }
  });

  it('shows a timeout in plain wording, without the command name', () => {
    vi.useFakeTimers();
    renderControls();
    fireEvent.click(screen.getByTestId('backup-mode-immediate').querySelector('input')!);
    fireEvent.click(screen.getByTestId('backup-mode-save'));
    vi.advanceTimersByTime(15_000 + 1);
    expect(screen.getByTestId('backup-mode-timeout').textContent).toBe(SET_BACKUP_MODE_TIMEOUT_MESSAGE);
    expect(screen.getByTestId('backup-mode-timeout').textContent).not.toMatch(/setBackupMode/);
  });
});
