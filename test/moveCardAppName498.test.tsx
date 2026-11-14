/**
 * idea#498: a move op card that outlives its app (removed since) must not name the app by its
 * id. Engine fd52c8a moveApp / copyApp ops carry only args.instanceId (no name anywhere on
 * the op; live ops o3ob1p3i2f2738udgsm, xjaniujyu7x8k2h7dht), so the fallback is "The app".
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@solidjs/testing-library';
import OperationProgress from '../src/components/OperationProgress';
import { moveCtxOf, moveOpOutcome } from '../src/store/moveApp';
import { MOCK_IDS, MOCK_STORE } from '../src/mock/mockStore';
import type { CommandLogState } from '../src/store/commandLog';
import type { Operation, Store } from '../src/types/store';

const E1 = MOCK_IDS.ENGINE_1_ID; // appdocker01, the target
const E2 = MOCK_IDS.ENGINE_2_ID; // appdocker02, the source
const NEXTCLOUD = MOCK_IDS.INST_NEXTCLOUD_ID;
const D1 = MOCK_IDS.DISK_1_ID;
const D2 = MOCK_IDS.DISK_2_ID;
const GONE = '75fkqcb27rqf5abkw5n'; // the live re-walk's removed scratch app

/** The real Engine fd52c8a op shape: args without a name, move info without a name. */
const op = (status: Operation['status'], instanceId: string, move: Record<string, unknown> = {}, extra: Partial<Operation> = {}): Operation => ({
  id: 'mv1', kind: 'moveApp', args: { crossEngine: 'true', instanceId, sourceDiskId: D2, targetDiskId: D1 },
  cause: 'console-command' as Operation['cause'], subject: { type: 'instance', id: instanceId }, engineId: E2, status, progressPercent: null,
  currentStep: 2, totalSteps: 3, stepLabel: 'Removing the old copy', startedAt: Date.now(), completedAt: Date.now(), error: null,
  move: { phase: status === 'Done' ? 'done' : 'failed', targetEngineId: E1, sourceInstanceId: instanceId, targetInstanceId: instanceId, code: null, resultText: null, targetCleanup: null, targetCleanupDetail: null, ...move },
  ...extra,
} as Operation);
const store = (ops: Record<string, Operation>, instanceDB: Store['instanceDB'] = MOCK_STORE.instanceDB): Store => ({ ...MOCK_STORE, instanceDB, operationDB: ops });
const emptyLog = (): CommandLogState => ({ traces: {}, recentTraceIds: [] } as unknown as CommandLogState);

afterEach(() => cleanup());

describe('moveCtxOf: the app name on a move op (idea#498)', () => {
  it('the instance row\'s name while the app exists', () => {
    const o = op('Done', NEXTCLOUD, { code: 'MOVED' });
    expect(moveCtxOf(store({ mv1: o }), o).app).toBe('nextcloud');
  });

  it('row removed since, real Engine op (no name anywhere): "The app", never the id', () => {
    const o = op('Done', GONE, { code: 'SOURCE_CHANGED', targetCleanup: 'quarantined' }, { error: 'MOVE STOPPED: the source was written to during the move; source kept, the copy on appdocker01 was quarantined' });
    const s = store({ mv1: o });
    expect(moveCtxOf(s, o).app).toBe('The app');
    const text = moveOpOutcome(s, o)!.text;
    expect(text).toBe('The app was not moved: it changed on appdocker02 while it was being copied, so it stays there. The unfinished copy on appdocker01 was set aside.');
    expect(text).not.toContain(GONE);
  });

  it('a name in the op args is used when the row is gone (older / future Engines)', () => {
    const o = op('Done', GONE, { code: 'SOURCE_CHANGED', targetCleanup: 'failed' });
    expect(moveCtxOf(store({}), { ...o, args: { ...o.args, instanceName: 'pix498c-web' } } as Operation).app).toBe('pix498c-web');
    expect(moveCtxOf(store({}), { ...o, args: { ...o.args, name: 'pix498c-web' } } as Operation).app).toBe('pix498c-web');
    expect(moveCtxOf(store({}), { ...o, args: { ...o.args, instanceName: '  ' } } as Operation).app).toBe('The app');
  });

  it('older Engine fresh-id copy: the source row is gone, the target row names the app', () => {
    const o = op('Done', GONE, { code: 'MOVED', targetInstanceId: NEXTCLOUD });
    expect(moveCtxOf(store({ mv1: o }), o).app).toBe('nextcloud');
  });

  it('mid-sentence the fallback is lower case: "Couldn\'t move the app: …"', () => {
    const verify = op('Failed', GONE, { code: 'VERIFY_SIZE', targetCleanup: 'quarantined' }, { error: 'MOVE FAILED: x; source kept' });
    expect(moveOpOutcome(store({ mv1: verify }), verify)!.text)
      .toBe("Couldn't move the app: the copy on appdocker01 is not complete. Nothing was removed: it is still on appdocker02. The unfinished copy on appdocker01 was set aside.");
    const unknown = op('Failed', GONE, {}, { error: 'MOVE FAILED: disk on fire; source kept' });
    expect(moveOpOutcome(store({ mv1: unknown }), unknown)!.text).toBe("Couldn't move the app (disk on fire). Nothing was removed: it is still on appdocker02.");
    const kept = op('Failed', GONE, { code: 'SOURCE_KEPT', targetCleanup: 'failed' });
    expect(moveOpOutcome(store({ mv1: kept }), kept)!.text).toBe('The app was not moved, so it stays on appdocker02. A leftover copy is on appdocker01.');
  });
});

describe('op card of a removed app (OperationProgress)', () => {
  it('Done SOURCE_CHANGED: the amber card names "The app", and neither line shows the id', () => {
    const o = op('Done', GONE, { code: 'SOURCE_CHANGED', targetCleanup: 'quarantined' }, { error: 'MOVE STOPPED: x; source kept' });
    const s = store({ mv1: o });
    render(() => <OperationProgress store={() => s} commandLogStore={emptyLog} />);
    expect(screen.getByTestId('operation-warning-mv1').textContent).toMatch(/^The app was not moved: it changed on appdocker02/);
    expect(screen.getByTestId('operation-card-mv1').textContent).not.toContain(GONE);
  });

  it('Failed copyApp of a removed app: the card does not show the id either', () => {
    const c = { ...op('Failed', GONE, {}, { error: 'copy failed' }), id: 'cp1', kind: 'copyApp', args: { instanceId: GONE, sourceDiskId: D2, targetDiskId: D1 } } as unknown as Operation;
    const s = store({ cp1: c });
    render(() => <OperationProgress store={() => s} commandLogStore={emptyLog} />);
    expect(screen.getByTestId('operation-card-cp1').textContent).not.toContain(GONE);
  });
});
