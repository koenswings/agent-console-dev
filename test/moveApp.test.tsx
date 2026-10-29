/** idea#79 cross-Engine Move (Console side; shapes in src/store/moveApp.ts, engine#289). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { setSendCommandFn } from '../src/store/commands';
import { createDragCopyMove } from '../src/store/dragCopyMove';
import NetworkTree from '../src/components/NetworkTree';
import CopyMoveModal from '../src/components/CopyMoveModal';
import CommandFeedback from '../src/components/CommandFeedback';
import CrossMoveStatus from '../src/components/CrossMoveStatus';
import {
  CAP_MOVE_CROSS, canMoveCrossEngine, crossMoveSupported, friendlyMoveError, latestMoveOp, moveConfirmText,
  moveOutcome, moveStepText,
} from '../src/store/moveApp';
import { MOCK_IDS, MOCK_STORE } from '../src/mock/mockStore';
import type { CommandLogState } from '../src/store/commandLog';
import type { Engine, Operation, Store } from '../src/types/store';

const E1 = MOCK_IDS.ENGINE_1_ID;
const E2 = MOCK_IDS.ENGINE_2_ID;
const NEXTCLOUD = MOCK_IDS.INST_NEXTCLOUD_ID; // on DISK002, docked to E2
const D1 = MOCK_IDS.DISK_1_ID; // docked to E1
const D2 = MOCK_IDS.DISK_2_ID;

const withCaps = (e: Engine, caps: string[], stale = false): Engine =>
  ({ ...e, capabilities: caps, capabilitiesBootedAt: stale ? (e.lastBooted as number) - 1 : e.lastBooted } as Engine);
const mkStore = (c1: string[] | null, c2: string[] | null, ops: Operation[] = []): Store => ({
  ...MOCK_STORE,
  engineDB: {
    ...MOCK_STORE.engineDB,
    [E1]: c1 ? withCaps(MOCK_STORE.engineDB[E1], c1) : MOCK_STORE.engineDB[E1],
    [E2]: c2 ? withCaps(MOCK_STORE.engineDB[E2], c2) : MOCK_STORE.engineDB[E2],
  },
  operationDB: Object.fromEntries(ops.map((o) => [o.id, o])),
});
const both = [CAP_MOVE_CROSS];
const op = (status: Operation['status'], extra: Record<string, unknown> = {}): Operation => ({
  id: 'mv1', kind: 'moveApp', args: { instanceId: NEXTCLOUD, sourceDiskId: D2, targetDiskId: D1, crossEngine: 'true' },
  cause: 'console-command' as Operation['cause'], subject: null, engineId: E2, status, progressPercent: null,
  currentStep: 0, totalSteps: 3, stepLabel: 'Copying', startedAt: Date.now(), completedAt: null, error: null,
  move: { phase: 'copying', targetEngineId: E1, sourceInstanceId: NEXTCLOUD, targetInstanceId: null, code: null, resultText: null },
  ...extra,
} as Operation);

let send: ReturnType<typeof vi.fn>;
beforeEach(() => { send = vi.fn(); setSendCommandFn(send); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('moveApp adapter', () => {
  it('needs moveAppCrossEngine on BOTH Engines, for the current boot', () => {
    const e1 = MOCK_STORE.engineDB[E1];
    const e2 = MOCK_STORE.engineDB[E2];
    expect(canMoveCrossEngine(withCaps(e1, both), withCaps(e2, both))).toBe(true);
    expect(canMoveCrossEngine(withCaps(e1, both), e2)).toBe(false);
    expect(canMoveCrossEngine(e1, withCaps(e2, both))).toBe(false);
    expect(canMoveCrossEngine(withCaps(e1, both), withCaps(e2, both, true))).toBe(false);
    expect(crossMoveSupported(mkStore(both, both), D2, D1)).toBe(true);
    expect(crossMoveSupported(mkStore(both, null), D2, D1)).toBe(false);
  });
  it('the step text follows stepLabel / phase / currentStep', () => {
    expect(moveStepText(op('Running'), 'appdocker01')).toBe('Step 1 of 3: Copying to appdocker01');
    expect(moveStepText(op('Running', { stepLabel: 'Checking', currentStep: 1 }), 'appdocker01')).toBe('Step 2 of 3: Checking the copy on appdocker01');
    expect(moveStepText(op('Running', { stepLabel: null, currentStep: null, move: { phase: 'removing' } }), 'x')).toBe('Step 3 of 3: Removing the old copy');
  });
  it('outcomes: moved, warning (Done with error), failed', () => {
    expect(moveOutcome(op('Running'), 'nextcloud', 'appdocker01')).toBeNull();
    expect(moveOutcome(op('Done', { move: { code: 'MOVED', resultText: 'MOVED to appdocker01' } }), 'nextcloud', 'appdocker01'))
      .toEqual({ kind: 'moved', text: 'nextcloud moved to appdocker01.' });
    const w = moveOutcome(op('Done', { error: 'MOVED, source not removed: quarantine failed' }), 'nextcloud', 'appdocker01')!;
    expect(w.kind).toBe('warning');
    expect(w.text).toBe('nextcloud moved to appdocker01 and works there, but the old copy could not be removed (quarantine failed). Nothing is lost; ask for help to remove the old copy.');
    expect(moveOutcome(op('Failed', { error: 'MOVE FAILED: the copy did not finish; source kept' }), 'nextcloud', 'appdocker01'))
      .toEqual({ kind: 'failed', text: 'nextcloud was not moved (the copy did not finish). Nothing was removed: it is still where it was.' });
  });
  it('refusal text (trace errorMessage) becomes a plain sentence; other text is unchanged', () => {
    expect(friendlyMoveError('MOVE FAILED: the target Engine is not connected; source kept', 'nextcloud'))
      .toBe('nextcloud was not moved (the target Engine is not connected). Nothing was removed: it is still where it was.');
    expect(friendlyMoveError('Too many arguments')).toBe('Too many arguments');
  });
  it('finds the op by move.sourceInstanceId, cross-Engine only, after `since`', () => {
    const same = { ...op('Running'), id: 'same', args: { instanceId: NEXTCLOUD }, move: undefined } as unknown as Operation;
    expect(latestMoveOp(mkStore(both, both, [same]), NEXTCLOUD)).toBeNull();
    expect(latestMoveOp(mkStore(both, both, [op('Running')]), NEXTCLOUD)?.id).toBe('mv1');
    expect(latestMoveOp(mkStore(both, both, [op('Running')]), NEXTCLOUD, Date.now() + 60_000)).toBeNull();
  });
});

describe('cross-Engine Move UI', () => {
  const renderApp = (initial: Store) => {
    const [store, setStore] = createSignal<Store | null>(initial);
    const own = (): CommandLogState => ({ status: 'ready', log: { traces: {}, recentTraceIds: [] } } as unknown as CommandLogState);
    let ctl!: ReturnType<typeof createDragCopyMove>;
    render(() => {
      ctl = createDragCopyMove(store, own);
      return (
        <div>
          <NetworkTree store={store} selection={{ type: 'network', id: '' }} onSelect={() => {}} dragData={ctl.dragData} onDrop={ctl.handleDrop} commandLogStore={own} />
          <CommandFeedback result={ctl.result} subject={ctl.subject} testId="copy-move-feedback" formatError={(m) => friendlyMoveError(m, ctl.subject())} />
          <CrossMoveStatus store={store} move={ctl.crossMove} />
          <CopyMoveModal ctl={ctl} />
        </div>
      );
    });
    return { store: () => store()!, setStore, ctl: () => ctl };
  };
  const drop = (ctl: ReturnType<typeof createDragCopyMove>) => {
    ctl.setDragData({ instanceId: NEXTCLOUD, instanceName: 'nextcloud', sourceDiskId: D2, sourceDiskName: 'src' });
    const target = screen.getByTestId(`disk-${D1}`);
    fireEvent.dragOver(target);
    fireEvent.drop(target);
  };

  it('older Engines: remote disk still selectable, no new text, no steps', () => {
    const { ctl } = renderApp(mkStore(null, null));
    drop(ctl());
    expect(screen.getByTestId('copy-move-move')).toBeInTheDocument();
    expect(screen.queryByTestId('copy-move-cross-note')).toBeNull();
    fireEvent.click(screen.getByTestId('copy-move-move'));
    expect(ctl().crossMove()).toBeNull();
  });

  it('both Engines capable: confirm says where it moves, steps show, then the result', () => {
    const { store, setStore, ctl } = renderApp(mkStore(both, both));
    drop(ctl());
    expect(screen.getByTestId('copy-move-cross-note').textContent).toBe(moveConfirmText('nextcloud', 'appdocker01'));
    fireEvent.click(screen.getByTestId('copy-move-move'));
    expect(send).toHaveBeenCalledWith(E2, `moveApp nextcloud ${D2} ${D1}`);
    setStore({ ...store(), operationDB: { mv1: op('Running') } });
    expect(screen.getByTestId('cross-move-step').textContent).toBe('Step 1 of 3: Copying to appdocker01');
    setStore({ ...store(), operationDB: { mv1: op('Running', { stepLabel: 'Removing the old copy', currentStep: 2 }) } });
    expect(screen.getByTestId('cross-move-step').textContent).toBe('Step 3 of 3: Removing the old copy');
    setStore({ ...store(), operationDB: { mv1: op('Done', { error: 'MOVED, source not removed: helper error' }) } });
    expect(screen.queryByTestId('cross-move-step')).toBeNull();
    expect(screen.getByTestId('cross-move-warning').textContent).toContain('the old copy could not be removed (helper error)');
    expect(screen.queryByTestId('copy-move-feedback-error')).toBeNull();
  });

  it('a failed move shows one plain sentence (CommandFeedback), not a duplicate', () => {
    const { store, setStore, ctl } = renderApp(mkStore(both, both));
    drop(ctl());
    fireEvent.click(screen.getByTestId('copy-move-move'));
    setStore({ ...store(), operationDB: { mv1: op('Failed', { error: 'MOVE FAILED: the check on the target failed; source kept' }) } });
    expect(screen.getByTestId('copy-move-feedback-error').textContent)
      .toContain('nextcloud was not moved (the check on the target failed). Nothing was removed: it is still where it was.');
    expect(screen.queryByTestId('cross-move-failed')).toBeNull();
  });
});
