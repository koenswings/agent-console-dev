/** Copy-or-Move modal shown when an app is dropped onto a disk (desktop). */
import { Show, type Component } from 'solid-js';
import type { DragCopyMove } from '../store/dragCopyMove';

const CopyMoveModal: Component<{ ctl: DragCopyMove }> = (props) => (
  <Show when={props.ctl.pendingMove()}>
    {(pm) => (
      <div class="copy-move-modal-overlay" role="dialog" aria-modal="true" aria-label="Copy or Move" data-testid="copy-move-modal">
        <div class="copy-move-modal">
          <div class="copy-move-modal__title">Copy or Move?</div>
          <p class="copy-move-modal__desc">
            <strong>{pm().data.instanceName}</strong> from <em>{pm().data.sourceDiskName}</em> → <em>{pm().targetDiskName}</em> on <em>{pm().targetEngineHostname}</em>
          </p>
          <div class="copy-move-modal__actions">
            <button class="btn" data-testid="copy-move-cancel" onClick={() => props.ctl.cancel()}>Cancel</button>
            <button class="btn" data-testid="copy-move-move" onClick={() => props.ctl.choose('move')}>Move</button>
            <button class="btn btn--primary" data-testid="copy-move-copy" onClick={() => props.ctl.choose('copy')}>Copy</button>
          </div>
        </div>
      </div>
    )}
  </Show>
);

export default CopyMoveModal;
