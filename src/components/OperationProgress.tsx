/**
 * OperationProgress — shows active (Pending | Running) operations from operationDB.
 * Disappears automatically when all operations are Done or the DB is empty.
 */
import { For, Show, createMemo, type Component } from 'solid-js';
import type { Operation, OperationKind, Store } from '../types/store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<OperationKind, string> = {
  copyApp:       'Copy app',
  moveApp:       'Move app',
  backupApp:     'Back up app',
  restoreApp:    'Restore app',
  upgradeApp:    'Upgrade app',
  upgradeEngine: 'Upgrade engine',
};

const argsSummary = (op: Operation): string => {
  const parts: string[] = [];
  if (op.args.instanceName) parts.push(op.args.instanceName);
  if (op.args.sourceDiskName && op.args.targetDiskName) {
    parts.push(`${op.args.sourceDiskName} → ${op.args.targetDiskName}`);
  } else if (op.args.targetDiskName) {
    parts.push(`→ ${op.args.targetDiskName}`);
  } else if (op.args.sourceDiskName) {
    parts.push(op.args.sourceDiskName);
  }
  if (op.args.appId) parts.push(op.args.appId);
  return parts.join(' · ');
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface OperationProgressProps {
  /** Reactive store accessor */
  store: () => Store | null;
}

const OperationProgress: Component<OperationProgressProps> = (props) => {
  // Only show Pending and Running operations
  const activeOps = createMemo((): Operation[] => {
    const db = props.store()?.operationDB;
    if (!db) return [];
    return Object.values(db).filter(
      (op) => op.status === 'Pending' || op.status === 'Running' || op.status === 'Failed'
    );
  });

  return (
    <Show when={activeOps().length > 0}>
      <div class="operation-progress" role="status" aria-label="Operation progress">
        <div class="operation-progress__header">Operations</div>
        <For each={activeOps()}>
          {(op) => {
            const pct = op.progressPercent ?? 0;
            const isFailed = op.status === 'Failed';
            return (
              <div class={`operation-card ${isFailed ? 'operation-card--failed' : ''}`}>
                <div class="operation-card__top">
                  <span class="operation-card__kind">{KIND_LABEL[op.kind] ?? op.kind}</span>
                  <span class="operation-card__status">{op.status}</span>
                </div>
                <Show when={argsSummary(op)}>
                  <div class="operation-card__args">{argsSummary(op)}</div>
                </Show>
                <Show when={!isFailed}>
                  <div class="operation-card__progress-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                    <div
                      class="operation-card__progress-fill"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </Show>
                <Show when={isFailed && op.error}>
                  <div class="operation-card__error">{op.error}</div>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </Show>
  );
};

export default OperationProgress;
