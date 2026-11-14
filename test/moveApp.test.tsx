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
  CAP_MOVE_CROSS, canMoveCrossEngine, crossMoveSupported, moveFailedLine, latestMoveOp, moveConfirmText,
  moveOutcome, moveStepText, moveErrorLine, MOVE_CODE_TEXT, MOVE_REFUSAL_CODES, MOVE_FAILURE_CODES,
  movePlacement, MOVE_TARGET_LEFTOVER, MOVE_TARGET_CLEANING, MOVE_CLEANUP_CODES,
} from '../src/store/moveApp';
import { traceErrorCode } from '../src/store/commandResult';
import type { CommandTrace } from '../src/types/commandLog';
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
const C = { app: 'nextcloud', sourceEngine: 'appdocker02', targetEngine: 'appdocker01' };
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
    expect(moveOutcome(op('Running'), C)).toBeNull();
    expect(moveOutcome(op('Done', { move: { code: 'MOVED', resultText: 'MOVED to appdocker01' } }), C))
      .toEqual({ kind: 'moved', text: 'nextcloud moved to appdocker01.', moved: true });
    const w = moveOutcome(op('Done', { error: 'MOVED, source not removed: quarantine failed' }), C, 'target')!;
    expect(w.kind).toBe('warning');
    expect(w.text).toBe("nextcloud moved to appdocker01. The old copy on appdocker02 couldn't be removed.");
    expect(moveOutcome(op('Failed', { error: 'MOVE FAILED: the copy did not finish; source kept' }), C))
      .toEqual({ kind: 'failed', text: "Couldn't move nextcloud (the copy did not finish). Nothing was removed: it is still on appdocker02.", moved: false });
  });
  it('refusal text (trace errorMessage) becomes a plain sentence; other text is unchanged', () => {
    expect(moveFailedLine('MOVE FAILED: the target Engine is not connected; source kept', 'nextcloud', 'appdocker02'))
      .toBe("Couldn't move nextcloud (the target Engine is not connected). Nothing was removed: it is still on appdocker02.");
    expect(moveFailedLine('Too many arguments', 'nextcloud', 'appdocker02')).toBeNull();
  });
  it('finds the op by move.sourceInstanceId, cross-Engine only, after `since`', () => {
    const same = { ...op('Running'), id: 'same', args: { instanceId: NEXTCLOUD }, move: undefined } as unknown as Operation;
    expect(latestMoveOp(mkStore(both, both, [same]), NEXTCLOUD)).toBeNull();
    expect(latestMoveOp(mkStore(both, both, [op('Running')]), NEXTCLOUD)?.id).toBe('mv1');
    expect(latestMoveOp(mkStore(both, both, [op('Running')]), NEXTCLOUD, Date.now() + 60_000)).toBeNull();
  });
});

const EXPECTED: Record<string, string> = {
  TARGET_EXISTS: "Couldn't move nextcloud: an app with the same id is already on appdocker01. Nothing was removed: it is still on appdocker02.",
  NOT_FOUND: "Couldn't move nextcloud: it is no longer on this disk. Nothing changed.",
  AMBIGUOUS: "Couldn't move nextcloud: more than one app matches. Nothing was removed: it is still on appdocker02.",
  SOURCE_REMOTE: "Couldn't move nextcloud: its disk is no longer in appdocker02. Nothing changed.",
  TARGET_UNREACHABLE: "Couldn't move nextcloud: appdocker01 can't be reached. Check that appdocker01 is switched on and connected to the school network, then try again. Nothing was removed: it is still on appdocker02.",
  PEER_ACCESS: "Couldn't move nextcloud: appdocker02 and appdocker01 are not yet allowed to share Apps. Ask for help. Nothing was removed: it is still on appdocker02.",
  TARGET_OUTDATED: "Couldn't move nextcloud: appdocker01 needs a system update before Apps can be moved to it. Nothing was removed: it is still on appdocker02.",
  HELPER_OUTDATED: "Couldn't move nextcloud: appdocker02 needs a system update before Apps can be moved. Nothing was removed: it is still on appdocker02.",
  BUSY: "Couldn't move nextcloud: something else is running on it or on the target disk. Try again when it is done. Nothing was removed: it is still on appdocker02.",
  INVALID: "Couldn't move nextcloud to that disk. Nothing was removed: it is still on appdocker02.",
  COPY_FAILED: "Couldn't move nextcloud: the copy to appdocker01 didn't finish. Nothing was removed: it is still on appdocker02.",
  VERIFY_NOT_FOUND: "Couldn't move nextcloud: the copy didn't show up on appdocker01. Nothing was removed: it is still on appdocker02.",
  VERIFY_NOT_RUNNING: "Couldn't move nextcloud: the copy on appdocker01 didn't start. Nothing was removed: it is still on appdocker02.",
  VERIFY_SIZE: "Couldn't move nextcloud: the copy on appdocker01 is not complete. Nothing was removed: it is still on appdocker02.",
  VERIFY_TIMEOUT: "Couldn't move nextcloud: appdocker01 didn't confirm the copy in time. Nothing was removed: it is still on appdocker02.",
  VERIFY_FAILED: "Couldn't move nextcloud: the copy on appdocker01 couldn't be checked. Nothing was removed: it is still on appdocker02.",
  INTERRUPTED: "Couldn't move nextcloud: appdocker02 restarted during the move. Nothing was removed: it is still on appdocker02.",
  SOURCE_KEPT: 'nextcloud was not moved, so it stays on appdocker02.',
  SOURCE_CHANGED: 'nextcloud was not moved: it changed on appdocker02 while it was being copied, so it stays there.',
};

describe('moveApp codes (engine#289 b5429d6)', () => {
  it('every refusal and failure code has its sentence, code wins over text', () => {
    expect(Object.keys(MOVE_CODE_TEXT).sort()).toEqual([...MOVE_REFUSAL_CODES, ...MOVE_FAILURE_CODES, 'SOURCE_CHANGED'].sort());
    for (const [code, text] of Object.entries(EXPECTED)) {
      expect(moveErrorLine('MOVE FAILED: engine words; source kept', code, C)).toBe(text);
    }
  });
  it('failed op: op.move.code picks the sentence', () => {
    for (const code of MOVE_FAILURE_CODES) {
      // engine#395: a cleanup code without targetCleanup yet says the cleanup is pending
      const pending = MOVE_CLEANUP_CODES.has(code) ? ' Cleaning up the copy on appdocker01…' : '';
      expect(moveOutcome(op('Failed', { error: 'MOVE FAILED: x; source kept', move: { code } }), C)).toEqual({ kind: 'failed', text: EXPECTED[code] + pending, moved: false });
    }
  });
  it('unknown code or none: the Engine reason in the approved sentence; not a move text: null', () => {
    expect(moveErrorLine('MOVE FAILED: disk on fire; source kept', 'NEW_CODE', C)).toBe("Couldn't move nextcloud (disk on fire). Nothing was removed: it is still on appdocker02.");
    expect(moveErrorLine('Too many arguments', null, C)).toBeNull();
  });
  it('trace code: errorCode first, else result.code (string or object)', () => {
    const t = (o: Partial<CommandTrace>) => ({ traceId: 't', command: 'moveApp', args: {}, startedAt: 0, completedAt: 1, status: 'error', errorMessage: 'MOVE FAILED: x; source kept', logs: [], ...o } as CommandTrace);
    expect(traceErrorCode(t({ errorCode: 'PEER_ACCESS' }))).toBe('PEER_ACCESS');
    expect(traceErrorCode(t({ result: JSON.stringify({ code: 'BUSY', text: 'x' }) }))).toBe('BUSY');
    expect(traceErrorCode(t({ result: { code: 'INVALID' } as unknown as string }))).toBe('INVALID');
    expect(traceErrorCode(t({ result: '{"contentSummary":1}' }))).toBeNull();
    expect(traceErrorCode(t({}))).toBeNull();
  });
  it('Done codes: MOVED, SOURCE_NOT_REMOVED and SOURCE_CHANGED (amber warnings)', () => {
    expect(moveOutcome(op('Done', { move: { code: 'MOVED' } }), C)).toEqual({ kind: 'moved', text: 'nextcloud moved to appdocker01.', moved: true });
    expect(moveOutcome(op('Done', { error: 'MOVED, source not removed: helper error', move: { code: 'SOURCE_NOT_REMOVED' } }), C, 'target')!.kind).toBe('warning');
    expect(moveOutcome(op('Done', { error: 'MOVED, source not removed: the source was started during the move', move: { code: 'SOURCE_CHANGED' } }), C, 'source'))
      .toEqual({ kind: 'warning', text: 'nextcloud was not moved: it changed on appdocker02 while it was being copied, so it stays there. Cleaning up the copy on appdocker01…', moved: false });
  });
});

// Engine 53f151d (Axle): the wording follows the row's storedOn when the op ends, never the result text (engine#388).
describe('source not removed: wording by storedOn (idea#498)', () => {
  const done = (code: string, error = 'MOVED, source not removed: x') =>
    op('Done', { error, move: { phase: 'done', sourceInstanceId: NEXTCLOUD, targetInstanceId: NEXTCLOUD, code, targetEngineId: E1, resultText: null } });
  const at = (diskId: string): Store => ({ ...MOCK_STORE, instanceDB: { ...MOCK_STORE.instanceDB, [NEXTCLOUD]: { ...MOCK_STORE.instanceDB[NEXTCLOUD], storedOn: diskId } } });

  it('movePlacement: the kept-id row on the target or the source disk; unknown otherwise', () => {
    expect(movePlacement(at(D1), done('SOURCE_NOT_REMOVED'))).toBe('target');
    expect(movePlacement(at(D2), done('SOURCE_NOT_REMOVED'))).toBe('source');
    expect(movePlacement(at('OTHER'), done('SOURCE_NOT_REMOVED'))).toBeNull();
    expect(movePlacement(null, done('SOURCE_NOT_REMOVED'))).toBeNull();
  });
  it('older Engines (fresh target id): the target row on the target disk counts as moved', () => {
    const old = op('Done', { move: { sourceInstanceId: NEXTCLOUD, targetInstanceId: 'fresh-id', code: 'SOURCE_NOT_REMOVED' } });
    const s: Store = { ...at(D2), instanceDB: { ...at(D2).instanceDB, 'fresh-id': { ...MOCK_STORE.instanceDB[NEXTCLOUD], id: 'fresh-id', storedOn: D1 } } };
    expect(movePlacement(s, old)).toBe('target');
    expect(movePlacement(at(D2), old)).toBe('source');
  });
  it('storedOn = target (removeSource failed after the flip): moved, old copy not removed', () => {
    expect(moveOutcome(done('SOURCE_NOT_REMOVED'), C, 'target')).toEqual({ kind: 'warning', text: "nextcloud moved to appdocker01. The old copy on appdocker02 couldn't be removed.", moved: true });
    // engine#388: SOURCE_CHANGED is never a move, even if the row looks moved.
    const changed = moveOutcome(done('SOURCE_CHANGED'), C, 'target')!;
    expect(changed.moved).toBe(false);
    expect(changed.text).not.toMatch(/moved to/);
  });
  it('storedOn = source: SOURCE_CHANGED says it changed while being copied', () => {
    const o = moveOutcome(done('SOURCE_CHANGED'), C, 'source')!;
    expect(o).toEqual({ kind: 'warning', text: `nextcloud was not moved: it changed on appdocker02 while it was being copied, so it stays there. ${MOVE_TARGET_CLEANING('appdocker01')}`, moved: false });
    expect(o.text).not.toContain('works there');
    expect(o.text).not.toContain('moved to');
  });
  it('storedOn = source: another pre-flip failure (SOURCE_NOT_REMOVED, or only the text) stays on the source', () => {
    const want = { kind: 'warning', text: 'nextcloud was not moved, so it stays on appdocker02. A leftover copy is on appdocker01.', moved: false };
    expect(moveOutcome(done('SOURCE_NOT_REMOVED'), C, 'source')).toEqual(want);
    expect(moveOutcome(op('Done', { error: 'MOVED, source not removed: sourceBytes failed', move: { code: null } }), C, 'source')).toEqual(want);
  });
  it('the result text never decides: a "MOVED" text with the row on the source is still "not moved"', () => {
    expect(moveOutcome(done('SOURCE_NOT_REMOVED', 'MOVED, source not removed: removeSource failed'), C, 'source')!.text)
      .toBe('nextcloud was not moved, so it stays on appdocker02. A leftover copy is on appdocker01.');
  });
  it('unknown placement: never claims it is on the target', () => {
    const o = moveOutcome(done('SOURCE_NOT_REMOVED'), C, null)!;
    expect(o.kind).toBe('warning');
    expect(o.text).not.toMatch(/moved to|works there/);
  });
  it('the leftover sentence is one constant', () => {
    expect(MOVE_TARGET_LEFTOVER('appdocker01')).toBe('A leftover copy is on appdocker01.');
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
          <CommandFeedback result={ctl.result} subject={ctl.subject} testId="copy-move-feedback" formatLine={ctl.formatLine} />
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
    const flipped = { ...store().instanceDB, [NEXTCLOUD]: { ...store().instanceDB[NEXTCLOUD], storedOn: D1 } };
    setStore({ ...store(), instanceDB: flipped, operationDB: { mv1: op('Done', { error: 'MOVED, source not removed: helper error' }) } });
    expect(screen.queryByTestId('cross-move-step')).toBeNull();
    expect(screen.getByTestId('cross-move-warning').textContent).toBe("nextcloud moved to appdocker01. The old copy on appdocker02 couldn't be removed.");
    expect(screen.queryByTestId('copy-move-feedback-error')).toBeNull();
  });

  it('source not removed with the row still on the source disk: "was not moved", never "works there"', () => {
    const { store, setStore, ctl } = renderApp(mkStore(both, both));
    drop(ctl());
    fireEvent.click(screen.getByTestId('copy-move-move'));
    setStore({ ...store(), operationDB: { mv1: op('Done', { error: 'MOVED, source not removed: the source was started during the move', move: { sourceInstanceId: NEXTCLOUD, targetInstanceId: NEXTCLOUD, code: 'SOURCE_CHANGED' } }) } });
    const w = screen.getByTestId('cross-move-warning').textContent;
    expect(w).toBe('nextcloud was not moved: it changed on appdocker02 while it was being copied, so it stays there. Cleaning up the copy on appdocker01…');
    expect(w).not.toContain('works there');
  });

  it('a failed move shows one plain sentence (CommandFeedback), not a duplicate', () => {
    const { store, setStore, ctl } = renderApp(mkStore(both, both));
    drop(ctl());
    fireEvent.click(screen.getByTestId('copy-move-move'));
    setStore({ ...store(), operationDB: { mv1: op('Failed', { error: 'MOVE FAILED: the check on the target failed; source kept' }) } });
    expect(screen.getByTestId('copy-move-feedback-error').textContent)
      .toBe("Couldn't move nextcloud (the check on the target failed). Nothing was removed: it is still on appdocker02.");
    expect(screen.queryByTestId('cross-move-failed')).toBeNull();
  });

  it('a failed op with move.code shows that code\'s sentence', () => {
    const { store, setStore, ctl } = renderApp(mkStore(both, both));
    drop(ctl());
    fireEvent.click(screen.getByTestId('copy-move-move'));
    setStore({ ...store(), operationDB: { mv1: op('Failed', { error: 'MOVE FAILED: size 1 != 2; source kept', move: { sourceInstanceId: NEXTCLOUD, code: 'VERIFY_SIZE' } }) } });
    expect(screen.getByTestId('copy-move-feedback-error').textContent).toBe(`${EXPECTED.VERIFY_SIZE} Cleaning up the copy on appdocker01…`);
  });
});
