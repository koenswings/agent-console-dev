/**
 * Loud-fail for Engine commands (r29@97): the Engine's error trace from the
 * command log is shown in the panel that sent the command — RestorePanel,
 * InstanceRow, MobileAppList (incl. the copy/move sheet), OperationProgress
 * (cancel) and NetworkTree (reboot) — instead of failing silently.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import { createRoot, createSignal } from 'solid-js';
import { setSendCommandFn } from '../src/store/commands';
import {
  COMMAND_RESULT_TIMEOUT_MS,
  createCommandResult,
  findCommandOutcome,
  traceMatchesArg,
} from '../src/store/commandResult';
import RestorePanel from '../src/components/RestorePanel';
import InstanceRow from '../src/components/InstanceRow';
import MobileAppList from '../src/components/MobileAppList';
import OperationProgress from '../src/components/OperationProgress';
import NetworkTree from '../src/components/NetworkTree';
import { MOCK_IDS, MOCK_STORE } from '../src/mock/mockStore';
import type { CommandLogState } from '../src/store/commandLog';
import type { CommandLogStore, CommandTrace } from '../src/types/commandLog';
import type { Disk, Instance, Operation, Status, Store } from '../src/types/store';

const SPACED_NAME = 'Duration Tests — Add Files App';
const KOLIBRI = MOCK_IDS.INST_KOLIBRI_ID;

const trace = (id: string, over: Partial<CommandTrace>): CommandTrace => ({
  traceId: id,
  command: 'restoreApp',
  args: { instanceName: 'kolibri', backupDiskId: 'kolibri-disk' },
  startedAt: 0,
  completedAt: 0,
  status: 'ok',
  errorMessage: null,
  logs: [],
  ...over,
});
const log = (...traces: CommandTrace[]): CommandLogStore => ({
  traces: Object.fromEntries(traces.map((t) => [t.traceId, t])),
  recentTraceIds: traces.map((t) => t.traceId),
});

/** What Engine 8d98718 records for `restoreApp kolibri Duration Tests — Add Files App`. */
const tooManyArgsTrace = (id = 'refused') => trace(id, {
  args: JSON.stringify(['kolibri', ...SPACED_NAME.split(' ')]),
  status: 'error',
  errorMessage: 'Error: Too many arguments',
});

const storeWith = (status: Status, diskName?: string): Store => {
  const inst: Instance = { ...MOCK_STORE.instanceDB[KOLIBRI], status };
  const disk: Disk = { ...MOCK_STORE.diskDB[MOCK_IDS.DISK_1_ID], name: diskName ?? 'kolibri-disk' };
  return {
    ...MOCK_STORE,
    operationDB: {},
    instanceDB: { ...MOCK_STORE.instanceDB, [KOLIBRI]: inst },
    diskDB: { ...MOCK_STORE.diskDB, [disk.id]: disk },
  };
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setSendCommandFn(() => {});
});

// ---------------------------------------------------------------------------
// Matching the Engine's pre-execute refusals
// ---------------------------------------------------------------------------
describe('commandResult matches pre-execute refusals (positional args)', () => {
  it('an exact token of a positional args array matches in key mode', () => {
    expect(traceMatchesArg(tooManyArgsTrace(), 'instanceName', 'kolibri')).toBe(true);
    expect(traceMatchesArg(tooManyArgsTrace(), 'instanceName', 'kolib')).toBe(false);
    expect(traceMatchesArg(tooManyArgsTrace(), 'instanceName', 'nextcloud')).toBe(false);
  });
  it('"Too many arguments" refusal → error outcome', () => {
    expect(findCommandOutcome(log(tooManyArgsTrace()), new Set(), 'restoreApp', 'instanceName', 'kolibri'))
      .toEqual({ kind: 'error', message: 'Error: Too many arguments' });
  });
  it('named args still match by key only', () => {
    const t = trace('t', { command: 'startInstance', args: { instanceName: 'kolibri-2', diskId: 'kolibri' } });
    expect(traceMatchesArg(t, 'instanceName', 'kolibri')).toBe(false);
  });
});

describe('createCommandResult longRunning', () => {
  const setup = () => createRoot((dispose) => {
    const [cls, setCls] = createSignal<CommandLogState>(log());
    const r = createCommandResult({ commandLog: cls, command: 'restoreApp', argKey: 'instanceName', longRunning: true });
    return { r, setCls, dispose };
  });

  it('a running trace stops the timeout; a later error is still reported', () => {
    vi.useFakeTimers();
    const t = setup();
    t.r.start('kolibri', () => {});
    t.setCls(log(trace('t', { status: 'running' })));
    vi.advanceTimersByTime(COMMAND_RESULT_TIMEOUT_MS * 4);
    expect(t.r.state()).toEqual({ kind: 'pending' });
    t.setCls(log(trace('t', { status: 'error', errorMessage: 'rsync failed' })));
    expect(t.r.state()).toEqual({ kind: 'error', message: 'rsync failed' });
    expect(t.r.command()).toBe('restoreApp');
    t.dispose();
  });

  it('without any trace it still times out', () => {
    vi.useFakeTimers();
    const t = setup();
    t.r.start('kolibri', () => {});
    vi.advanceTimersByTime(COMMAND_RESULT_TIMEOUT_MS + 1);
    expect(t.r.state()).toEqual({ kind: 'timeout' });
    t.dispose();
  });
});

// ---------------------------------------------------------------------------
// RestorePanel
// ---------------------------------------------------------------------------
describe('RestorePanel shows the Engine error trace', () => {
  const setup = (store: Store = storeWith('Running', SPACED_NAME)) => {
    const [cls, setCls] = createSignal<CommandLogState>(log(trace('stale', { status: 'error', errorMessage: 'stale' })));
    const send = vi.fn();
    setSendCommandFn(send);
    render(() => (
      <RestorePanel
        disk={() => store.diskDB[MOCK_IDS.DISK_4_ID]}
        store={() => store}
        engineId={() => MOCK_IDS.ENGINE_1_ID}
        commandLogStore={cls}
      />
    ));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: MOCK_IDS.DISK_1_ID } });
    fireEvent.click(screen.getByRole('button', { name: /^restore$/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm restore/i }));
    return { cls, setCls, send };
  };

  it('"Too many arguments" refusal is shown as an alert on the row', () => {
    const { cls, setCls, send } = setup();
    expect(send).toHaveBeenCalledOnce();
    // Old (baseline) error traces are not shown
    expect(screen.queryByTestId(`restore-feedback-${KOLIBRI}-error`)).not.toBeInTheDocument();
    const before = cls() as CommandLogStore;
    setCls(log(...Object.values(before.traces), tooManyArgsTrace()));
    const alert = screen.getByTestId(`restore-feedback-${KOLIBRI}-error`);
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveClass('edp-form__error');
    expect(alert.textContent).toContain("Couldn't restore kolibri");
    expect(alert.textContent).toContain('Too many arguments');
  });

  it('"Target disk … not found" (named args) is shown', () => {
    const { setCls } = setup(storeWith('Running'));
    setCls(log(trace('t', {
      status: 'error',
      errorMessage: "Target disk 'kolibri-disk' not found or not docked.",
    })));
    expect(screen.getByRole('alert').textContent).toContain("Target disk 'kolibri-disk' not found or not docked.");
  });

  it('no trace at all → visible "No response" status after the timeout', () => {
    vi.useFakeTimers();
    setup();
    vi.advanceTimersByTime(COMMAND_RESULT_TIMEOUT_MS + 1);
    const hint = screen.getByTestId(`restore-feedback-${KOLIBRI}-timeout`);
    expect(hint).toHaveAttribute('role', 'status');
    expect(hint.textContent).toContain('No response from the Engine to restore kolibri');
  });

  it('a successful restore shows no error', () => {
    const { setCls } = setup(storeWith('Running'));
    setCls(log(trace('t', { status: 'ok' })));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// InstanceRow (start / stop / backup)
// ---------------------------------------------------------------------------
describe('InstanceRow shows the Engine error trace', () => {
  const setup = (status: Status, withBackup = false) => {
    const store = storeWith(status);
    const [cls, setCls] = createSignal<CommandLogState>(log());
    setSendCommandFn(vi.fn());
    render(() => (
      <InstanceRow
        instanceId={KOLIBRI}
        instance={() => store.instanceDB[KOLIBRI]}
        app={() => store.appDB[store.instanceDB[KOLIBRI].instanceOf]}
        engine={() => store.engineDB[MOCK_IDS.ENGINE_1_ID]}
        store={() => store}
        commandLogStore={cls}
        backupDisks={withBackup ? () => [store.diskDB[MOCK_IDS.DISK_4_ID]] : undefined}
      />
    ));
    return { setCls };
  };

  it('startInstance "Insufficient arguments" → alert under the row', () => {
    const { setCls } = setup('Stopped');
    fireEvent.click(screen.getByTestId(`start-instance-${KOLIBRI}`));
    expect(screen.getByText('Starting...')).toBeInTheDocument();
    setCls(log(trace('t', {
      command: 'startInstance',
      args: JSON.stringify(['kolibri']),
      status: 'error',
      errorMessage: 'Error: Insufficient arguments',
    })));
    const alert = screen.getByTestId(`instance-cmd-${KOLIBRI}-error`);
    expect(alert.textContent).toBe("Couldn't start kolibri: Error: Insufficient arguments");
    // the refused start no longer shows a spinner
    expect(screen.queryByText('Starting...')).not.toBeInTheDocument();
  });

  it('stopInstance error log line on an ok trace → alert', () => {
    const { setCls } = setup('Running');
    fireEvent.click(screen.getByTestId(`stop-instance-${KOLIBRI}`));
    setCls(log(trace('t', {
      command: 'stopInstance',
      args: { instanceName: 'kolibri', diskId: MOCK_IDS.DISK_1_ID },
      logs: [{ level: 'error', message: '\u001b[31mcompose down failed\u001b[39m', timestamp: 0 }],
    })));
    expect(screen.getByRole('alert').textContent).toBe("Couldn't stop kolibri: compose down failed");
  });

  it('backupApp refusal → alert', () => {
    const { setCls } = setup('Running', true);
    fireEvent.click(screen.getByTestId(`backup-instance-${KOLIBRI}`));
    setCls(log(trace('t', {
      command: 'backupApp',
      args: { instanceName: 'kolibri', backupDiskId: 'backup-disk' },
      status: 'error',
      errorMessage: "No docked Backup Disk found named 'backup-disk'.",
    })));
    expect(screen.getByRole('alert').textContent)
      .toBe("Couldn't back up kolibri: No docked Backup Disk found named 'backup-disk'.");
  });
});

// ---------------------------------------------------------------------------
// MobileAppList (card + copy/move sheet)
// ---------------------------------------------------------------------------
describe('MobileAppList shows the Engine error trace on the card', () => {
  it('copyApp refusal from the sheet is shown after the sheet closes', () => {
    const store = storeWith('Running');
    const [cls, setCls] = createSignal<CommandLogState>(log());
    const send = vi.fn();
    setSendCommandFn(send);
    render(() => <MobileAppList store={() => store} commandLogStore={cls} />);
    const card = screen.getByText('kolibri').closest('.mobile-app-card') as HTMLElement;
    fireEvent.click(card.querySelector('.mobile-app-card__more-btn')!);
    const copyOp = Array.from(document.querySelectorAll('.mobile-sheet__op-btn'))
      .find((b) => /Copy/.test(b.textContent ?? '')) as HTMLElement;
    fireEvent.click(copyOp);
    fireEvent.click(document.querySelector('.mobile-sheet__disk-row') as HTMLElement);
    fireEvent.click(document.querySelector('.mobile-sheet__confirm') as HTMLElement);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][1]).toMatch(/^copyApp kolibri DISK001 DISK00[23]$/);
    expect(document.querySelector('.mobile-sheet')).toBeNull();
    // Engine 8d98718 copyApp logs its refusal with console.error and closes ok
    setCls(log(trace('t', {
      command: 'copyApp',
      args: { instanceName: 'kolibri', sourceDiskId: 'DISK001', targetDiskId: 'DISK002' },
      logs: [{ level: 'error', message: "copyApp: Target engine 'X' is not currently reachable", timestamp: 0 }],
    })));
    const alert = screen.getByTestId(`mobile-instance-cmd-${KOLIBRI}-error`);
    expect(alert.textContent).toContain("Couldn't copy kolibri: copyApp: Target engine 'X' is not currently reachable");
  });
});

// ---------------------------------------------------------------------------
// OperationProgress (cancel) and NetworkTree (reboot)
// ---------------------------------------------------------------------------
describe('OperationProgress shows a cancelOperation refusal', () => {
  it('error log line → alert above the list', () => {
    const op: Operation = {
      id: 'op-1', kind: 'copyApp', args: { instanceId: KOLIBRI }, cause: 'console-command',
      subject: { type: 'instance', id: KOLIBRI }, engineId: MOCK_IDS.ENGINE_1_ID, status: 'Running',
      progressPercent: 10, currentStep: null, totalSteps: null, stepLabel: null,
      startedAt: Date.now(), completedAt: null, error: null,
    };
    const store: Store = { ...MOCK_STORE, operationDB: { 'op-1': op } };
    const [cls, setCls] = createSignal<CommandLogState>(log());
    const send = vi.fn();
    setSendCommandFn(send);
    render(() => <OperationProgress store={() => store} commandLogStore={cls} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(send).toHaveBeenCalledWith(MOCK_IDS.ENGINE_1_ID, 'cancelOperation op-1');
    setCls(log(trace('t', {
      command: 'cancelOperation',
      args: JSON.stringify(['op-1']),
      logs: [{ level: 'error', message: "cancelOperation: Operation 'op-1' is Running but no cancellable process is registered", timestamp: 0 }],
    })));
    expect(screen.getByTestId('cancel-operation-error').textContent)
      .toContain("Couldn't cancel Copy app: cancelOperation: Operation 'op-1' is Running but no cancellable process is registered");
  });
});

describe('NetworkTree shows a reboot failure', () => {
  it('error trace → alert under the engine', () => {
    const [cls, setCls] = createSignal<CommandLogState>(log());
    setSendCommandFn(vi.fn());
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(() => (
      <NetworkTree
        selection={{ type: 'none' } as never}
        onSelect={() => {}}
        store={() => MOCK_STORE}
        dragData={() => null}
        onDrop={() => {}}
        commandLogStore={cls}
      />
    ));
    fireEvent.click(screen.getByTestId(`reboot-engine-${MOCK_IDS.ENGINE_1_ID}`));
    setCls(log(trace('t', { command: 'reboot', args: {}, status: 'error', errorMessage: 'sudo: a password is required' })));
    const alert = screen.getByTestId(`reboot-feedback-${MOCK_IDS.ENGINE_1_ID}-error`);
    expect(alert.textContent).toContain("Couldn't reboot");
    expect(alert.textContent).toContain('sudo: a password is required');
  });
});
