/**
 * Command results that need the operator's attention (agent-engine-dev#582):
 * an older Engine (commands off), a sign-in that ended, or a refusal.
 */
import { For, Show, type Component } from 'solid-js';
import { commandNotices, dismissCommandNotice } from '../store/commandRouter';

const CommandNotices: Component = () => {
  const ids = () => commandNotices().map((n) => n.id);
  const notice = (id: number) => commandNotices().find((n) => n.id === id);

  return (
    <Show when={ids().length > 0}>
      <div class="command-notices" role="status" data-testid="command-notices">
        <For each={ids()}>
          {(id) => (
            <div class={`command-notice command-notice--${notice(id)?.kind ?? 'error'}`} data-testid="command-notice">
              <span class="command-notice__text">{notice(id)?.message}</span>
              <button class="command-notice__close" aria-label="Dismiss" onClick={() => dismissCommandNotice(id)}>✕</button>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
};

export default CommandNotices;
