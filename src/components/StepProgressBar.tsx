/**
 * StepProgressBar
 *
 * When step data is available (currentStep + totalSteps), renders a segmented
 * bar divided into totalSteps equal-width segments:
 *   - Completed steps → solid green
 *   - Currently running step → pulsing green (flash animation)
 *   - Future steps → grey (border only)
 *
 * When no step data is available, falls back to a smooth percentage fill bar
 * (or an indeterminate flowing animation if progressPercent is also null).
 */
import { For, Show, createMemo, type Component } from 'solid-js';

interface StepProgressBarProps {
  currentStep: number | null;   // 1-based index of the active step
  totalSteps: number | null;
  progressPercent: number | null;
  done?: boolean;
}

const StepProgressBar: Component<StepProgressBarProps> = (props) => {
  const hasSteps = createMemo(() =>
    props.currentStep != null &&
    props.totalSteps != null &&
    props.totalSteps > 0
  );

  const isIndeterminate = createMemo(() =>
    !hasSteps() && props.progressPercent == null && !props.done
  );

  return (
    <Show
      when={hasSteps()}
      fallback={
        /* ── Smooth / indeterminate fallback ─── */
        <div
          class={`step-progress-bar step-progress-bar--smooth${
            isIndeterminate() ? ' step-progress-bar--indeterminate' : ''
          }`}
          role="progressbar"
          aria-valuenow={props.done ? 100 : (props.progressPercent ?? undefined)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <Show when={!isIndeterminate()}>
            <div
              class="step-progress-bar__fill"
              style={{ width: `${props.done ? 100 : (props.progressPercent ?? 0)}%` }}
            />
          </Show>
          <Show when={isIndeterminate()}>
            <div class="step-progress-bar__fill" />
          </Show>
        </div>
      }
    >
      {/* ── Segmented step bar ─────────────────── */}
      <div
        class="step-progress-bar step-progress-bar--segmented"
        role="progressbar"
        aria-valuenow={props.currentStep ?? undefined}
        aria-valuemin={1}
        aria-valuemax={props.totalSteps ?? undefined}
      >
        <For each={Array.from({ length: props.totalSteps! })}>
          {(_, i) => {
            const stepNum = () => i() + 1;         // 1-based
            const current = () => props.currentStep!;
            const isDone  = () => props.done || stepNum() < current();
            const isActive = () => !props.done && stepNum() === current();
            return (
              <div
                class={`step-progress-bar__segment${
                  isDone()   ? ' step-progress-bar__segment--done'   : ''
                }${isActive() ? ' step-progress-bar__segment--active' : ''}`}
              />
            );
          }}
        </For>
      </div>
    </Show>
  );
};

export default StepProgressBar;
