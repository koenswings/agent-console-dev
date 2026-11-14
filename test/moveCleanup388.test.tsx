/**
 * engine#388 (agent-engine-dev #390, merged 4a30798), Console side: success only when the
 * app moved (MOVED / SOURCE_NOT_REMOVED with the row on the target), the target-copy
 * sentence by move.targetCleanup, SOURCE_KEPT, and the older-Engine fallback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import { createRoot, createSignal } from 'solid-js';
import { setSendCommandFn } from '../src/store/commands';
import { createDragCopyMove } from '../src/store/dragCopyMove';
import NetworkTree from '../src/components/NetworkTree';
import CopyMoveModal from '../src/components/CopyMoveModal';
import CopyMoveFeedback from '../src/components/CopyMoveFeedback';
import MobileAppList from '../src/components/MobileAppList';
import OperationProgress from '../src/components/OperationProgress';
import {
  CAP_MOVE_CROSS, MOVE_CODE_TEXT, MOVE_TARGET_LEFTOVER, MOVE_TARGET_SET_ASIDE, moveOutcome, moveErrorLine,
  settleMoveOutcome, isMoveDoneNotMoved, type TargetCleanup,
} from '../src/store/moveApp';
import { confirmNewOperation } from '../src/store/remoteConfirm';
import { MOCK_IDS, MOCK_STORE } from '../src/mock/mockStore';
import type { CommandLogState } from '../src/store/commandLog';
import type { CommandLogStore, CommandTrace } from '../src/types/commandLog';
import type { Engine, Operation, Store } from '../src/types/store';

const E1 = MOCK_IDS.ENGINE_1_ID; // connected (test/setup.ts)
const E2 = MOCK_IDS.ENGINE_2_ID;
const NEXTCLOUD = MOCK_IDS.INST_NEXTCLOUD_ID; // on DISK002, docked to E2
const KOLIBRI = MOCK_IDS.INST_KOLIBRI_ID; // on DISK001, docked to E1
const D1 = MOCK_IDS.DISK_1_ID;
const D2 = MOCK_IDS.DISK_2_ID;
const C = { app: 'nextcloud', sourceEngine: 'appdocker02', targetEngine: 'appdocker01' };

const caps = (e: Engine): Engine => ({ ...e, capabilities: [CAP_MOVE_CROSS], capabilitiesBootedAt: e.lastBooted } as Engine);
const base = (): Store => ({
  ...MOCK_STORE,
  engineDB: { ...MOCK_STORE.engineDB, [E1]: caps(MOCK_STORE.engineDB[E1]), [E2]: caps(MOCK_STORE.engineDB[E2]) },
  operationDB: {},
});
const op = (status: Operation['status'], move: Record<string, unknown> = {}, extra: Partial<Operation> = {}): Operation => ({
  id: 'mv1', kind: 'moveApp', args: { instanceId: NEXTCLOUD, sourceDiskId: D2, targetDiskId: D1, crossEngine: 'true' },
  cause: 'console-command' as Operation['cause'], subject: null, engineId: E2, status, progressPercent: null,
  currentStep: 2, totalSteps: 3, stepLabel: 'Removing the old copy', startedAt: Date.now(), completedAt: status === 'Running' ? null : Date.now(),
  error: null,
  move: { phase: status === 'Done' ? 'done' : 'failed', targetEngineId: E1, sourceInstanceId: NEXTCLOUD, targetInstanceId: NEXTCLOUD, code: null, resultText: null, targetCleanup: null, targetCleanupDetail: null, ...move },
  ...extra,
} as Operation);
const at = (s: Store, id: string, diskId: string): Store => ({ ...s, instanceDB: { ...s.instanceDB, [id]: { ...s.instanceDB[id], storedOn: diskId } } });

const CLEANUPS: TargetCleanup[] = ['quarantined', 'failed', null];
const suffix = (cleanup: TargetCleanup): string =>
  cleanup === 'quarantined' ? ' The unfinished copy on appdocker01 was set aside.'
    : cleanup === 'failed' ? ' A leftover copy is on appdocker01.' : '';

const FAILED_BASE: Record<string, string> = {
  SOURCE_KEPT: 'nextcloud was not moved, so it stays on appdocker02.',
  VERIFY_NOT_FOUND: "Couldn't move nextcloud: the copy didn't show up on appdocker01. Nothing was removed: it is still on appdocker02.",
  VERIFY_NOT_RUNNING: "Couldn't move nextcloud: the copy on appdocker01 didn't start. Nothing was removed: it is still on appdocker02.",
  VERIFY_SIZE: "Couldn't move nextcloud: the copy on appdocker01 is not complete. Nothing was removed: it is still on appdocker02.",
  VERIFY_TIMEOUT: "Couldn't move nextcloud: appdocker01 didn't confirm the copy in time. Nothing was removed: it is still on appdocker02.",
  VERIFY_FAILED: "Couldn't move nextcloud: the copy on appdocker01 couldn't be checked. Nothing was removed: it is still on appdocker02.",
};
const CHANGED = 'nextcloud was not moved: it changed on appdocker02 while it was being copied, so it stays there.';

let send: ReturnType<typeof vi.fn>;
beforeEach(() => { send = vi.fn(); setSendCommandFn(send); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('sentences per code × move.targetCleanup (engine#388)', () => {
  it('the two target-copy sentences', () => {
    expect(MOVE_TARGET_SET_ASIDE('appdocker01')).toBe('The unfinished copy on appdocker01 was set aside.');
    expect(MOVE_TARGET_LEFTOVER('appdocker01')).toBe('A leftover copy is on appdocker01.');
  });
  for (const [code, text] of Object.entries(FAILED_BASE)) {
    for (const cleanup of CLEANUPS) {
      it(`Failed ${code}, targetCleanup ${cleanup}`, () => {
        const o = moveOutcome(op('Failed', { code, targetCleanup: cleanup }, { error: 'MOVE FAILED: x; source kept, the copy on appdocker01 was quarantined' }), C, 'source')!;
        expect(o).toEqual({ kind: 'failed', text: text + suffix(cleanup), moved: false });
      });
    }
  }
  it('Failed COPY_FAILED: never a target-copy sentence', () => {
    for (const cleanup of CLEANUPS) {
      expect(moveOutcome(op('Failed', { code: 'COPY_FAILED', targetCleanup: cleanup }, { error: 'MOVE FAILED: x; source kept' }), C, 'source')!.text)
        .toBe("Couldn't move nextcloud: the copy to appdocker01 didn't finish. Nothing was removed: it is still on appdocker02.");
    }
  });
  it('refusals never get a target-copy sentence', () => {
    expect(moveErrorLine('MOVE FAILED: x; source kept', 'BUSY', C, 'quarantined')).not.toMatch(/set aside|leftover/);
  });
  for (const cleanup of CLEANUPS) {
    it(`Done SOURCE_CHANGED (row on the source), targetCleanup ${cleanup}: warning, not moved`, () => {
      const o = moveOutcome(op('Done', { code: 'SOURCE_CHANGED', targetCleanup: cleanup }, { error: 'MOVE STOPPED: the source was started; source kept' }), C, 'source')!;
      // null (older Engine): today's storedOn-based leftover sentence
      expect(o).toEqual({ kind: 'warning', text: CHANGED + (cleanup ? suffix(cleanup) : ' A leftover copy is on appdocker01.'), moved: false });
    });
  }
  it('Done SOURCE_CHANGED is never a move, whatever the placement', () => {
    for (const placement of ['source', 'target', null] as const) {
      for (const cleanup of CLEANUPS) {
        const o = moveOutcome(op('Done', { code: 'SOURCE_CHANGED', targetCleanup: cleanup }), C, placement)!;
        expect(o.moved).toBe(false);
        expect(o.kind).toBe('warning');
        expect(o.text).not.toMatch(/moved to/);
      }
    }
    expect(MOVE_CODE_TEXT.SOURCE_CHANGED(C)).toBe(CHANGED);
  });
  it('Done MOVED: moved (row on the target or unknown); with the row on the source: not moved', () => {
    for (const cleanup of CLEANUPS) {
      expect(moveOutcome(op('Done', { code: 'MOVED', targetCleanup: cleanup }), C, 'target')).toEqual({ kind: 'moved', text: 'nextcloud moved to appdocker01.', moved: true });
      expect(moveOutcome(op('Done', { code: 'MOVED', targetCleanup: cleanup }), C, null)!.moved).toBe(true);
      expect(moveOutcome(op('Done', { code: 'MOVED', targetCleanup: cleanup }), C, 'source')!.moved).toBe(false);
    }
  });
  it('Done SOURCE_NOT_REMOVED: moved only with the row on the target', () => {
    const snr = (cleanup: TargetCleanup) => op('Done', { code: 'SOURCE_NOT_REMOVED', targetCleanup: cleanup }, { error: 'MOVED, source not removed: helper error' });
    for (const cleanup of CLEANUPS) {
      expect(moveOutcome(snr(cleanup), C, 'target')).toEqual({ kind: 'warning', text: "nextcloud moved to appdocker01. The old copy on appdocker02 couldn't be removed.", moved: true });
      expect(moveOutcome(snr(cleanup), C, null)!.moved).toBe(false);
    }
  });
  it('older Engine (no code, no targetCleanup): the storedOn logic', () => {
    expect(moveOutcome(op('Done'), C, null)).toEqual({ kind: 'moved', text: 'nextcloud moved to appdocker01.', moved: true });
    const text = op('Done', {}, { error: 'MOVED, source not removed: x' });
    expect(moveOutcome(text, C, 'target')!.moved).toBe(true);
    expect(moveOutcome(text, C, 'source')).toEqual({ kind: 'warning', text: 'nextcloud was not moved, so it stays on appdocker02. A leftover copy is on appdocker01.', moved: false });
    expect(moveOutcome(op('Failed', {}, { error: 'MOVE FAILED: disk full; source kept' }), C)!.text)
      .toBe("Couldn't move nextcloud (disk full). Nothing was removed: it is still on appdocker02.");
  });
});

describe('store confirmation and settle: never green from op Done or trace ok alone', () => {
  it('confirmNewOperation: Done SOURCE_CHANGED is a warning, MOVED is ok, Failed carries the code', () => {
    createRoot((dispose) => {
      const [store, setStore] = createSignal<Store | null>(base());
      const check = confirmNewOperation(store, 'moveApp', NEXTCLOUD, { engineId: E2, args: { targetDiskId: D1 } });
      setStore({ ...base(), operationDB: { mv1: op('Done', { code: 'SOURCE_CHANGED', targetCleanup: 'quarantined' }) } });
      expect(check()).toEqual({ warning: `${CHANGED} The unfinished copy on appdocker01 was set aside.`, code: 'SOURCE_CHANGED' });
      setStore({ ...at(base(), NEXTCLOUD, D1), operationDB: { mv1: op('Done', { code: 'MOVED' }) } });
      expect(check()).toBe('ok');
      setStore({ ...base(), operationDB: { mv1: op('Failed', { code: 'SOURCE_KEPT', targetCleanup: 'failed' }, { error: 'MOVE FAILED: x; source kept' }) } });
      expect(check()).toEqual({ error: 'MOVE FAILED: x; source kept', code: 'SOURCE_KEPT' });
      dispose();
    });
  });
  it('settleMoveOutcome: ok trace with SOURCE_CHANGED (op not yet visible) or a Done not-moved op → warning', () => {
    const [store, setStore] = createSignal<Store | null>(base());
    const settle = settleMoveOutcome(store, NEXTCLOUD, 0, () => C);
    expect(settle({ kind: 'ok', code: 'SOURCE_CHANGED' })).toEqual({ kind: 'warning', message: CHANGED, code: 'SOURCE_CHANGED' });
    expect(settle({ kind: 'ok', code: 'MOVED' })).toEqual({ kind: 'ok', code: 'MOVED' });
    setStore({ ...base(), operationDB: { mv1: op('Done', { code: 'SOURCE_CHANGED', targetCleanup: 'failed' }) } });
    expect(settle({ kind: 'ok' })).toEqual({ kind: 'warning', message: `${CHANGED} A leftover copy is on appdocker01.`, code: 'SOURCE_CHANGED' });
    setStore({ ...at(base(), NEXTCLOUD, D1), operationDB: { mv1: op('Done', { code: 'MOVED' }) } });
    expect(settle({ kind: 'ok' })).toEqual({ kind: 'ok' });
    expect(settle({ kind: 'error', message: 'x' })).toEqual({ kind: 'error', message: 'x' });
  });
});

const own = (): CommandLogState => ({ status: 'ready', log: { traces: {}, recentTraceIds: [] } } as unknown as CommandLogState);

describe('desktop drag Move (CopyMoveFeedback)', () => {
  const renderDesktop = () => {
    const [store, setStore] = createSignal<Store | null>(base());
    let ctl!: ReturnType<typeof createDragCopyMove>;
    render(() => {
      ctl = createDragCopyMove(store, own);
      return (
        <div>
          <NetworkTree store={store} selection={{ type: 'network', id: '' }} onSelect={() => {}} dragData={ctl.dragData} onDrop={ctl.handleDrop} commandLogStore={own} />
          <CopyMoveFeedback store={store} ctl={ctl} />
          <CopyMoveModal ctl={ctl} />
        </div>
      );
    });
    ctl.setDragData({ instanceId: NEXTCLOUD, instanceName: 'nextcloud', sourceDiskId: D2, sourceDiskName: 'src' });
    const target = screen.getByTestId(`disk-${D1}`);
    fireEvent.dragOver(target);
    fireEvent.drop(target);
    fireEvent.click(screen.getByTestId('copy-move-move'));
    return { store: () => store()!, setStore, ctl: () => ctl };
  };

  it('Done SOURCE_CHANGED with an ok trace: one amber "not moved" line, no success', () => {
    const { store, setStore, ctl } = renderDesktop();
    setStore({ ...store(), operationDB: { mv1: op('Done', { code: 'SOURCE_CHANGED', targetCleanup: 'quarantined' }, { error: 'MOVE STOPPED: x; source kept, the copy on appdocker01 was quarantined' }) } });
    expect(screen.queryByTestId('cross-move-moved')).toBeNull();
    expect(screen.getByTestId('cross-move-warning').textContent).toBe(`${CHANGED} The unfinished copy on appdocker01 was set aside.`);
    expect(ctl().result.state()).toEqual({ kind: 'warning', message: `${CHANGED} The unfinished copy on appdocker01 was set aside.`, code: 'SOURCE_CHANGED' });
    // The outcome line already says it: no duplicate CommandFeedback line
    expect(screen.queryByTestId('copy-move-feedback-warning')).toBeNull();
    expect(screen.queryByTestId('copy-move-feedback-error')).toBeNull();
  });

  it('Done MOVED with the row on the target: the success line', () => {
    const { store, setStore, ctl } = renderDesktop();
    setStore({ ...at(store(), NEXTCLOUD, D1), operationDB: { mv1: op('Done', { code: 'MOVED' }) } });
    expect(screen.getByTestId('cross-move-moved').textContent).toBe('nextcloud moved to appdocker01.');
    expect(ctl().result.state().kind).toBe('success');
  });

  it('Failed SOURCE_KEPT / VERIFY_SIZE: the code sentence plus the target-copy sentence', () => {
    const { store, setStore } = renderDesktop();
    setStore({ ...store(), operationDB: { mv1: op('Failed', { code: 'SOURCE_KEPT', targetCleanup: 'quarantined' }, { error: 'MOVE FAILED: verify was not recorded; source kept, the copy on appdocker01 was quarantined' }) } });
    expect(screen.getByTestId('copy-move-feedback-error').textContent).toBe(`${FAILED_BASE.SOURCE_KEPT} The unfinished copy on appdocker01 was set aside.`);
  });

  it('Failed VERIFY_SIZE with targetCleanup failed', () => {
    const { store, setStore } = renderDesktop();
    setStore({ ...store(), operationDB: { mv1: op('Failed', { code: 'VERIFY_SIZE', targetCleanup: 'failed' }, { error: 'MOVE FAILED: size; source kept, the leftover copy is on appdocker01' }) } });
    expect(screen.getByTestId('copy-move-feedback-error').textContent).toBe(`${FAILED_BASE.VERIFY_SIZE} A leftover copy is on appdocker01.`);
  });
});

describe('mobile Move sheet', () => {
  const trace = (over: Partial<CommandTrace>): CommandTrace => ({
    traceId: 't1', command: 'moveApp', args: { instanceName: 'kolibri' }, startedAt: 0, completedAt: 0, status: 'ok', errorMessage: null, logs: [], ...over,
  });
  const log = (...traces: CommandTrace[]): CommandLogStore => ({ traces: Object.fromEntries(traces.map((t) => [t.traceId, t])), recentTraceIds: traces.map((t) => t.traceId) });
  const openMove = (name: string) => {
    const card = screen.getByText(name).closest('.mobile-app-card') as HTMLElement;
    fireEvent.click(card.querySelector('.mobile-app-card__more-btn')!);
    const moveBtn = Array.from(document.querySelectorAll('.mobile-sheet__op-btn')).find((b) => /Move/.test(b.textContent ?? '')) as HTMLElement;
    fireEvent.click(moveBtn);
    const rows = Array.from(document.querySelectorAll('.mobile-sheet__disk-row')) as HTMLElement[];
    fireEvent.click(rows[0]);
    fireEvent.click(document.querySelector('.mobile-sheet__confirm') as HTMLElement);
    const cmd = String(send.mock.calls.at(-1)?.[1] ?? '');
    return cmd.split(' ')[3];
  };

  it('connected source Engine: ok trace + Done SOURCE_CHANGED op → amber warning on the card, not success', () => {
    const [store, setStore] = createSignal<Store | null>(base());
    const [cls, setCls] = createSignal<CommandLogState>(log());
    render(() => <MobileAppList store={() => store()} commandLogStore={cls} />);
    const targetDiskId = openMove('kolibri');
    expect(send.mock.calls.at(-1)?.[1]).toMatch(/^moveApp kolibri DISK001 /);
    const targetEngine = String(store()!.diskDB[targetDiskId].dockedTo);
    const host = (id: string) => String(store()!.engineDB[id].hostname);
    setStore({ ...store()!, operationDB: { mv1: op('Done', { code: 'SOURCE_CHANGED', targetCleanup: 'quarantined', sourceInstanceId: KOLIBRI, targetInstanceId: KOLIBRI, targetEngineId: targetEngine }, {
      engineId: E1, args: { instanceId: KOLIBRI, sourceDiskId: D1, targetDiskId, crossEngine: 'true' },
    }) } });
    setCls(log(trace({ args: { instanceName: 'kolibri', sourceDiskId: D1, targetDiskId }, result: JSON.stringify({ code: 'SOURCE_CHANGED' }) })));
    const w = screen.getByTestId(`mobile-instance-cmd-${KOLIBRI}-warning`);
    expect(w.textContent).toBe(`kolibri was not moved: it changed on ${host(E1)} while it was being copied, so it stays there. The unfinished copy on ${host(targetEngine)} was set aside.`);
    expect(w.className).toContain('command-feedback--warning');
    expect(screen.queryByTestId(`mobile-instance-cmd-${KOLIBRI}-error`)).toBeNull();
  });

  it('remote source Engine (store confirmation): Done SOURCE_CHANGED → warning; Failed SOURCE_KEPT → code sentence', () => {
    const [store, setStore] = createSignal<Store | null>(base());
    render(() => <MobileAppList store={() => store()} commandLogStore={own} />);
    const targetDiskId = openMove('nextcloud');
    expect(send.mock.calls.at(-1)?.[0]).toBe(E2);
    const targetEngine = String(store()!.diskDB[targetDiskId].dockedTo);
    const host = (id: string) => String(store()!.engineDB[id].hostname);
    const mv = (status: Operation['status'], move: Record<string, unknown>, error: string | null) =>
      op(status, { ...move, targetEngineId: targetEngine }, { args: { instanceId: NEXTCLOUD, sourceDiskId: D2, targetDiskId, crossEngine: 'true' }, error });
    expect(screen.getByTestId(`mobile-instance-cmd-${NEXTCLOUD}-sent`)).toBeInTheDocument();
    setStore({ ...store()!, operationDB: { mv1: mv('Done', { code: 'SOURCE_CHANGED', targetCleanup: 'failed' }, 'MOVE STOPPED: x; source kept') } });
    expect(screen.getByTestId(`mobile-instance-cmd-${NEXTCLOUD}-warning`).textContent)
      .toBe(`nextcloud was not moved: it changed on ${host(E2)} while it was being copied, so it stays there. A leftover copy is on ${host(targetEngine)}.`);
    // A second Move from the sheet, which fails pre-flip
    const target2 = openMove('nextcloud');
    setStore({ ...store()!, operationDB: { ...store()!.operationDB, mv2: { ...mv('Failed', { code: 'SOURCE_KEPT', targetCleanup: 'quarantined' }, 'MOVE FAILED: x; source kept'), id: 'mv2', args: { instanceId: NEXTCLOUD, sourceDiskId: D2, targetDiskId: target2, crossEngine: 'true' }, startedAt: Date.now() + 1 } } });
    expect(screen.getByTestId(`mobile-instance-cmd-${NEXTCLOUD}-error`).textContent)
      .toBe(`nextcloud was not moved, so it stays on ${host(E2)}. The unfinished copy on ${host(targetEngine)} was set aside.`);
  });
});

describe('op cards (OperationProgress)', () => {
  const emptyLog = (): CommandLogState => ({ traces: {}, recentTraceIds: [] } as unknown as CommandLogState);
  it('Done SOURCE_CHANGED: amber "Not moved" card with its sentence, kept past 3 s until dismissed', () => {
    vi.useFakeTimers();
    const store: Store = { ...base(), operationDB: { mv1: op('Done', { code: 'SOURCE_CHANGED', targetCleanup: 'quarantined' }, { completedAt: Date.now() - 60_000, error: 'MOVE STOPPED: x; source kept' }) } };
    render(() => <OperationProgress store={() => store} commandLogStore={emptyLog} />);
    const card = screen.getByTestId('operation-card-mv1');
    expect(card.className).toContain('operation-card--warning');
    expect(card.className).not.toContain('operation-card--done');
    expect(card.textContent).toContain('⚠ Not moved');
    expect(card.textContent).not.toContain('✓ Done');
    expect(screen.getByTestId('operation-warning-mv1').textContent).toBe(`${CHANGED} The unfinished copy on appdocker01 was set aside.`);
    vi.advanceTimersByTime(4_000);
    expect(screen.getByTestId('operation-card-mv1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('operation-dismiss-mv1'));
    expect(screen.queryByTestId('operation-card-mv1')).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('Done MOVED: green ✓ Done, auto-dismissed after 3 s', () => {
    vi.useFakeTimers();
    const store: Store = { ...at(base(), NEXTCLOUD, D1), operationDB: { mv1: op('Done', { code: 'MOVED' }) } };
    render(() => <OperationProgress store={() => store} commandLogStore={emptyLog} />);
    const card = screen.getByTestId('operation-card-mv1');
    expect(card.className).toContain('operation-card--done');
    expect(card.textContent).toContain('✓ Done');
    vi.advanceTimersByTime(3_100);
    expect(screen.queryByTestId('operation-card-mv1')).toBeNull();
  });

  it('Failed SOURCE_KEPT card shows the Console sentence, not the raw Engine text', () => {
    const store: Store = { ...base(), operationDB: { mv1: op('Failed', { code: 'SOURCE_KEPT', targetCleanup: 'failed' }, { error: 'MOVE FAILED: verify was not recorded; source kept, the leftover copy is on appdocker01' }) } };
    render(() => <OperationProgress store={() => store} commandLogStore={emptyLog} />);
    expect(screen.getByTestId('operation-card-mv1').querySelector('.operation-card__error')!.textContent)
      .toBe(`${FAILED_BASE.SOURCE_KEPT} A leftover copy is on appdocker01.`);
  });

  it('older Engine Done move without a code: still a normal Done card', () => {
    const store: Store = { ...base(), operationDB: { mv1: op('Done', { code: null }) } };
    expect(isMoveDoneNotMoved(store, store.operationDB.mv1)).toBe(false);
  });
});
