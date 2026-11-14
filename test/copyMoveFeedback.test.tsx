/**
 * idea#498: the copy/move feedback renders in one panel (CopyMoveFeedback), the
 * same on desktop and mobile, and "Sent to …, waiting for confirmation" gives
 * way to the step line once the Engine's moveApp op is in the store.
 * Reference: live proof op 5jcawfpp66k78fhamfg (/workspace/pixel-tmp/live498).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { setSendCommandFn } from '../src/store/commands';
import { createDragCopyMove } from '../src/store/dragCopyMove';
import { CAP_MOVE_CROSS } from '../src/store/moveApp';
import { receiveEphemeral, resetLive } from '../src/store/live';
import { resetMoveChecking } from '../src/store/moveChecking';
import NetworkTree from '../src/components/NetworkTree';
import CopyMoveModal from '../src/components/CopyMoveModal';
import CopyMoveFeedback from '../src/components/CopyMoveFeedback';
import MobileLayout from '../src/components/MobileLayout';
import { MOCK_IDS, MOCK_STORE } from '../src/mock/mockStore';
import type { CommandLogState } from '../src/store/commandLog';
import type { Engine, Operation, Store } from '../src/types/store';

const E1 = MOCK_IDS.ENGINE_1_ID; // appdocker01, connected (test/setup.ts)
const E2 = MOCK_IDS.ENGINE_2_ID; // appdocker02, the source
const NEXTCLOUD = MOCK_IDS.INST_NEXTCLOUD_ID; // on DISK002 (E2)
const D1 = MOCK_IDS.DISK_1_ID;
const D2 = MOCK_IDS.DISK_2_ID;

const caps = (e: Engine): Engine => ({ ...e, capabilities: [CAP_MOVE_CROSS], capabilitiesBootedAt: e.lastBooted } as Engine);
const base = (): Store => ({ ...MOCK_STORE, engineDB: { ...MOCK_STORE.engineDB, [E1]: caps(MOCK_STORE.engineDB[E1]), [E2]: caps(MOCK_STORE.engineDB[E2]) }, operationDB: {} });
const mv = (status: Operation['status'], over: Record<string, unknown> = {}): Operation => ({
  id: 'mv1', kind: 'moveApp', args: { instanceId: NEXTCLOUD, sourceDiskId: D2, targetDiskId: D1, crossEngine: 'true' },
  cause: 'console-command' as Operation['cause'], subject: null, engineId: E2, status, progressPercent: null,
  currentStep: 0, totalSteps: 3, stepLabel: 'Copying', startedAt: Date.now(), completedAt: null, error: null,
  move: { phase: 'copying', targetEngineId: E1, sourceInstanceId: NEXTCLOUD, targetInstanceId: NEXTCLOUD, code: null, resultText: null },
  ...over,
} as Operation);
const log = (): CommandLogState => ({ traces: {}, recentTraceIds: [] } as unknown as CommandLogState);

let send: ReturnType<typeof vi.fn>;
beforeEach(() => { send = vi.fn(); setSendCommandFn(send); });
afterEach(() => { cleanup(); vi.useRealTimers(); setSendCommandFn(() => {}); resetMoveChecking(); resetLive(); });

const renderDesktop = () => {
  const [store, setStore] = createSignal<Store | null>(base());
  let ctl!: ReturnType<typeof createDragCopyMove>;
  render(() => {
    ctl = createDragCopyMove(store, log);
    return (
      <div class="main-layout">
        <NetworkTree store={store} selection={{ type: 'network', id: '' }} onSelect={() => {}} dragData={ctl.dragData} onDrop={ctl.handleDrop} commandLogStore={log} />
        <div class="main-layout__right" data-testid="right">
          <CopyMoveFeedback store={store} ctl={ctl} />
        </div>
        <CopyMoveModal ctl={ctl} />
      </div>
    );
  });
  return { store: () => store()!, setStore, ctl: () => ctl };
};
const startMove = (ctl: ReturnType<typeof createDragCopyMove>) => {
  ctl.setDragData({ instanceId: NEXTCLOUD, instanceName: 'nextcloud', sourceDiskId: D2, sourceDiskName: 'src' });
  const target = screen.getByTestId(`disk-${D1}`);
  fireEvent.dragOver(target);
  fireEvent.drop(target);
  fireEvent.click(screen.getByTestId('copy-move-move'));
};
const panel = () => screen.getByTestId('copy-move-status');
const inPanel = (testId: string) => panel().querySelector(`[data-testid="${testId}"]`);

describe('CopyMoveFeedback panel', () => {
  it('renders nothing until there is something to say', () => {
    renderDesktop();
    expect(screen.queryByTestId('copy-move-status')).toBeNull();
  });

  it('cross-Engine Move: "Sent to" in the panel, replaced by the step line once the op exists, then the live line and the result', () => {
    const { store, setStore, ctl } = renderDesktop();
    startMove(ctl());
    expect(send).toHaveBeenCalledWith(E2, `moveApp nextcloud ${D2} ${D1}`);
    expect(panel()).toHaveClass('copy-move-feedback');
    expect(panel().parentElement).toBe(screen.getByTestId('right'));
    expect(inPanel('copy-move-feedback-sent')?.textContent).toBe('Sent to appdocker02, waiting for confirmation…');

    setStore({ ...store(), operationDB: { mv1: mv('Running') } });
    expect(screen.queryByTestId('copy-move-feedback-sent')).toBeNull();
    expect(inPanel('cross-move-step')?.textContent).toBe('Step 1 of 3: Copying to appdocker01');

    setStore({ ...store(), operationDB: { mv1: mv('Running', { stepLabel: 'Checking', currentStep: 1, move: { phase: 'checking', sourceInstanceId: NEXTCLOUD } }) } });
    receiveEphemeral({ type: 'idea/progress', opId: 'mv1', step: 'Checking', bytesDone: 0, bytesTotal: 0, checking: { phase: 'stabilising', label: 'x', stableElapsedMs: 4_966, stableTargetMs: 10_000 } });
    expect(inPanel('cross-move-step')?.textContent).toBe('Step 2 of 3: Checking the copy on appdocker01');
    expect(inPanel('cross-move-checking')?.textContent).toBe('Checking it stays up: 4 of 10 seconds');
    expect(screen.queryByTestId('copy-move-feedback-sent')).toBeNull();

    const flipped = { ...store().instanceDB, [NEXTCLOUD]: { ...store().instanceDB[NEXTCLOUD], storedOn: D1 } };
    setStore({ ...store(), instanceDB: flipped, operationDB: { mv1: mv('Done', { stepLabel: null, currentStep: null, completedAt: Date.now(), move: { phase: 'done', sourceInstanceId: NEXTCLOUD, targetInstanceId: NEXTCLOUD, code: 'MOVED' } }) } });
    expect(inPanel('cross-move-moved')?.textContent).toBe('nextcloud moved to appdocker01.');
    expect(screen.queryByTestId('cross-move-step')).toBeNull();
    expect(screen.queryByTestId('copy-move-feedback-sent')).toBeNull();
  });

  it('a failed move: the error line is in the same panel (the "Sent to" line is not kept by a Failed op)', () => {
    const { store, setStore, ctl } = renderDesktop();
    startMove(ctl());
    setStore({ ...store(), operationDB: { mv1: mv('Failed', { error: 'MOVE FAILED: x; source kept', move: { sourceInstanceId: NEXTCLOUD, code: 'VERIFY_SIZE' } }) } });
    expect(inPanel('copy-move-feedback-error')?.textContent).toBe("Couldn't move nextcloud: the copy on appdocker01 is not complete. Nothing was removed: it is still on appdocker02.");
    expect(screen.queryByTestId('cross-move-step')).toBeNull();
  });

  it('a copy (not a cross-Engine Move) keeps "Sent to" until it resolves, in the panel', () => {
    const { ctl } = renderDesktop();
    ctl().setDragData({ instanceId: NEXTCLOUD, instanceName: 'nextcloud', sourceDiskId: D2, sourceDiskName: 'src' });
    const target = screen.getByTestId(`disk-${D1}`);
    fireEvent.dragOver(target);
    fireEvent.drop(target);
    fireEvent.click(screen.getByTestId('copy-move-copy'));
    expect(inPanel('copy-move-feedback-sent')?.textContent).toContain('Sent to appdocker02');
    expect(screen.queryByTestId('cross-move-step')).toBeNull();
  });

  it('mobile: the same panel at the top of the tab content', () => {
    const [store, setStore] = createSignal<Store | null>(base());
    let ctl!: ReturnType<typeof createDragCopyMove>;
    render(() => {
      ctl = createDragCopyMove(store, log);
      return (
        <MobileLayout store={store} commandLogStore={log} selection={{ type: 'network', id: '' }} onSelect={() => {}}
          dragData={ctl.dragData} onDrop={ctl.handleDrop} pendingMove={ctl.pendingMove} onCopyMoveChoice={ctl.choose}
          onCancelMove={ctl.cancel} copyMoveFeedback={<CopyMoveFeedback store={store} ctl={ctl} />} />
      );
    });
    ctl.handleDrop({ instanceId: NEXTCLOUD, instanceName: 'nextcloud', sourceDiskId: D2, sourceDiskName: 'src' }, D1);
    ctl.choose('move');
    expect(panel().parentElement).toHaveClass('mobile-tab-content');
    expect(inPanel('copy-move-feedback-sent')).toBeTruthy();
    setStore({ ...store()!, operationDB: { mv1: mv('Running') } });
    expect(screen.queryByTestId('copy-move-feedback-sent')).toBeNull();
    expect(inPanel('cross-move-step')?.textContent).toBe('Step 1 of 3: Copying to appdocker01');
  });
});
