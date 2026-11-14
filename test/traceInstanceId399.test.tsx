/**
 * engine#399 / agent-engine-dev#403: an Engine with `traceInstanceId` traces the
 * resolved `instanceId` and the display `instanceName`; an older Engine traces the
 * value sent under `instanceName`. Each reader matches the right key for the Engine
 * the command goes to (traceInstanceMatch).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import { createRoot, createSignal } from 'solid-js';
import { setSendCommandFn } from '../src/store/commands';
import { COMMAND_RESULT_TIMEOUT_MS } from '../src/store/commandResult';
import { traceInstanceMatch, TRACE_INSTANCE_ID_CAPABILITY } from '../src/store/traceInstance';
import { createDragCopyMove } from '../src/store/dragCopyMove';
import RestorePanel from '../src/components/RestorePanel';
import InstanceRow from '../src/components/InstanceRow';
import MobileAppList from '../src/components/MobileAppList';
import { MOCK_IDS, MOCK_STORE } from '../src/mock/mockStore';
import type { CommandLogState } from '../src/store/commandLog';
import type { CommandLogStore, CommandTrace } from '../src/types/commandLog';
import type { Engine, Store } from '../src/types/store';

const KOLIBRI = MOCK_IDS.INST_KOLIBRI_ID; // 'kolibri' on DISK_1 (ENGINE_1)
const NEXTCLOUD = MOCK_IDS.INST_NEXTCLOUD_ID; // 'nextcloud' on DISK_2 (ENGINE_2)
const E1 = MOCK_IDS.ENGINE_1_ID;
const E2 = MOCK_IDS.ENGINE_2_ID;
const D1 = MOCK_IDS.DISK_1_ID;
const D2 = MOCK_IDS.DISK_2_ID;
const D4 = MOCK_IDS.DISK_4_ID;
const OTHER_ID = 'other-kolibri-id'; // another instance that shares the name 'kolibri'

const withCap = (e: Engine): Engine => ({
  ...e,
  capabilities: [...(e.capabilities ?? []), TRACE_INSTANCE_ID_CAPABILITY],
  capabilitiesBootedAt: e.lastBooted,
} as Engine);
const oldEngine = (e: Engine): Engine => ({
  ...e,
  capabilities: (e.capabilities ?? []).filter((c) => c !== TRACE_INSTANCE_ID_CAPABILITY),
} as Engine);
const storeFor = (fresh: boolean): Store => {
  const pick = fresh ? withCap : oldEngine;
  return {
    ...MOCK_STORE,
    operationDB: {},
    engineDB: { ...MOCK_STORE.engineDB, [E1]: pick(MOCK_STORE.engineDB[E1]), [E2]: pick(MOCK_STORE.engineDB[E2]) },
  };
};

const trace = (id: string, over: Partial<CommandTrace>): CommandTrace => ({
  traceId: id, command: 'backupApp', args: {}, startedAt: 0, completedAt: 0,
  status: 'ok', errorMessage: null, logs: [], ...over,
});
const log = (...traces: CommandTrace[]): CommandLogStore => ({
  traces: Object.fromEntries(traces.map((t) => [t.traceId, t])),
  recentTraceIds: traces.map((t) => t.traceId),
});
/** What an Engine with traceInstanceId records (resolved id + display name). */
const newArgs = (id: string, name: string | null, rest: Record<string, string>) => ({ instanceId: id, instanceName: name, ...rest });
/** What an older Engine records: the value sent, under instanceName. */
const oldArgs = (sent: string, rest: Record<string, string>) => ({ instanceName: sent, ...rest });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setSendCommandFn(() => {});
});

// ---------------------------------------------------------------------------
describe('traceInstanceMatch', () => {
  it('an Engine with traceInstanceId → instanceId + the instance id', () => {
    expect(traceInstanceMatch(storeFor(true), E1, KOLIBRI, 'kolibri')).toEqual({ argKey: 'instanceId', argValue: KOLIBRI });
  });
  it('an older Engine → instanceName + the value sent', () => {
    expect(traceInstanceMatch(storeFor(false), E1, KOLIBRI, 'kolibri')).toEqual({ argKey: 'instanceName', argValue: 'kolibri' });
    expect(traceInstanceMatch(storeFor(false), E1, KOLIBRI, KOLIBRI)).toEqual({ argKey: 'instanceName', argValue: KOLIBRI });
  });
  it('asks the Engine the command goes to, not another one', () => {
    const s = storeFor(false);
    const mixed: Store = { ...s, engineDB: { ...s.engineDB, [E2]: withCap(s.engineDB[E2]) } };
    expect(traceInstanceMatch(mixed, E1, KOLIBRI, 'kolibri').argKey).toBe('instanceName');
    expect(traceInstanceMatch(mixed, E2, KOLIBRI, 'kolibri').argKey).toBe('instanceId');
  });
  it('a rolled-back Engine (stale capabilitiesBootedAt), a missing Engine or store → old shape', () => {
    const s = storeFor(true);
    const rolled: Store = { ...s, engineDB: { ...s.engineDB, [E1]: { ...s.engineDB[E1], lastBooted: 1 } as Engine } };
    expect(traceInstanceMatch(rolled, E1, KOLIBRI, 'kolibri').argKey).toBe('instanceName');
    expect(traceInstanceMatch(s, 'no-such-engine', KOLIBRI, 'kolibri').argKey).toBe('instanceName');
    expect(traceInstanceMatch(null, E1, KOLIBRI, 'kolibri').argKey).toBe('instanceName');
  });
});

// ---------------------------------------------------------------------------
describe('InstanceRow backupApp', () => {
  const setup = (fresh: boolean) => {
    const store = storeFor(fresh);
    const [cls, setCls] = createSignal<CommandLogState>(log());
    const send = vi.fn();
    setSendCommandFn(send);
    render(() => (
      <InstanceRow
        instanceId={KOLIBRI}
        instance={() => store.instanceDB[KOLIBRI]}
        app={() => store.appDB[store.instanceDB[KOLIBRI].instanceOf]}
        engine={() => store.engineDB[E1]}
        store={() => store}
        commandLogStore={cls}
        backupDisks={() => [store.diskDB[D4]]}
      />
    ));
    fireEvent.click(screen.getByTestId(`backup-instance-${KOLIBRI}`));
    expect(send).toHaveBeenCalledWith(E1, `backupApp ${KOLIBRI} ${D4}`);
    return { setCls };
  };
  const refusal = 'Backup disk is busy';
  const alertText = () => screen.getByTestId(`instance-cmd-${KOLIBRI}-error`).textContent;

  it('old Engine: the refusal (instanceName = the id sent) shows as a refusal', () => {
    const { setCls } = setup(false);
    setCls(log(trace('t', { args: oldArgs(KOLIBRI, { backupDiskId: D4 }), status: 'error', errorMessage: refusal })));
    expect(alertText()).toContain(refusal);
  });

  it('new Engine: the refusal (instanceName = the display name) shows as a refusal, not a timeout', () => {
    vi.useFakeTimers();
    const { setCls } = setup(true);
    setCls(log(trace('t', { args: newArgs(KOLIBRI, 'kolibri', { backupDiskId: D4 }), status: 'error', errorMessage: refusal })));
    vi.advanceTimersByTime(COMMAND_RESULT_TIMEOUT_MS + 1);
    expect(alertText()).toContain(refusal);
    expect(screen.queryByTestId(`instance-cmd-${KOLIBRI}-timeout`)).not.toBeInTheDocument();
  });

  it('new Engine: a refusal for another instance with the same name is not shown here', () => {
    const { setCls } = setup(true);
    setCls(log(trace('t', { args: newArgs(OTHER_ID, 'kolibri', { backupDiskId: D4 }), status: 'error', errorMessage: refusal })));
    expect(screen.queryByTestId(`instance-cmd-${KOLIBRI}-error`)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('MobileAppList', () => {
  const setup = (fresh: boolean) => {
    const store = storeFor(fresh);
    const [cls, setCls] = createSignal<CommandLogState>(log());
    const send = vi.fn();
    setSendCommandFn(send);
    render(() => <MobileAppList store={() => store} commandLogStore={cls} />);
    const card = () => screen.getByText('kolibri').closest('.mobile-app-card') as HTMLElement;
    return { setCls, send, card };
  };
  const alertText = () => screen.getByTestId(`mobile-instance-cmd-${KOLIBRI}-error`).textContent;
  const refusal = 'Backup disk is busy';

  describe('backupApp', () => {
    it('old Engine: the refusal (instanceName = the id sent) is shown', () => {
      const { setCls, send, card } = setup(false);
      fireEvent.click(card().querySelector('.btn--backup')!);
      expect(send.mock.calls[0][1]).toMatch(new RegExp(`^backupApp ${KOLIBRI} `));
      setCls(log(trace('t', { args: oldArgs(KOLIBRI, { backupDiskId: D4 }), status: 'error', errorMessage: refusal })));
      expect(alertText()).toContain(refusal);
    });

    it('new Engine: the refusal (resolved id + display name) shows as a refusal, not a timeout', () => {
      vi.useFakeTimers();
      const { setCls, card } = setup(true);
      fireEvent.click(card().querySelector('.btn--backup')!);
      setCls(log(trace('t', { args: newArgs(KOLIBRI, 'kolibri', { backupDiskId: D4 }), status: 'error', errorMessage: refusal })));
      vi.advanceTimersByTime(COMMAND_RESULT_TIMEOUT_MS + 1);
      expect(alertText()).toContain(refusal);
      expect(screen.queryByTestId(`mobile-instance-cmd-${KOLIBRI}-timeout`)).not.toBeInTheDocument();
    });
  });

  describe('copyApp from the sheet', () => {
    const sendCopy = (card: HTMLElement) => {
      fireEvent.click(card.querySelector('.mobile-app-card__more-btn')!);
      const copyOp = Array.from(document.querySelectorAll('.mobile-sheet__op-btn'))
        .find((b) => /Copy/.test(b.textContent ?? '')) as HTMLElement;
      fireEvent.click(copyOp);
      fireEvent.click(document.querySelector('.mobile-sheet__disk-row') as HTMLElement);
      fireEvent.click(document.querySelector('.mobile-sheet__confirm') as HTMLElement);
    };
    const copyRefusal = "copyApp: Target engine 'X' is not currently reachable";

    it('old Engine: matched by the name sent', () => {
      const { setCls, send, card } = setup(false);
      sendCopy(card());
      expect(send.mock.calls[0][1]).toMatch(/^copyApp kolibri /);
      setCls(log(trace('t', { command: 'copyApp', args: oldArgs('kolibri', { sourceDiskId: D1, targetDiskId: D2 }), status: 'error', errorMessage: copyRefusal })));
      expect(alertText()).toContain(copyRefusal);
    });

    it('new Engine: matched by the resolved id, not a namesake', () => {
      const { setCls, card } = setup(true);
      sendCopy(card());
      setCls(log(trace('o', { command: 'copyApp', args: newArgs(OTHER_ID, 'kolibri', { sourceDiskId: D1, targetDiskId: D2 }), status: 'error', errorMessage: 'namesake' })));
      expect(screen.queryByTestId(`mobile-instance-cmd-${KOLIBRI}-error`)).not.toBeInTheDocument();
      setCls(log(trace('t', { command: 'copyApp', args: newArgs(KOLIBRI, 'kolibri', { sourceDiskId: D1, targetDiskId: D2 }), status: 'error', errorMessage: copyRefusal })));
      expect(alertText()).toContain(copyRefusal);
    });
  });
});

// ---------------------------------------------------------------------------
describe('RestorePanel restoreApp', () => {
  const setup = (fresh: boolean) => {
    const store = storeFor(fresh);
    const [cls, setCls] = createSignal<CommandLogState>(log());
    const send = vi.fn();
    setSendCommandFn(send);
    render(() => (
      <RestorePanel
        disk={() => store.diskDB[D4]}
        store={() => store}
        engineId={() => E1}
        commandLogStore={cls}
      />
    ));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: D1 } });
    fireEvent.click(screen.getByRole('button', { name: /^restore$/i }));
    fireEvent.click(document.querySelector('[data-testid^="restore-confirm-"]:not([data-testid*="-box-"]):not([data-testid*="-text-"]):not([data-testid*="-points-"])') as HTMLElement);
    expect(send).toHaveBeenCalledWith(E1, `restoreApp ${KOLIBRI} ${D1}`);
    return { setCls };
  };
  const refusal = "Target disk 'kolibri-disk' not found or not docked.";
  const alertText = () => screen.getByTestId(`restore-feedback-${KOLIBRI}-error`).textContent;

  it('old Engine: the refusal (instanceName = the id sent) is shown', () => {
    const { setCls } = setup(false);
    setCls(log(trace('t', { command: 'restoreApp', args: oldArgs(KOLIBRI, { targetDiskId: D1 }), status: 'error', errorMessage: refusal })));
    expect(alertText()).toContain(refusal);
  });

  it('new Engine: the refusal (resolved id + display name) is shown, not a timeout', () => {
    vi.useFakeTimers();
    const { setCls } = setup(true);
    setCls(log(trace('t', { command: 'restoreApp', args: newArgs(KOLIBRI, 'kolibri', { targetDiskId: D1 }), status: 'error', errorMessage: refusal })));
    vi.advanceTimersByTime(COMMAND_RESULT_TIMEOUT_MS * 10);
    expect(alertText()).toContain(refusal);
    expect(screen.queryByTestId(`restore-feedback-${KOLIBRI}-timeout`)).not.toBeInTheDocument();
  });

  it('new Engine: a refused restore by an unresolved id still matches (instanceId keeps the raw arg)', () => {
    const { setCls } = setup(true);
    setCls(log(trace('t', { command: 'restoreApp', args: newArgs(KOLIBRI, null, { targetDiskId: D1 }), status: 'error', errorMessage: refusal })));
    expect(alertText()).toContain(refusal);
  });
});

// ---------------------------------------------------------------------------
describe('drag copy / move (createDragCopyMove)', () => {
  const setup = (fresh: boolean) => createRoot((dispose) => {
    const store = storeFor(fresh);
    const [cls, setCls] = createSignal<CommandLogState>(log());
    const send = vi.fn();
    setSendCommandFn(send);
    const ctl = createDragCopyMove(() => store, cls);
    return { ctl, setCls, send, dispose };
  });
  const drop = (ctl: ReturnType<typeof createDragCopyMove>, op: 'copy' | 'move') => {
    ctl.handleDrop({ instanceId: NEXTCLOUD, instanceName: 'nextcloud', sourceDiskId: D2, sourceDiskName: 'src' }, D1);
    ctl.choose(op);
  };
  const refusal = (command: string) => `${command}: Source disk changed`;

  for (const command of ['copyApp', 'moveApp'] as const) {
    const op = command === 'copyApp' ? 'copy' : 'move';

    it(`${command}, old Engine: matched by the name sent (instanceName)`, () => {
      const t = setup(false);
      drop(t.ctl, op);
      expect(t.send).toHaveBeenCalledWith(E2, `${command} nextcloud ${D2} ${D1}`);
      t.setCls(log(trace('t', { command, args: oldArgs('nextcloud', { sourceDiskId: D2, targetDiskId: D1 }), status: 'error', errorMessage: refusal(command) })));
      expect(t.ctl.result.state()).toMatchObject({ kind: 'error' });
      t.dispose();
    });

    it(`${command}, new Engine: matched by the resolved id; a namesake trace is ignored`, () => {
      const t = setup(true);
      drop(t.ctl, op);
      t.setCls(log(trace('o', { command, args: newArgs(OTHER_ID, 'nextcloud', { sourceDiskId: D2, targetDiskId: D1 }), status: 'error', errorMessage: 'namesake' })));
      expect(t.ctl.result.state().kind).not.toBe('error'); // still waiting (sent to the source Engine)
      t.setCls(log(trace('t', { command, args: newArgs(NEXTCLOUD, 'nextcloud', { sourceDiskId: D2, targetDiskId: D1 }), status: 'error', errorMessage: refusal(command) })));
      expect(t.ctl.result.state()).toMatchObject({ kind: 'error' });
      t.dispose();
    });
  }
});
