/**
 * Cross-engine command feedback (r30, before cover-all with static peers).
 *
 * A command to an Engine other than the connected one has its trace in THAT
 * Engine's command log. Instead of a false red "No response from the Engine",
 * the panel shows a neutral "Sent to <engine>, waiting for confirmation" and:
 *   (i)  follows the target's command log when it is loaded (red on its error trace);
 *   (ii) otherwise resolves from the store change that proves the command worked;
 * red only on a real error (trace, Failed op, Error status) or after the long
 * per-operation timeout (REMOTE_TIMEOUTS_MS). The connected Engine keeps the
 * normal command-log behaviour (15 s "No response").
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import { createRoot, createSignal } from 'solid-js';
import { setSendCommandFn } from '../src/store/commands';
import { COMMAND_RESULT_TIMEOUT_MS, createCommandResult } from '../src/store/commandResult';
import { EJECT_TIMEOUT_MS } from '../src/store/ejectResult';
import {
  connectedEngineId,
  isRemoteEngine,
  setConnectedEngineHost,
} from '../src/store/connectedEngine';
import { setRemoteCommandLogFn } from '../src/store/remoteCommandLogs';
import {
  REMOTE_TIMEOUTS_MS,
  confirmInstanceStatus,
  confirmNewOperation,
  formatWait,
  remoteWatchFor,
} from '../src/store/remoteConfirm';
import { createDragCopyMove } from '../src/store/dragCopyMove';
import InstanceRow from '../src/components/InstanceRow';
import RestorePanel from '../src/components/RestorePanel';
import NetworkTree from '../src/components/NetworkTree';
import CopyMoveModal from '../src/components/CopyMoveModal';
import CommandFeedback from '../src/components/CommandFeedback';
import OperationProgress from '../src/components/OperationProgress';
import { MOCK_IDS, MOCK_STORE } from '../src/mock/mockStore';
import type { CommandLogState } from '../src/store/commandLog';
import type { CommandLogStore, CommandTrace } from '../src/types/commandLog';
import type { Instance, Operation, Status, Store } from '../src/types/store';

const E1 = MOCK_IDS.ENGINE_1_ID; // appdocker01 — the connected Engine (test/setup.ts)
const E2 = MOCK_IDS.ENGINE_2_ID; // appdocker02 — another Engine in the pool
const NEXTCLOUD = MOCK_IDS.INST_NEXTCLOUD_ID; // stored on DISK002, docked to E2
const KOLIBRI = MOCK_IDS.INST_KOLIBRI_ID; // stored on DISK001, docked to E1
const SHORT = COMMAND_RESULT_TIMEOUT_MS * 4; // well past the connected-Engine 15 s window

const trace = (id: string, over: Partial<CommandTrace>): CommandTrace => ({
  traceId: id,
  command: 'startInstance',
  args: { instanceName: 'nextcloud', diskId: MOCK_IDS.DISK_2_ID },
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

const baseStore = (): Store => ({ ...MOCK_STORE, operationDB: {} });
const withInstance = (s: Store, id: string, over: Partial<Instance>): Store => ({
  ...s,
  instanceDB: { ...s.instanceDB, [id]: { ...s.instanceDB[id], ...over } },
});
const withOp = (s: Store, op: Partial<Operation> & { id: string }): Store => ({
  ...s,
  operationDB: {
    ...s.operationDB,
    [op.id]: {
      kind: 'copyApp', args: {}, cause: 'console-command', subject: { type: 'instance', id: '' },
      engineId: E2, status: 'Running', progressPercent: null, currentStep: null, totalSteps: null,
      stepLabel: null, startedAt: Date.now(), completedAt: null, error: null,
      ...op,
    } as Operation,
  },
});

const noRed = () => {
  expect(screen.queryAllByRole('alert')).toHaveLength(0);
  expect(document.body.textContent).not.toContain('No response');
};

let send: ReturnType<typeof vi.fn>;
beforeEach(() => {
  send = vi.fn();
  setSendCommandFn(send);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setSendCommandFn(() => {});
});

// ---------------------------------------------------------------------------
// InstanceRow start/stop on another Engine
// ---------------------------------------------------------------------------
describe('InstanceRow start on another Engine', () => {
  const setup = (status: Status = 'Stopped', commandLog?: () => CommandLogState) => {
    const [store, setStore] = createSignal<Store>(withInstance(baseStore(), NEXTCLOUD, { status }));
    render(() => (
      <InstanceRow
        instanceId={NEXTCLOUD}
        instance={() => store().instanceDB[NEXTCLOUD]}
        app={() => store().appDB[store().instanceDB[NEXTCLOUD].instanceOf]}
        engine={() => store().engineDB[E2]}
        store={store}
        commandLogStore={commandLog}
      />
    ));
    fireEvent.click(screen.getByTestId(`start-instance-${NEXTCLOUD}`));
    return { store, setStore };
  };

  it('neutral "Sent to appdocker02" with no red in the short window; resolves when the store says Running', () => {
    vi.useFakeTimers();
    const { setStore, store } = setup();
    expect(send).toHaveBeenCalledWith(E2, `startInstance nextcloud ${MOCK_IDS.DISK_2_ID}`);
    const sent = screen.getByTestId(`instance-cmd-${NEXTCLOUD}-sent`);
    expect(sent).toHaveAttribute('role', 'status');
    expect(sent).not.toHaveClass('edp-form__error');
    expect(sent.textContent).toContain('Sent to appdocker02, waiting for confirmation');
    vi.advanceTimersByTime(SHORT);
    noRed();
    expect(screen.queryByTestId(`instance-cmd-${NEXTCLOUD}-timeout`)).toBeNull();
    expect(screen.getByTestId(`instance-cmd-${NEXTCLOUD}-sent`)).toBeInTheDocument();
    // Store confirmation: the target Engine started the app.
    setStore(withInstance(store(), NEXTCLOUD, { status: 'Running' }));
    expect(screen.queryByTestId(`instance-cmd-${NEXTCLOUD}-sent`)).toBeNull();
    noRed();
    // and it stays quiet after the long timeout
    vi.advanceTimersByTime(REMOTE_TIMEOUTS_MS.startInstance + 1);
    noRed();
  });

  it('an Error status written by the target Engine turns red (genuine failure)', () => {
    const { setStore, store } = setup();
    setStore(withInstance(store(), NEXTCLOUD, { status: 'Error', statusCondition: 'compose up failed: port in use' }));
    expect(screen.getByTestId(`instance-cmd-${NEXTCLOUD}-error`).textContent)
      .toBe("Couldn't start nextcloud: compose up failed: port in use");
  });

  it('red after the long timeout with no confirmation', () => {
    vi.useFakeTimers();
    setup();
    vi.advanceTimersByTime(REMOTE_TIMEOUTS_MS.startInstance - 1000);
    noRed();
    vi.advanceTimersByTime(2000);
    const alert = screen.getByTestId(`instance-cmd-${NEXTCLOUD}-error`);
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert.textContent).toContain('No confirmation from appdocker02 after 5 min');
  });

  it('(i) follows the target Engine\'s command log when loaded: red on its error trace, stale traces ignored', () => {
    const [remote, setRemote] = createSignal<CommandLogState>(
      log(trace('stale', { status: 'error', errorMessage: 'old failure' })),
    );
    setRemoteCommandLogFn((id) => (id === E2 ? remote : null));
    setup();
    expect(screen.getByTestId(`instance-cmd-${NEXTCLOUD}-sent`)).toBeInTheDocument();
    noRed();
    setRemote(log(
      ...Object.values((remote() as CommandLogStore).traces),
      trace('new', { status: 'error', errorMessage: "Instance 'nextcloud' has no compose file" }),
    ));
    expect(screen.getByTestId(`instance-cmd-${NEXTCLOUD}-error`).textContent)
      .toBe("Couldn't start nextcloud: Instance 'nextcloud' has no compose file");
  });

  it('(i) an ok trace in the target\'s log resolves without waiting for the store', () => {
    const [remote, setRemote] = createSignal<CommandLogState>(log());
    setRemoteCommandLogFn((id) => (id === E2 ? remote : null));
    setup();
    setRemote(log(trace('new', { status: 'ok' })));
    expect(screen.queryByTestId(`instance-cmd-${NEXTCLOUD}-sent`)).toBeNull();
    noRed();
  });

  it('a remote log that is not loaded (error/null) falls back to (ii)', () => {
    vi.useFakeTimers();
    setRemoteCommandLogFn((id) => (id === E2 ? () => ({ error: 'unreachable' }) as CommandLogState : null));
    const { setStore, store } = setup();
    vi.advanceTimersByTime(SHORT);
    noRed();
    setStore(withInstance(store(), NEXTCLOUD, { status: 'Running' }));
    expect(screen.queryByTestId(`instance-cmd-${NEXTCLOUD}-sent`)).toBeNull();
  });
});

describe('connected Engine keeps its current behaviour', () => {
  it('start on the connected Engine: no "Sent to", 15 s "No response" status', () => {
    vi.useFakeTimers();
    const store = withInstance(baseStore(), KOLIBRI, { status: 'Stopped' });
    render(() => (
      <InstanceRow
        instanceId={KOLIBRI}
        instance={() => store.instanceDB[KOLIBRI]}
        app={() => store.appDB[store.instanceDB[KOLIBRI].instanceOf]}
        engine={() => store.engineDB[E1]}
        store={() => store}
        commandLogStore={() => log()}
      />
    ));
    fireEvent.click(screen.getByTestId(`start-instance-${KOLIBRI}`));
    expect(screen.queryByTestId(`instance-cmd-${KOLIBRI}-sent`)).toBeNull();
    vi.advanceTimersByTime(COMMAND_RESULT_TIMEOUT_MS + 1);
    expect(screen.getByTestId(`instance-cmd-${KOLIBRI}-timeout`).textContent).toContain('No response from the Engine');
  });
});

// ---------------------------------------------------------------------------
// Which Engine is "connected"
// ---------------------------------------------------------------------------
describe('connected Engine detection', () => {
  it('hostname match (case/.local-insensitive); an unknown host makes every Engine remote', () => {
    setConnectedEngineHost('AppDocker01.local');
    expect(connectedEngineId(MOCK_STORE)).toBe(E1);
    expect(isRemoteEngine(MOCK_STORE, E1)).toBe(false);
    expect(isRemoteEngine(MOCK_STORE, E2)).toBe(true);
    setConnectedEngineHost('192.168.1.40');
    expect(isRemoteEngine(MOCK_STORE, E1)).toBe(true);
  });

  it('a trace in our own log proves the target is the connected Engine (learned for the next command)', () => {
    setConnectedEngineHost('192.168.1.40');
    const [own, setOwn] = createSignal<CommandLogState>(log());
    const store = () => MOCK_STORE;
    const { r, dispose } = createRoot((dispose) => ({
      r: createCommandResult({ commandLog: own, command: 'startInstance', argKey: 'instanceName' }),
      dispose,
    }));
    r.start('kolibri', () => {}, {
      engineId: E1,
      remote: remoteWatchFor(store, E1, 'startInstance', () => null),
    });
    expect(r.state()).toEqual({ kind: 'sent', engine: 'appdocker01' });
    setOwn(log(trace('own', { args: { instanceName: 'kolibri', diskId: MOCK_IDS.DISK_1_ID }, status: 'ok' })));
    expect(r.state()).toEqual({ kind: 'success' });
    expect(isRemoteEngine(MOCK_STORE, E1)).toBe(false);
    expect(remoteWatchFor(store, E1, 'startInstance', () => null)).toBeNull();
    dispose();
  });

  it('an own-log error trace for an "unknown" Engine is still red', () => {
    setConnectedEngineHost(null);
    const [own, setOwn] = createSignal<CommandLogState>(log());
    const { r, dispose } = createRoot((dispose) => ({
      r: createCommandResult({ commandLog: own, command: 'stopInstance', argKey: 'instanceName' }),
      dispose,
    }));
    r.start('kolibri', () => {}, { engineId: E1, remote: remoteWatchFor(() => MOCK_STORE, E1, 'stopInstance', () => null) });
    expect(r.state().kind).toBe('sent');
    setOwn(log(trace('own', { command: 'stopInstance', args: { instanceName: 'kolibri' }, status: 'error', errorMessage: 'boom' })));
    expect(r.state()).toEqual({ kind: 'error', message: 'boom' });
    dispose();
  });

  it('documented timeouts: minutes for copy/move/restore/backup/reboot', () => {
    expect(REMOTE_TIMEOUTS_MS.copyApp).toBe(30 * 60_000);
    expect(REMOTE_TIMEOUTS_MS.moveApp).toBe(30 * 60_000);
    expect(REMOTE_TIMEOUTS_MS.restoreApp).toBe(30 * 60_000);
    expect(REMOTE_TIMEOUTS_MS.backupApp).toBe(30 * 60_000);
    expect(REMOTE_TIMEOUTS_MS.reboot).toBe(10 * 60_000);
    expect(REMOTE_TIMEOUTS_MS.ejectDisk).toBe(3 * 60_000);
    expect(formatWait(REMOTE_TIMEOUTS_MS.copyApp)).toBe('30 min');
  });
});

// ---------------------------------------------------------------------------
// Store confirmation builders
// ---------------------------------------------------------------------------
describe('store confirmation', () => {
  it('confirmNewOperation ignores ops that existed at send time; Done → ok, Failed/Cancelled → error', () => {
    const [s, setS] = createSignal<Store>(withOp(baseStore(), { id: 'old', kind: 'restoreApp', status: 'Failed', args: { instanceId: KOLIBRI }, error: 'old' }));
    const check = confirmNewOperation(s, 'restoreApp', KOLIBRI);
    expect(check()).toBeNull();
    setS(withOp(s(), { id: 'other', kind: 'restoreApp', status: 'Failed', args: { instanceId: NEXTCLOUD }, error: 'x' }));
    expect(check()).toBeNull();
    setS(withOp(s(), { id: 'new', kind: 'restoreApp', status: 'Running', args: { instanceId: KOLIBRI } }));
    expect(check()).toBeNull();
    setS(withOp(s(), { id: 'new', kind: 'restoreApp', status: 'Done', args: { instanceId: KOLIBRI } }));
    expect(check()).toBe('ok');
    setS(withOp(s(), { id: 'new', kind: 'restoreApp', status: 'Cancelled' as Operation['status'], args: { instanceId: KOLIBRI } }));
    expect(check()).toEqual({ error: 'restoreApp was cancelled.' });
  });

  it('confirmInstanceStatus: an instance already in Error must leave it before Error counts as failure', () => {
    const [s, setS] = createSignal<Store>(withInstance(baseStore(), NEXTCLOUD, { status: 'Error' }));
    const check = confirmInstanceStatus(s, NEXTCLOUD, ['Running']);
    expect(check()).toBeNull();
    setS(withInstance(s(), NEXTCLOUD, { status: 'Starting' }));
    expect(check()).toBeNull();
    setS(withInstance(s(), NEXTCLOUD, { status: 'Error', statusCondition: 'again' }));
    expect(check()).toEqual({ error: 'again' });
  });
});

// ---------------------------------------------------------------------------
// RestorePanel to another Engine (restore op in the store)
// ---------------------------------------------------------------------------
describe('RestorePanel restore on another Engine', () => {
  const setup = () => {
    const [store, setStore] = createSignal<Store>(baseStore());
    render(() => (
      <RestorePanel
        disk={() => store().diskDB[MOCK_IDS.DISK_4_ID]}
        store={store}
        engineId={() => E2}
        commandLogStore={() => log()}
      />
    ));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: MOCK_IDS.DISK_2_ID } });
    fireEvent.click(screen.getByRole('button', { name: /^restore$/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm restore/i }));
    return { store, setStore };
  };

  it('sent → resolves on the new restoreApp op Done', () => {
    vi.useFakeTimers();
    const { store, setStore } = setup();
    expect(send).toHaveBeenCalledWith(E2, `restoreApp ${KOLIBRI} ${MOCK_IDS.DISK_2_ID}`);
    expect(screen.getByTestId(`restore-feedback-${KOLIBRI}-sent`).textContent).toContain('Sent to appdocker02');
    vi.advanceTimersByTime(10 * 60_000);
    noRed();
    setStore(withOp(store(), { id: 'op-r', kind: 'restoreApp', status: 'Done', args: { instanceId: KOLIBRI, targetDiskId: MOCK_IDS.DISK_2_ID } }));
    expect(screen.queryByTestId(`restore-feedback-${KOLIBRI}-sent`)).toBeNull();
    noRed();
  });

  it('a Failed restoreApp op turns red with the Engine\'s error', () => {
    const { store, setStore } = setup();
    setStore(withOp(store(), { id: 'op-r', kind: 'restoreApp', status: 'Failed', args: { instanceId: KOLIBRI, targetDiskId: MOCK_IDS.DISK_2_ID }, error: 'borg extract failed' }));
    expect(screen.getByTestId(`restore-feedback-${KOLIBRI}-error`).textContent).toBe("Couldn't restore kolibri: borg extract failed");
  });

  it('red after 30 min without confirmation', () => {
    vi.useFakeTimers();
    setup();
    vi.advanceTimersByTime(REMOTE_TIMEOUTS_MS.restoreApp - 1000);
    noRed();
    vi.advanceTimersByTime(2000);
    expect(screen.getByTestId(`restore-feedback-${KOLIBRI}-error`).textContent).toContain('No confirmation from appdocker02 after 30 min');
  });
});

// ---------------------------------------------------------------------------
// NetworkTree: remote reboot and remote eject
// ---------------------------------------------------------------------------
describe('NetworkTree on another Engine', () => {
  const renderTree = (initial: Store = baseStore()) => {
    const [store, setStore] = createSignal<Store>(initial);
    const utils = render(() => (
      <NetworkTree
        store={store}
        selection={{ type: 'network', id: '' }}
        onSelect={() => {}}
        dragData={() => null}
        onDrop={() => {}}
        commandLogStore={() => log()}
      />
    ));
    return { store, setStore, ...utils };
  };
  beforeEach(() => { vi.spyOn(window, 'confirm').mockReturnValue(true); });
  afterEach(() => vi.restoreAllMocks());

  it('reboot: neutral while the Engine goes down; resolves when it comes back (lastBooted advanced)', () => {
    vi.useFakeTimers();
    const { store, setStore } = renderTree();
    fireEvent.click(screen.getByTestId(`reboot-engine-${E2}`));
    expect(send).toHaveBeenCalledWith(E2, 'reboot');
    expect(screen.getByTestId(`reboot-feedback-${E2}-sent`).textContent).toContain('Sent to appdocker02');
    vi.advanceTimersByTime(SHORT);
    // going offline is not a failure
    setStore({ ...store(), engineDB: { ...store().engineDB, [E2]: { ...store().engineDB[E2], lastRun: 0 } } });
    vi.advanceTimersByTime(3 * 60_000);
    noRed();
    setStore({ ...store(), engineDB: { ...store().engineDB, [E2]: { ...store().engineDB[E2], lastBooted: Date.now(), lastRun: Date.now() } } });
    expect(screen.queryByTestId(`reboot-feedback-${E2}-sent`)).toBeNull();
    noRed();
  });

  it('reboot: red when it never comes back within 10 min', () => {
    vi.useFakeTimers();
    renderTree();
    fireEvent.click(screen.getByTestId(`reboot-engine-${E2}`));
    vi.advanceTimersByTime(REMOTE_TIMEOUTS_MS.reboot - 1000);
    noRed();
    vi.advanceTimersByTime(2000);
    expect(screen.getByTestId(`reboot-feedback-${E2}-error`).textContent).toContain('No confirmation from appdocker02 after 10 min');
  });

  const eject = (diskId: string) => {
    fireEvent.click(screen.getByTestId(`eject-${diskId}`));
    fireEvent.click(screen.getByTestId('eject-confirm-ok'));
  };

  it('eject: "Sent to", no "No response" past the eject timeout; resolves when the disk leaves the store', () => {
    vi.useFakeTimers();
    const { store, setStore } = renderTree();
    eject(MOCK_IDS.DISK_2_ID);
    expect(send).toHaveBeenCalledWith(E2, `ejectDisk ${MOCK_IDS.DISK_2_ID}`);
    const notice = screen.getByTestId(`eject-notice-${MOCK_IDS.DISK_2_ID}`);
    expect(notice).toHaveAttribute('data-eject-state', 'sent');
    expect(notice).toHaveAttribute('role', 'status');
    expect(notice.textContent).toContain('Sent to appdocker02');
    vi.advanceTimersByTime(EJECT_TIMEOUT_MS * 2);
    noRed();
    expect(screen.getByTestId(`eject-notice-${MOCK_IDS.DISK_2_ID}`)).toHaveAttribute('data-eject-state', 'sent');
    const d = store().diskDB[MOCK_IDS.DISK_2_ID];
    setStore({ ...store(), diskDB: { ...store().diskDB, [d.id]: { ...d, device: null, dockedTo: null } } });
    expect(screen.queryByTestId(`eject-notice-${MOCK_IDS.DISK_2_ID}`)).toBeNull();
    noRed();
  });

  it('eject: (i) red on the target\'s error trace', () => {
    const [remote, setRemote] = createSignal<CommandLogState>(log());
    setRemoteCommandLogFn((id) => (id === E2 ? remote : null));
    renderTree();
    eject(MOCK_IDS.DISK_2_ID);
    setRemote(log(trace('ej', {
      command: 'ejectDisk',
      args: JSON.stringify({ diskId: MOCK_IDS.DISK_2_ID }),
      status: 'error',
      errorMessage: 'umount: target is busy',
    })));
    const notice = screen.getByTestId(`eject-notice-${MOCK_IDS.DISK_2_ID}`);
    expect(notice).toHaveAttribute('data-eject-state', 'error');
    expect(notice).toHaveAttribute('role', 'alert');
    expect(notice.textContent).toContain('umount: target is busy');
  });

  it('eject: red after 3 min without confirmation', () => {
    vi.useFakeTimers();
    renderTree();
    eject(MOCK_IDS.DISK_2_ID);
    vi.advanceTimersByTime(REMOTE_TIMEOUTS_MS.ejectDisk + 1);
    const notice = screen.getByTestId(`eject-notice-${MOCK_IDS.DISK_2_ID}`);
    expect(notice).toHaveAttribute('data-eject-state', 'error');
    expect(notice.textContent).toContain('No confirmation from appdocker02 after 3 min');
  });

  it('eject on the connected Engine keeps the normal timeout path', () => {
    vi.useFakeTimers();
    renderTree();
    eject(MOCK_IDS.DISK_1_ID);
    // pending renders nothing (as before); no "Sent to"
    expect(screen.queryByTestId(`eject-notice-${MOCK_IDS.DISK_1_ID}`)).toBeNull();
    vi.advanceTimersByTime(EJECT_TIMEOUT_MS + 1);
    expect(screen.getByTestId(`eject-notice-${MOCK_IDS.DISK_1_ID}`)).toHaveAttribute('data-eject-state', 'timeout');
  });
});

// ---------------------------------------------------------------------------
// OperationProgress cancel on another Engine
// ---------------------------------------------------------------------------
describe('OperationProgress cancel on another Engine', () => {
  it('neutral, resolves when the op leaves Running', () => {
    vi.useFakeTimers();
    const [store, setStore] = createSignal<Store>(withOp(baseStore(), {
      id: 'op-2', kind: 'copyApp', args: { instanceId: NEXTCLOUD }, engineId: E2, status: 'Running',
      subject: { type: 'instance', id: NEXTCLOUD },
    }));
    render(() => <OperationProgress store={store} commandLogStore={() => log()} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(send).toHaveBeenCalledWith(E2, 'cancelOperation op-2');
    vi.advanceTimersByTime(SHORT);
    noRed();
    setStore(withOp(store(), { id: 'op-2', kind: 'copyApp', args: { instanceId: NEXTCLOUD }, status: 'Cancelled' as Operation['status'] }));
    noRed();
  });
});

// ---------------------------------------------------------------------------
// App.tsx drag-and-drop copy/move (createDragCopyMove + NetworkTree + modal)
// ---------------------------------------------------------------------------
describe('App drag-and-drop copy/move', () => {
  /** The same wiring App.tsx uses on desktop. */
  const renderApp = (initial: Store = baseStore(), own: () => CommandLogState = () => log()) => {
    const [store, setStore] = createSignal<Store | null>(initial);
    let ctl!: ReturnType<typeof createDragCopyMove>;
    render(() => {
      ctl = createDragCopyMove(store, own);
      return (
        <div>
          <NetworkTree
            store={store}
            selection={{ type: 'network', id: '' }}
            onSelect={() => {}}
            dragData={ctl.dragData}
            onDrop={ctl.handleDrop}
            commandLogStore={own}
          />
          <CommandFeedback result={ctl.result} subject={ctl.subject} testId="copy-move-feedback" />
          <CopyMoveModal ctl={ctl} />
        </div>
      );
    });
    return { store: () => store()!, setStore, ctl: () => ctl };
  };

  const drag = (ctl: ReturnType<typeof createDragCopyMove>, instanceId: string, name: string, sourceDiskId: string, targetDiskId: string) => {
    ctl.setDragData({ instanceId, instanceName: name, sourceDiskId, sourceDiskName: 'src' });
    const target = screen.getByTestId(`disk-${targetDiskId}`);
    fireEvent.dragOver(target);
    fireEvent.drop(target);
    expect(screen.getByTestId('copy-move-modal')).toBeInTheDocument();
  };

  it('copy from another Engine: sent to the SOURCE Engine, neutral, resolves when the copy appears on the target disk', () => {
    vi.useFakeTimers();
    const { store, setStore, ctl } = renderApp();
    drag(ctl(), NEXTCLOUD, 'nextcloud', MOCK_IDS.DISK_2_ID, MOCK_IDS.DISK_1_ID);
    fireEvent.click(screen.getByTestId('copy-move-copy'));
    expect(screen.queryByTestId('copy-move-modal')).toBeNull();
    expect(send).toHaveBeenCalledWith(E2, `copyApp nextcloud ${MOCK_IDS.DISK_2_ID} ${MOCK_IDS.DISK_1_ID}`);
    expect(screen.getByTestId('copy-move-feedback-sent').textContent).toContain('Sent to appdocker02');
    vi.advanceTimersByTime(10 * 60_000);
    noRed();
    const src = store().instanceDB[NEXTCLOUD];
    setStore({ ...store(), instanceDB: { ...store().instanceDB, 'nextcloud-copy': { ...src, id: 'nextcloud-copy', storedOn: MOCK_IDS.DISK_1_ID, created: Date.now() } } });
    expect(screen.queryByTestId('copy-move-feedback-sent')).toBeNull();
    noRed();
  });

  it('move from another Engine: red on the Failed moveApp op', () => {
    const { store, setStore, ctl } = renderApp();
    drag(ctl(), NEXTCLOUD, 'nextcloud', MOCK_IDS.DISK_2_ID, MOCK_IDS.DISK_1_ID);
    fireEvent.click(screen.getByTestId('copy-move-move'));
    expect(send).toHaveBeenCalledWith(E2, `moveApp nextcloud ${MOCK_IDS.DISK_2_ID} ${MOCK_IDS.DISK_1_ID}`);
    setStore(withOp(store(), { id: 'mv', kind: 'moveApp', status: 'Failed', args: { instanceId: NEXTCLOUD, targetDiskId: MOCK_IDS.DISK_1_ID }, error: 'rsync: connection refused' }));
    expect(screen.getByTestId('copy-move-feedback-error').textContent).toBe("Couldn't move nextcloud: rsync: connection refused");
  });

  it('move from another Engine: resolves when storedOn becomes the target disk; red after 30 min otherwise', () => {
    vi.useFakeTimers();
    const { store, setStore, ctl } = renderApp();
    drag(ctl(), NEXTCLOUD, 'nextcloud', MOCK_IDS.DISK_2_ID, MOCK_IDS.DISK_1_ID);
    fireEvent.click(screen.getByTestId('copy-move-move'));
    setStore(withInstance(store(), NEXTCLOUD, { storedOn: MOCK_IDS.DISK_1_ID }));
    expect(screen.queryByTestId('copy-move-feedback-sent')).toBeNull();
    noRed();
    // a second move that never confirms
    drag(ctl(), KOLIBRI, 'kolibri', MOCK_IDS.DISK_1_ID, MOCK_IDS.DISK_3_ID);
    setConnectedEngineHost('appdocker02'); // now the source (E1) is the remote one
    fireEvent.click(screen.getByTestId('copy-move-move'));
    expect(screen.getByTestId('copy-move-feedback-sent').textContent).toContain('Sent to appdocker01');
    vi.advanceTimersByTime(REMOTE_TIMEOUTS_MS.moveApp + 1);
    expect(screen.getByTestId('copy-move-feedback-error').textContent).toContain('No confirmation from appdocker01 after 30 min');
  });

  it('copy from the connected Engine: normal command-log path (own error trace → red, no "Sent to")', () => {
    const [own, setOwn] = createSignal<CommandLogState>(log());
    const { ctl } = renderApp(baseStore(), own);
    drag(ctl(), KOLIBRI, 'kolibri', MOCK_IDS.DISK_1_ID, MOCK_IDS.DISK_2_ID);
    fireEvent.click(screen.getByTestId('copy-move-copy'));
    expect(send).toHaveBeenCalledWith(E1, `copyApp kolibri ${MOCK_IDS.DISK_1_ID} ${MOCK_IDS.DISK_2_ID}`);
    expect(screen.queryByTestId('copy-move-feedback-sent')).toBeNull();
    setOwn(log(trace('cp', {
      command: 'copyApp',
      args: { instanceName: 'kolibri', sourceDiskId: MOCK_IDS.DISK_1_ID, targetDiskId: MOCK_IDS.DISK_2_ID },
      status: 'error',
      errorMessage: "copyApp: Target engine 'appdocker02' is not currently reachable",
    })));
    expect(screen.getByTestId('copy-move-feedback-error').textContent)
      .toContain("Couldn't copy kolibri: copyApp: Target engine 'appdocker02' is not currently reachable");
  });
});
