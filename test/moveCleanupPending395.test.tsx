/**
 * engine#395 (fd52c8a), Console side: a moveApp op turns Failed / Done BEFORE
 * move.targetCleanup lands (up to the Engine's 60 s cleanup timeout). Until then a
 * cleanup code says "Cleaning up the copy on <target>…", then switches reactively to
 * the set-aside or leftover sentence; after 70 s on the op's Engine clock, or a
 * timed-out text, it falls back to the leftover sentence. COPY_FAILED never gets one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { setSendCommandFn } from '../src/store/commands';
import { createDragCopyMove } from '../src/store/dragCopyMove';
import NetworkTree from '../src/components/NetworkTree';
import CopyMoveModal from '../src/components/CopyMoveModal';
import CopyMoveFeedback from '../src/components/CopyMoveFeedback';
import MobileAppList from '../src/components/MobileAppList';
import OperationProgress from '../src/components/OperationProgress';
import {
  CAP_MOVE_CROSS, MOVE_CLEANUP_WAIT_MS, MOVE_TARGET_CLEANING, cleanupTimedOut, cleanupView, moveOpOutcome, moveOutcome,
} from '../src/store/moveApp';
import { receiveEphemeral, resetLive, tickLiveNow } from '../src/store/live';
import { MOCK_IDS, MOCK_STORE } from '../src/mock/mockStore';
import type { CommandLogState } from '../src/store/commandLog';
import type { Engine, Operation, Store } from '../src/types/store';

const E1 = MOCK_IDS.ENGINE_1_ID; // appdocker01, the target
const E2 = MOCK_IDS.ENGINE_2_ID; // appdocker02, the source
const NEXTCLOUD = MOCK_IDS.INST_NEXTCLOUD_ID; // on DISK002, docked to E2
const D1 = MOCK_IDS.DISK_1_ID;
const D2 = MOCK_IDS.DISK_2_ID;
const C = { app: 'nextcloud', sourceEngine: 'appdocker02', targetEngine: 'appdocker01' };
const CHANGED = 'nextcloud was not moved: it changed on appdocker02 while it was being copied, so it stays there.';
const KEPT = 'nextcloud was not moved, so it stays on appdocker02.';
const COPY = "Couldn't move nextcloud: the copy to appdocker01 didn't finish. Nothing was removed: it is still on appdocker02.";
const CLEANING = ' Cleaning up the copy on appdocker01…';
const SET_ASIDE = ' The unfinished copy on appdocker01 was set aside.';
const LEFTOVER = ' A leftover copy is on appdocker01.';
const TIMED_OUT = 'timed out waiting for appdocker01 to confirm the target cleanup';

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
const own = (): CommandLogState => ({ status: 'ready', log: { traces: {}, recentTraceIds: [] } } as unknown as CommandLogState);
const emptyLog = (): CommandLogState => ({ traces: {}, recentTraceIds: [] } as unknown as CommandLogState);
/** The same op with the Engine's later targetCleanup patch (engine#395). */
const landed = (o: Operation, targetCleanup: 'quarantined' | 'failed', targetCleanupDetail: string | null = null): Operation =>
  ({ ...o, move: { ...(o as unknown as { move: Record<string, unknown> }).move, targetCleanup, targetCleanupDetail } } as Operation);

let send: ReturnType<typeof vi.fn>;
beforeEach(() => { send = vi.fn(); setSendCommandFn(send); });
afterEach(() => { cleanup(); vi.useRealTimers(); setSendCommandFn(() => {}); resetLive(); tickLiveNow(); });

describe('cleanupView and the pending sentence (engine#395)', () => {
  it('the pending sentence', () => {
    expect(MOVE_TARGET_CLEANING('appdocker01')).toBe('Cleaning up the copy on appdocker01…');
  });

  it('SOURCE_CHANGED Done: pending while targetCleanup is null, set aside once quarantined', () => {
    const t = Date.now();
    const done = op('Done', { code: 'SOURCE_CHANGED' }, { completedAt: t, error: 'MOVE STOPPED: x; source kept' });
    expect(cleanupView(done, t + 1_000)).toBe('pending');
    expect(moveOutcome(done, C, 'source', t + 1_000)).toEqual({ kind: 'warning', text: CHANGED + CLEANING, moved: false });
    // Never the leftover sentence first (problem a)
    expect(moveOutcome(done, C, 'source', t + 1_000)!.text).not.toContain('leftover');
    expect(moveOutcome(landed(done, 'quarantined'), C, 'source', t + 5_000)).toEqual({ kind: 'warning', text: CHANGED + SET_ASIDE, moved: false });
  });

  it('SOURCE_KEPT Failed: pending while null, leftover once failed', () => {
    const t = Date.now();
    const failed = op('Failed', { code: 'SOURCE_KEPT' }, { completedAt: t, error: 'MOVE FAILED: x; source kept' });
    expect(moveOutcome(failed, C, 'source', t + 1_000)).toEqual({ kind: 'failed', text: KEPT + CLEANING, moved: false });
    expect(moveOutcome(landed(failed, 'failed', 'docker stop failed'), C, 'source', t + 5_000)).toEqual({ kind: 'failed', text: KEPT + LEFTOVER, moved: false });
  });

  it('VERIFY_* Failed: pending while null (problem b)', () => {
    const t = Date.now();
    for (const code of ['VERIFY_NOT_FOUND', 'VERIFY_NOT_RUNNING', 'VERIFY_SIZE', 'VERIFY_TIMEOUT', 'VERIFY_FAILED']) {
      expect(moveOutcome(op('Failed', { code }, { completedAt: t }), C, 'source', t)!.text).toMatch(/ Cleaning up the copy on appdocker01…$/);
    }
  });

  it('COPY_FAILED never gets a target-copy sentence: null, set, timed out, or 70 s later', () => {
    const t = Date.now();
    const copy = op('Failed', { code: 'COPY_FAILED' }, { completedAt: t, error: 'MOVE FAILED: x; source kept' });
    for (const o of [copy, landed(copy, 'quarantined'), landed(copy, 'failed', TIMED_OUT)]) {
      for (const now of [t, t + MOVE_CLEANUP_WAIT_MS + 1]) {
        expect(moveOutcome(o, C, 'source', now)!.text).toBe(COPY);
      }
    }
    expect(cleanupView(copy, t)).toBeNull();
  });

  it('codeless older Engine: keeps the leftover fallback, never "Cleaning up"', () => {
    const t = Date.now();
    const old = op('Done', {}, { completedAt: t, error: 'MOVED, source not removed: the source was started during the move' });
    expect(cleanupView(old, t)).toBeNull();
    expect(moveOutcome(old, C, 'source', t)!.text).toBe(KEPT + LEFTOVER);
  });

  it('70 s after the op ended (Engine clock) with no targetCleanup: the leftover sentence', () => {
    const t = Date.now();
    const done = op('Done', { code: 'SOURCE_CHANGED' }, { completedAt: t });
    expect(moveOutcome(done, C, 'source', t + MOVE_CLEANUP_WAIT_MS - 1)!.text).toBe(CHANGED + CLEANING);
    expect(moveOutcome(done, C, 'source', t + MOVE_CLEANUP_WAIT_MS)!.text).toBe(CHANGED + LEFTOVER);
    // The field still wins when it lands late
    expect(moveOutcome(landed(done, 'quarantined'), C, 'source', t + 90_000)!.text).toBe(CHANGED + SET_ASIDE);
  });

  it('a timed-out detail or op text: the leftover sentence at once', () => {
    const t = Date.now();
    // targetCleanupDetail says it timed out (status not set: belt and braces)
    const byDetail = op('Failed', { code: 'SOURCE_KEPT', targetCleanupDetail: TIMED_OUT }, { completedAt: t });
    expect(cleanupTimedOut(byDetail)).toBe(true);
    expect(moveOutcome(byDetail, C, 'source', t)!.text).toBe(KEPT + LEFTOVER);
    // the op error / resultText says it timed out
    const byText = op('Done', { code: 'SOURCE_CHANGED', resultText: `MOVE STOPPED: x; source kept, ${TIMED_OUT}` }, { completedAt: t, error: `MOVE STOPPED: x; source kept, ${TIMED_OUT}` });
    expect(cleanupTimedOut(byText)).toBe(true);
    expect(moveOutcome(byText, C, 'source', t)!.text).toBe(CHANGED + LEFTOVER);
    // VERIFY_TIMEOUT's own "did not confirm the copy in time" is not a cleanup timeout
    const verify = op('Failed', { code: 'VERIFY_TIMEOUT' }, { completedAt: t, error: 'MOVE FAILED: appdocker01 did not confirm the copy in time; source kept' });
    expect(cleanupTimedOut(verify)).toBe(false);
    expect(moveOutcome(verify, C, 'source', t)!.text).toMatch(/Cleaning up the copy on appdocker01…$/);
  });
});

describe('the 70 s fallback on the live clock (moveOpOutcome)', () => {
  it('flips on the shared liveNow tick, without user action (Console clock when no hb)', () => {
    const t = Date.now();
    const store: Store = { ...base(), operationDB: { mv1: op('Done', { code: 'SOURCE_CHANGED' }, { completedAt: t }) } };
    tickLiveNow(t + 10_000);
    expect(moveOpOutcome(store, store.operationDB.mv1)!.text).toBe(CHANGED + CLEANING);
    tickLiveNow(t + MOVE_CLEANUP_WAIT_MS + 1_000);
    expect(moveOpOutcome(store, store.operationDB.mv1)!.text).toBe(CHANGED + LEFTOVER);
  });

  it('measured on the op\'s Engine clock from its hb, not the Console clock', () => {
    const t = Date.now();
    // The source Engine's clock is an hour behind the Console: its op ended at its own t.
    const engineT = t - 3_600_000;
    const store: Store = { ...base(), operationDB: { mv1: op('Done', { code: 'SOURCE_CHANGED' }, { completedAt: engineT }) } };
    receiveEphemeral({ type: 'idea/hb', n: 1, v: 1, engineId: E2, now: engineT + 5_000, bootedAt: 0 }, t);
    tickLiveNow(t);
    expect(moveOpOutcome(store, store.operationDB.mv1)!.text).toBe(CHANGED + CLEANING);
    tickLiveNow(t + MOVE_CLEANUP_WAIT_MS);
    expect(moveOpOutcome(store, store.operationDB.mv1)!.text).toBe(CHANGED + LEFTOVER);
  });

  it('op card: "Cleaning up…" turns into the leftover sentence on the tick; still amber and kept', () => {
    vi.useFakeTimers();
    const t = Date.now();
    tickLiveNow(t);
    const [store] = createSignal<Store>({ ...base(), operationDB: { mv1: op('Done', { code: 'SOURCE_CHANGED' }, { completedAt: t }) } });
    render(() => <OperationProgress store={store} commandLogStore={emptyLog} />);
    expect(screen.getByTestId('operation-warning-mv1').textContent).toBe(CHANGED + CLEANING);
    tickLiveNow(t + MOVE_CLEANUP_WAIT_MS + 5_000);
    vi.advanceTimersByTime(4_000);
    expect(screen.getByTestId('operation-warning-mv1').textContent).toBe(CHANGED + LEFTOVER);
    expect(screen.getByTestId('operation-card-mv1').className).toContain('operation-card--warning');
  });
});

describe('panel and cards follow targetCleanup after the op settled (problem c)', () => {
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

  it('desktop: Done SOURCE_CHANGED warning line, null then quarantined', () => {
    const { store, setStore, ctl } = renderDesktop();
    const done = op('Done', { code: 'SOURCE_CHANGED' }, { error: 'MOVE STOPPED: x; source kept' });
    setStore({ ...store(), operationDB: { mv1: done } });
    expect(ctl().result.state().kind).toBe('warning');
    expect(screen.getByTestId('cross-move-warning').textContent).toBe(CHANGED + CLEANING);
    setStore({ ...store(), operationDB: { mv1: landed(done, 'quarantined') } });
    expect(screen.getByTestId('cross-move-warning').textContent).toBe(CHANGED + SET_ASIDE);
    expect(screen.queryByTestId('copy-move-feedback-warning')).toBeNull();
  });

  it('desktop: Failed SOURCE_KEPT error line, null then failed (settled before the field lands)', () => {
    const { store, setStore, ctl } = renderDesktop();
    const failed = op('Failed', { code: 'SOURCE_KEPT' }, { error: 'MOVE FAILED: x; source kept' });
    setStore({ ...store(), operationDB: { mv1: failed } });
    expect(ctl().result.state().kind).toBe('error');
    expect(screen.getByTestId('copy-move-feedback-error').textContent).toBe(KEPT + CLEANING);
    setStore({ ...store(), operationDB: { mv1: landed(failed, 'failed', 'docker stop failed') } });
    expect(screen.getByTestId('copy-move-feedback-error').textContent).toBe(KEPT + LEFTOVER);
  });

  it('desktop: Failed COPY_FAILED error line has no target-copy sentence, also when a cleanup value shows up', () => {
    const { store, setStore } = renderDesktop();
    const failed = op('Failed', { code: 'COPY_FAILED' }, { error: 'MOVE FAILED: x; source kept' });
    setStore({ ...store(), operationDB: { mv1: failed } });
    expect(screen.getByTestId('copy-move-feedback-error').textContent).toBe(COPY);
    setStore({ ...store(), operationDB: { mv1: landed(failed, 'quarantined') } });
    expect(screen.getByTestId('copy-move-feedback-error').textContent).toBe(COPY);
  });

  it('mobile Move sheet: the settled warning follows the newest op (null then quarantined)', () => {
    const [store, setStore] = createSignal<Store | null>(base());
    render(() => <MobileAppList store={() => store()} commandLogStore={own} />);
    const card = screen.getByText('nextcloud').closest('.mobile-app-card') as HTMLElement;
    fireEvent.click(card.querySelector('.mobile-app-card__more-btn')!);
    fireEvent.click(Array.from(document.querySelectorAll('.mobile-sheet__op-btn')).find((b) => /Move/.test(b.textContent ?? '')) as HTMLElement);
    fireEvent.click((Array.from(document.querySelectorAll('.mobile-sheet__disk-row')) as HTMLElement[])[0]);
    fireEvent.click(document.querySelector('.mobile-sheet__confirm') as HTMLElement);
    const targetDiskId = String(send.mock.calls.at(-1)?.[1] ?? '').split(' ')[3];
    const targetEngine = String(store()!.diskDB[targetDiskId].dockedTo);
    const host = (id: string) => String(store()!.engineDB[id].hostname);
    const done = op('Done', { code: 'SOURCE_CHANGED', targetEngineId: targetEngine }, { args: { instanceId: NEXTCLOUD, sourceDiskId: D2, targetDiskId, crossEngine: 'true' }, error: 'MOVE STOPPED: x; source kept' });
    setStore({ ...store()!, operationDB: { mv1: done } });
    const w = () => screen.getByTestId(`mobile-instance-cmd-${NEXTCLOUD}-warning`).textContent;
    const changed = `nextcloud was not moved: it changed on ${host(E2)} while it was being copied, so it stays there.`;
    expect(w()).toBe(`${changed} Cleaning up the copy on ${host(targetEngine)}…`);
    setStore({ ...store()!, operationDB: { mv1: landed(done, 'quarantined') } });
    expect(w()).toBe(`${changed} The unfinished copy on ${host(targetEngine)} was set aside.`);
  });

  it('op card: Failed SOURCE_KEPT, null then failed', () => {
    const failed = op('Failed', { code: 'SOURCE_KEPT' }, { error: 'MOVE FAILED: x; source kept' });
    const [store, setStore] = createSignal<Store>({ ...base(), operationDB: { mv1: failed } });
    render(() => <OperationProgress store={store} commandLogStore={emptyLog} />);
    const err = () => screen.getByTestId('operation-card-mv1').querySelector('.operation-card__error')!.textContent;
    expect(err()).toBe(KEPT + CLEANING);
    setStore({ ...store(), operationDB: { mv1: landed(failed, 'failed') } });
    expect(err()).toBe(KEPT + LEFTOVER);
  });
});
