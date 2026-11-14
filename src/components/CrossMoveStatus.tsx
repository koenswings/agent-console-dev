/**
 * idea#79: steps and result of a cross-Engine Move (shapes in store/moveApp.ts).
 * Renders nothing unless a supported cross-Engine Move was sent. A failure is
 * shown by the copy/move CommandFeedback (moveFailedLine), not here.
 * Mounted inside CopyMoveFeedback (desktop and mobile), which also decides
 * when the "Sent to …, waiting for confirmation" line gives way to the steps.
 */
import { Show, createMemo, type Accessor, type Component } from 'solid-js';
import type { Operation, Store } from '../types/store';
import type { CrossMove } from '../store/dragCopyMove';
import { isMoveRunning, latestMoveOp, moveOutcome, movePlacement, moveStepText, type MoveOutcome } from '../store/moveApp';
import { moveChecking, moveCheckingLine } from '../store/moveChecking';
import { liveNow } from '../store/live';

export interface CrossMoveView {
  op: Accessor<Operation | null>;
  step: Accessor<string | null>;
  checking: Accessor<string | null>;
  outcome: Accessor<MoveOutcome | null>;
}

/** Derived view of the cross-Engine Move in flight (all memos over the store and the move). */
export const createCrossMoveView = (store: Accessor<Store | null>, move: Accessor<CrossMove | null>): CrossMoveView => {
  const op = createMemo(() => {
    const m = move();
    return m ? latestMoveOp(store(), m.instanceId, m.since) : null;
  });
  const step = createMemo(() => {
    const m = move();
    const o = op();
    return m && isMoveRunning(o) ? moveStepText(o, m.targetEngine) : null;
  });
  // idea#498: live stay-up check from the target Engine (ephemeral; null on older Engines).
  const checking = createMemo(() => (step() ? moveCheckingLine(op(), moveChecking(), liveNow()) : null));
  const outcome = createMemo(() => {
    const m = move();
    const o = m ? moveOutcome(op(), { app: m.app, targetEngine: m.targetEngine, sourceEngine: m.sourceEngine }, movePlacement(store(), op())) : null;
    return o && o.kind !== 'failed' ? o : null;
  });
  return { op, step, checking, outcome };
};

export const CrossMoveLines: Component<{ view: CrossMoveView }> = (props) => (
  <>
    <Show when={props.view.step()}>
      {(t) => <p class="edp-form__hint" role="status" data-testid="cross-move-step">{t()}</p>}
    </Show>
    <Show when={props.view.checking()}>
      {(t) => <p class="edp-form__hint" data-testid="cross-move-checking">{t()}</p>}
    </Show>
    <Show when={props.view.outcome()}>
      {(o) => (
        <p
          class={`edp-form__hint ${o().kind === 'warning' ? 'cross-move--warning' : 'cross-move--success'}`}
          role={o().kind === 'warning' ? 'alert' : 'status'}
          data-testid={`cross-move-${o().kind}`}
        >
          {o().text}
        </p>
      )}
    </Show>
  </>
);

const CrossMoveStatus: Component<{ store: Accessor<Store | null>; move: Accessor<CrossMove | null> }> = (props) => (
  <CrossMoveLines view={createCrossMoveView(props.store, props.move)} />
);

export default CrossMoveStatus;
