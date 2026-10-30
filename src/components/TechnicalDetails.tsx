import { Show, type Component } from 'solid-js';
import { plainEngineText } from '../store/plainError';

const ANSI_RE = /\u001b\[[0-9;]*m/g;

/**
 * Engine error for debug views (idea#76): the plain sentence first, the raw
 * Engine text inside a closed "Technical details" toggle. The toggle is left
 * out when the raw text is empty or the same as the sentence.
 */
const TechnicalDetails: Component<{ raw: string | null | undefined; class?: string; testId?: string }> = (props) => {
  const raw = () => String(props.raw ?? '').replace(ANSI_RE, '').trim();
  const plain = () => plainEngineText(raw());
  return (
    <div class={`tech-details ${props.class ?? ''}`.trim()} data-testid={props.testId}>
      <span class="tech-details__plain">{plain()}</span>
      <Show when={raw() && raw() !== plain()}>
        <details class="tech-details__toggle">
          <summary class="tech-details__summary">Technical details</summary>
          <pre class="tech-details__raw">{raw()}</pre>
        </details>
      </Show>
    </div>
  );
};

export default TechnicalDetails;
