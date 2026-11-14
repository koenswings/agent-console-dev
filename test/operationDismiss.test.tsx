/**
 * idea#498: dismissing a finished operation card only hides it in this browser;
 * only the user's Cancel on a Pending / Running op sends cancelOperation.
 * (Live proof op 5jcawfpp66k78fhamfg: the Done auto-dismiss sent cancelOperation.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import OperationProgress from '../src/components/OperationProgress';
import MobileLayout from '../src/components/MobileLayout';
import { setSendCommandFn } from '../src/store/commands';
import { dismissOp, isOpDismissed, MAX_DISMISSED_OPS, resetDismissedOps } from '../src/store/dismissedOps';
import { MOCK_IDS, MOCK_STORE } from '../src/mock/mockStore';
import type { CommandLogState } from '../src/store/commandLog';
import type { Operation, Store } from '../src/types/store';

const E1 = MOCK_IDS.ENGINE_1_ID; // connected (test/setup.ts)
const E2 = MOCK_IDS.ENGINE_2_ID;
const mkOp = (id: string, status: Operation['status'], over: Partial<Operation> = {}): Operation => ({
  id, kind: 'copyApp', args: { instanceId: MOCK_IDS.INST_NEXTCLOUD_ID }, cause: 'console-command' as Operation['cause'],
  subject: { type: 'instance', id: MOCK_IDS.INST_NEXTCLOUD_ID }, engineId: E1, status, progressPercent: 10,
  currentStep: null, totalSteps: null, stepLabel: null, startedAt: Date.now(), error: status === 'Failed' ? 'Disk full' : null,
  completedAt: status === 'Running' || status === 'Pending' ? null : Date.now(), ...over,
} as Operation);
const storeWith = (...ops: Operation[]): Store => ({ ...MOCK_STORE, operationDB: Object.fromEntries(ops.map((o) => [o.id, o])) });
const log = (): CommandLogState => ({ traces: {}, recentTraceIds: [] } as unknown as CommandLogState);
const cancels = (send: ReturnType<typeof vi.fn>) => send.mock.calls.filter(([, c]) => String(c).startsWith('cancelOperation'));

let send: ReturnType<typeof vi.fn>;
beforeEach(() => { send = vi.fn(); setSendCommandFn(send); });
afterEach(() => { cleanup(); vi.useRealTimers(); setSendCommandFn(() => {}); });

describe('OperationProgress: dismiss never sends cancelOperation', () => {
  it('Done card: the 3 s auto-dismiss hides it and sends nothing', () => {
    vi.useFakeTimers();
    render(() => <OperationProgress store={() => storeWith(mkOp('d1', 'Done', { kind: 'moveApp', engineId: E2 }))} commandLogStore={log} />);
    expect(screen.getByTestId('operation-card-d1')).toBeInTheDocument();
    vi.advanceTimersByTime(3100);
    expect(screen.queryByTestId('operation-card-d1')).toBeNull();
    expect(cancels(send)).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('Failed card: the ✕ dismiss button hides it locally and sends nothing (connected and remote Engine)', () => {
    render(() => <OperationProgress store={() => storeWith(mkOp('f1', 'Failed'), mkOp('f2', 'Failed', { engineId: E2 }))} commandLogStore={log} />);
    fireEvent.click(screen.getByTestId('operation-dismiss-f1'));
    fireEvent.click(screen.getByTestId('operation-dismiss-f2'));
    expect(screen.queryByTestId('operation-card-f1')).toBeNull();
    expect(screen.queryByTestId('operation-card-f2')).toBeNull();
    expect(send).not.toHaveBeenCalled();
    expect(screen.queryByTestId('cancel-operation-sent')).toBeNull();
  });

  it('a dismissed Failed card stays hidden after a remount (reload) — stored in this browser only', () => {
    const s = storeWith(mkOp('f3', 'Failed'));
    const first = render(() => <OperationProgress store={() => s} commandLogStore={log} />);
    fireEvent.click(screen.getByTestId('operation-dismiss-f3'));
    first.unmount();
    render(() => <OperationProgress store={() => s} commandLogStore={log} />);
    expect(screen.queryByTestId('operation-card-f3')).toBeNull();
    expect(JSON.parse(localStorage.getItem('idea.dismissedOps') ?? '[]')).toContain('f3');
  });

  it('Done auto-dismiss is not written to localStorage (it would crowd out the Failed ids)', () => {
    vi.useFakeTimers();
    render(() => <OperationProgress store={() => storeWith(mkOp('d2', 'Done'))} commandLogStore={log} />);
    vi.advanceTimersByTime(3100);
    expect(isOpDismissed('d2')).toBe(true);
    expect(JSON.parse(localStorage.getItem('idea.dismissedOps') ?? '[]')).not.toContain('d2');
  });

  it('a Cancelled op shows no card and no buttons', () => {
    render(() => <OperationProgress store={() => storeWith(mkOp('c1', 'Cancelled' as Operation['status']))} commandLogStore={log} />);
    expect(screen.queryByTestId('operation-card-c1')).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('Cancel on a Running op still sends cancelOperation to the op\'s Engine', () => {
    render(() => <OperationProgress store={() => storeWith(mkOp('r1', 'Running', { engineId: E2 }))} commandLogStore={log} />);
    expect(screen.queryByTestId('operation-dismiss-r1')).toBeNull();
    fireEvent.click(screen.getByTestId('operation-cancel-r1'));
    expect(send).toHaveBeenCalledWith(E2, 'cancelOperation r1');
    expect(cancels(send)).toHaveLength(1);
  });

  it('Cancel on a Pending op still sends cancelOperation', () => {
    render(() => <OperationProgress store={() => storeWith(mkOp('p1', 'Pending'))} commandLogStore={log} />);
    fireEvent.click(screen.getByTestId('operation-cancel-p1'));
    expect(send).toHaveBeenCalledWith(E1, 'cancelOperation p1');
  });

  it('a card keeps its id when the op turns Done: Cancel disappears, the auto-dismiss sends nothing', () => {
    vi.useFakeTimers();
    const [s, setS] = createSignal(storeWith(mkOp('r2', 'Running')));
    render(() => <OperationProgress store={s} commandLogStore={log} />);
    const card = screen.getByTestId('operation-card-r2');
    setS(storeWith(mkOp('r2', 'Done')));
    expect(screen.getByTestId('operation-card-r2')).toBe(card);
    expect(screen.queryByTestId('operation-cancel-r2')).toBeNull();
    vi.advanceTimersByTime(3100);
    expect(screen.queryByTestId('operation-card-r2')).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('Mobile Activity tab: same dismiss rules', () => {
  const renderMobile = (s: Store) => render(() => (
    <MobileLayout store={() => s} commandLogStore={log} selection={{ type: 'network', id: '' }} onSelect={() => {}}
      dragData={() => null} onDrop={() => {}} pendingMove={() => null} onCopyMoveChoice={() => {}} onCancelMove={() => {}} />
  ));
  const openActivity = () => {
    const tab = screen.getAllByRole('button').find((b) => /activity/i.test(b.textContent ?? '') || /activity/i.test(b.getAttribute('aria-label') ?? ''));
    expect(tab).toBeTruthy();
    fireEvent.click(tab!);
  };

  it('Failed dismiss and Done auto-dismiss send nothing; Running Cancel sends', () => {
    vi.useFakeTimers();
    renderMobile(storeWith(mkOp('mf', 'Failed'), mkOp('md', 'Done'), mkOp('mr', 'Running', { engineId: E2 })));
    openActivity();
    fireEvent.click(screen.getByTestId('operation-dismiss-mf'));
    vi.advanceTimersByTime(3100);
    expect(screen.queryByTestId('operation-card-mf')).toBeNull();
    expect(screen.queryByTestId('operation-card-md')).toBeNull();
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('operation-cancel-mr'));
    expect(send).toHaveBeenCalledWith(E2, 'cancelOperation mr');
  });
});

describe('dismissedOps store', () => {
  it('keeps at most MAX_DISMISSED_OPS ids, newest last', () => {
    resetDismissedOps();
    for (let i = 0; i < MAX_DISMISSED_OPS + 5; i++) dismissOp(`op${i}`);
    const stored = JSON.parse(localStorage.getItem('idea.dismissedOps') ?? '[]') as string[];
    expect(stored).toHaveLength(MAX_DISMISSED_OPS);
    expect(stored[stored.length - 1]).toBe(`op${MAX_DISMISSED_OPS + 4}`);
    expect(isOpDismissed('op0')).toBe(false);
  });
});
