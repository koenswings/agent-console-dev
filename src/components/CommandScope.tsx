/**
 * Switches off the command controls inside it when the Console may not send
 * commands to that Engine (agent-engine-dev#582 §5), with the reason above.
 * Links (Open ↗) keep working; buttons and inputs are disabled.
 */
import { Show, type Component, type JSX } from 'solid-js';
import { commandGateForId } from '../store/commandRouter';

interface CommandScopeProps {
  engineId: () => string | null | undefined;
  /** data-testid prefix: `<testId>` on the fieldset, `<testId>-notice` on the reason. */
  testId?: string;
  /** Smaller reason line, for rows in a list. */
  compact?: boolean;
  /** Show the reason line (default true). Off when the panel above already shows it. */
  notice?: boolean;
  children: JSX.Element;
}

const CommandScope: Component<CommandScopeProps> = (props) => {
  const message = (): string | null => {
    const g = commandGateForId(props.engineId());
    return g.ok ? null : g.message;
  };
  const testId = () => props.testId ?? 'command-scope';
  return (
    <>
      <Show when={props.notice !== false && message()}>
        {(m) => (
          <p
            class={`command-scope__notice${props.compact ? ' command-scope__notice--compact' : ''}`}
            data-testid={`${testId()}-notice`}
          >
            {m()}
          </p>
        )}
      </Show>
      <fieldset class="command-scope" disabled={!!message()} data-testid={testId()}>
        {props.children}
      </fieldset>
    </>
  );
};

export default CommandScope;
