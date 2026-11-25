/**
 * Engines the last sign-in did not cover (agent-engine-dev#582): unreachable
 * ones are listed with the reason; ones that need their first operator get
 * a setup-code form, named per Engine.
 */
import { For, Show, type Component } from 'solid-js';
import { engineIssues } from '../store/auth';
import type { Store } from '../types/store';
import EngineSetupForm from './EngineSetupForm';

interface EngineIssuesProps {
  store: Store | null;
}

const EngineIssues: Component<EngineIssuesProps> = (props) => {
  const ids = () => engineIssues().map((i) => i.engineId);
  const issue = (id: string) => engineIssues().find((i) => i.engineId === id);

  return (
    <Show when={ids().length > 0}>
      <div class="account-screen__section engine-issues" data-testid="engine-issues">
        <h2 class="account-screen__heading">Other Engines</h2>
        <p class="engine-issues__intro">This sign-in does not cover these Engines yet. Commands to them stay off until it does.</p>
        <ul class="engine-issues__list">
          <For each={ids()}>
            {(id) => (
              <li class="engine-issues__item" data-testid={`engine-issue-${id}`}>
                <p class="engine-issues__message">{issue(id)?.message}</p>
                <Show when={issue(id)?.code === 'SETUP_REQUIRED'}>
                  <EngineSetupForm engineId={id} engineName={issue(id)?.engineName ?? id} store={props.store} />
                </Show>
              </li>
            )}
          </For>
        </ul>
      </div>
    </Show>
  );
};

export default EngineIssues;
