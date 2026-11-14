/** idea#498: live stay-up check during the Checking step of a cross-Engine Move. */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import {
  MOVE_CHECKING_STALE_MS, applyMoveChecking, moveCheckingLine, moveCheckingText,
  receiveMoveChecking, resetMoveChecking, type MoveChecking,
} from '../src/store/moveChecking';
import { receiveEphemeral, resetLive } from '../src/store/live';
import { applyDemoProgress } from '../src/store/demoApps';
import CrossMoveStatus from '../src/components/CrossMoveStatus';
import OperationProgress from '../src/components/OperationProgress';
import type { CrossMove } from '../src/store/dragCopyMove';
import { MOCK_IDS, MOCK_STORE } from '../src/mock/mockStore';
import type { CommandLogState } from '../src/store/commandLog';
import type { Operation, Store } from '../src/types/store';

const E1 = MOCK_IDS.ENGINE_1_ID;
const E2 = MOCK_IDS.ENGINE_2_ID;
const NEXTCLOUD = MOCK_IDS.INST_NEXTCLOUD_ID;
const T = 1_000_000;

const msg = (checking: unknown, extra: Record<string, unknown> = {}) =>
  ({ type: 'idea/progress', opId: 'mv1', step: 'Checking', bytesDone: 0, bytesTotal: 0, checking, ...extra });
const chk = (phase: string, elapsed: number, label = '') =>
  ({ phase, label, stableElapsedMs: elapsed, stableTargetMs: 10_000 });
const op = (over: Partial<Operation> = {}): Operation => ({
  id: 'mv1', kind: 'moveApp', args: { instanceId: NEXTCLOUD, sourceDiskId: MOCK_IDS.DISK_2_ID, targetDiskId: MOCK_IDS.DISK_1_ID, crossEngine: 'true' },
  cause: 'console-command' as Operation['cause'], subject: null, engineId: E2, status: 'Running', progressPercent: null,
  currentStep: 1, totalSteps: 3, stepLabel: 'Checking', startedAt: Date.now(), completedAt: null, error: null,
  move: { phase: 'checking', targetEngineId: E1, sourceInstanceId: NEXTCLOUD, targetInstanceId: NEXTCLOUD, code: null, resultText: null },
  ...over,
} as Operation);
const one = (s: Record<string, MoveChecking>) => s.mv1;

afterEach(() => { cleanup(); resetLive(); });

describe('applyMoveChecking (parser)', () => {
  it('valid shape: keyed by opId, numbers kept', () => {
    const s = applyMoveChecking({}, msg(chk('stabilising', 4_200, 'Checking it stays up: 4 of 10 s')), T);
    expect(one(s)).toEqual({ phase: 'stabilising', label: 'Checking it stays up: 4 of 10 s', stableElapsedMs: 4_200, stableTargetMs: 10_000, receivedAt: T });
    expect(moveCheckingText(one(s))).toBe('Checking it stays up: 4 of 10 seconds');
  });
  it('old Engine (no checking), other types, bad opId: unchanged', () => {
    const base = {};
    expect(applyMoveChecking(base, msg(undefined), T)).toBe(base);
    expect(applyMoveChecking(base, { type: 'idea/progress', opId: 'd1', step: 'download', bytesDone: 5, bytesTotal: 9 }, T)).toBe(base);
    expect(applyMoveChecking(base, { type: 'idea/hb', opId: 'mv1', checking: chk('starting', 0) }, T)).toBe(base);
    expect(applyMoveChecking(base, msg(chk('starting', 0), { opId: '' }), T)).toBe(base);
    expect(applyMoveChecking(base, msg({ stableElapsedMs: 1 }), T)).toBe(base);
  });
  it('phase going back to starting replaces the stabilising count (not monotonic)', () => {
    let s = applyMoveChecking({}, msg(chk('stabilising', 7_000)), T);
    expect(moveCheckingText(one(s))).toBe('Checking it stays up: 7 of 10 seconds');
    s = applyMoveChecking(s, msg(chk('starting', 0, 'Starting on new Engine')), T + 1000);
    expect(moveCheckingText(one(s))).toBe('Starting on the new Engine');
    s = applyMoveChecking(s, msg(chk('stabilising', 1_000)), T + 2000);
    expect(moveCheckingText(one(s))).toBe('Checking it stays up: 1 of 10 seconds');
  });
  it('stable, unknown phase (label fallback), bad numbers', () => {
    expect(moveCheckingText(one(applyMoveChecking({}, msg(chk('stable', 10_000)), T)))).toBe('It stayed up for 10 seconds');
    expect(moveCheckingText(one(applyMoveChecking({}, msg(chk('warming', 0, 'Warming up')), T)))).toBe('Warming up');
    expect(moveCheckingText(one(applyMoveChecking({}, msg(chk('warming', 0)), T)))).toBeNull();
    const bad = one(applyMoveChecking({}, msg({ phase: 'stabilising', label: 'Checking it stays up: 3 of 10 s', stableElapsedMs: 'x', stableTargetMs: -1 }), T));
    expect(moveCheckingText(bad)).toBe('Checking it stays up: 3 of 10 s');
    expect(moveCheckingText(one(applyMoveChecking({}, msg(chk('stabilising', 12_000)), T)))).toBe('Checking it stays up: 10 of 10 seconds');
  });
  it('accepted from any Engine: the message carries no engine filter, only opId', () => {
    const s = applyMoveChecking({}, msg(chk('starting', 0), { engineId: E1 }), T);
    expect(moveCheckingLine(op({ engineId: E2 }), s, T)).toBe('Starting on the new Engine');
  });
  it('demo download bytes are unaffected by move messages', () => {
    const s = applyDemoProgress({}, msg(chk('starting', 0)), T);
    expect(s.mv1.step).toBe('Checking');
  });
});

describe('moveCheckingLine (when to show, stale clearing)', () => {
  const s = applyMoveChecking({}, msg(chk('stabilising', 4_000)), T);
  it('shows only while the op runs on the Checking step', () => {
    expect(moveCheckingLine(op(), s, T)).toBe('Checking it stays up: 4 of 10 seconds');
    expect(moveCheckingLine(op({ status: 'Pending' }), s, T)).toBe('Checking it stays up: 4 of 10 seconds');
    expect(moveCheckingLine(op({ stepLabel: 'Removing the old copy', currentStep: 2 }), s, T)).toBeNull();
    expect(moveCheckingLine(op({ status: 'Done' }), s, T)).toBeNull();
    expect(moveCheckingLine(op({ status: 'Failed' }), s, T)).toBeNull();
    expect(moveCheckingLine(op({ id: 'other' }), s, T)).toBeNull();
    expect(moveCheckingLine(null, s, T)).toBeNull();
  });
  it('stale after MOVE_CHECKING_STALE_MS without a message', () => {
    expect(moveCheckingLine(op(), s, T + MOVE_CHECKING_STALE_MS)).not.toBeNull();
    expect(moveCheckingLine(op(), s, T + MOVE_CHECKING_STALE_MS + 1)).toBeNull();
  });
  it('receiveEphemeral feeds it; resetLive clears it', async () => {
    const { moveChecking } = await import('../src/store/moveChecking');
    receiveEphemeral(msg(chk('starting', 0)), T);
    expect(moveChecking().mv1.phase).toBe('starting');
    resetLive();
    expect(moveChecking()).toEqual({});
    receiveMoveChecking(msg(chk('stable', 10_000)), T);
    expect(moveChecking().mv1.phase).toBe('stable');
    resetMoveChecking();
    expect(moveChecking()).toEqual({});
  });
});

describe('Checking line (render)', () => {
  const store = (o: Operation): Store => ({ ...MOCK_STORE, operationDB: { [o.id]: o } });
  const move: CrossMove = { instanceId: NEXTCLOUD, app: 'nextcloud', sourceEngine: 'appdocker02', targetEngine: 'appdocker01', since: 0 };

  it('CrossMoveStatus: step line plus the live line; plain step on an old Engine', () => {
    const [s, setS] = createSignal<Store | null>(store(op()));
    render(() => <CrossMoveStatus store={s} move={() => move} />);
    expect(screen.getByTestId('cross-move-step').textContent).toBe('Step 2 of 3: Checking the copy on appdocker01');
    expect(screen.queryByTestId('cross-move-checking')).toBeNull();
    receiveEphemeral(msg(chk('starting', 0)));
    expect(screen.getByTestId('cross-move-checking').textContent).toBe('Starting on the new Engine');
    receiveEphemeral(msg(chk('stabilising', 4_000)));
    expect(screen.getByTestId('cross-move-checking').textContent).toBe('Checking it stays up: 4 of 10 seconds');
    setS(store(op({ stepLabel: 'Removing the old copy', currentStep: 2 })));
    expect(screen.getByTestId('cross-move-step').textContent).toBe('Step 3 of 3: Removing the old copy');
    expect(screen.queryByTestId('cross-move-checking')).toBeNull();
  });

  it('OperationProgress card: live line replaces the stored Checking label', () => {
    const [s] = createSignal<Store | null>(store(op()));
    const log = () => null as unknown as CommandLogState;
    render(() => <OperationProgress store={s} commandLogStore={log} />);
    expect(screen.getByTestId('operation-step-label-mv1').textContent).toBe('Checking');
    receiveEphemeral(msg(chk('stabilising', 9_000)));
    expect(screen.getByTestId('operation-step-label-mv1').textContent).toBe('Checking it stays up: 9 of 10 seconds');
  });
});
