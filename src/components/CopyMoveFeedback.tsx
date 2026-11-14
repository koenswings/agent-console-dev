/**
 * Copy/move feedback area (idea#498): the copy/move CommandFeedback and the
 * cross-Engine Move steps in one panel, mounted the same way on desktop (above
 * the Operations panel) and mobile (top of the tab content). Renders nothing
 * when there is nothing to say.
 *
 * "Sent to <engine>, waiting for confirmation…" shows only until the Engine's
 * moveApp op is in the store; from then on the step line replaces it. A failed
 * op still shows the CommandFeedback error line. A Done move that did not move the
 * app (SOURCE_CHANGED, engine#388) is a warning: the outcome line says it once the
 * op is visible, else the CommandFeedback warning line does.
 */
import { Show, createMemo, type Accessor, type Component } from 'solid-js';
import type { Store } from '../types/store';
import type { DragCopyMove } from '../store/dragCopyMove';
import CommandFeedback from './CommandFeedback';
import { CrossMoveLines, createCrossMoveView } from './CrossMoveStatus';

interface Props {
  store: Accessor<Store | null>;
  ctl: DragCopyMove;
}

const CopyMoveFeedback: Component<Props> = (props) => {
  const view = createCrossMoveView(props.store, props.ctl.crossMove);
  // The op is visible and not Failed: the steps / outcome speak for it.
  const opSeen = createMemo(() => {
    const o = view.op();
    return !!o && o.status !== 'Failed';
  });
  const resultShown = createMemo(() => {
    const k = props.ctl.result.state().kind;
    return ((k === 'sent' || k === 'warning') && !opSeen()) || k === 'error' || k === 'timeout';
  });
  const visible = createMemo(() => resultShown() || !!view.step() || !!view.outcome());
  return (
    <Show when={visible()}>
      <div class="copy-move-feedback" data-testid="copy-move-status">
        <CommandFeedback
          result={props.ctl.result}
          subject={props.ctl.subject}
          testId="copy-move-feedback"
          formatLine={props.ctl.formatLine}
          hideSent={opSeen}
          hideWarning={opSeen}
        />
        <CrossMoveLines view={view} />
      </div>
    </Show>
  );
};

export default CopyMoveFeedback;
