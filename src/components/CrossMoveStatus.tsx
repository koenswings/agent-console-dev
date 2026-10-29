/**
 * idea#79: steps and result of a cross-Engine Move (shapes in store/moveApp.ts).
 * Renders nothing unless a supported cross-Engine Move was sent. A failure is
 * shown by the copy/move CommandFeedback (moveFailedLine), not here.
 */
import { Show, createMemo, type Accessor, type Component } from 'solid-js';
import type { Store } from '../types/store';
import type { CrossMove } from '../store/dragCopyMove';
import { isMoveRunning, latestMoveOp, moveOutcome, moveStepText } from '../store/moveApp';

const CrossMoveStatus: Component<{ store: Accessor<Store | null>; move: Accessor<CrossMove | null> }> = (props) => {
  const op = createMemo(() => {
    const m = props.move();
    return m ? latestMoveOp(props.store(), m.instanceId, m.since) : null;
  });
  const step = createMemo(() => {
    const m = props.move();
    const o = op();
    return m && isMoveRunning(o) ? moveStepText(o, m.targetEngine) : null;
  });
  const outcome = createMemo(() => {
    const m = props.move();
    const o = m ? moveOutcome(op(), { app: m.app, targetEngine: m.targetEngine, sourceEngine: m.sourceEngine }) : null;
    return o && o.kind !== 'failed' ? o : null;
  });
  return (
    <>
      <Show when={step()}>
        {(t) => <p class="edp-form__hint" role="status" data-testid="cross-move-step">{t()}</p>}
      </Show>
      <Show when={outcome()}>
        {(o) => (
          <p
            class={o().kind === 'warning' ? 'edp-form__hint cross-move--warning' : 'edp-form__hint'}
            role={o().kind === 'warning' ? 'alert' : 'status'}
            data-testid={`cross-move-${o().kind}`}
          >
            {o().text}
          </p>
        )}
      </Show>
    </>
  );
};

export default CrossMoveStatus;
