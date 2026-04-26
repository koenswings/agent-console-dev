/**
 * OperationProgress — shows active operations from operationDB with lifecycle:
 * - Pending / Running: shown with progress bar
 * - Done: shown briefly with ✓, auto-dismissed after 3s
 * - Failed: shown with error, dismissed manually
 */
import { For, Show, createMemo, createSignal, onCleanup, type Component } from 'solid-js';
import type { Operation, OperationKind, Store } from '../types/store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<OperationKind, string> = {
  copyApp:       'Copy app',
  moveApp:       'Move app',
  backupApp:     'Back up',
  restoreApp:    'Restore',
  upgradeApp:    'Upgrade app',
  upgradeEngine: 'Upgrade engine',
};

const argsSummary = (op: Operation, store: Store | null): string => {
  const parts: string[] = [];

  // Instance name — resolve from store by ID, fall back to raw field
  const instanceId = op.args['instanceId'];
  const instanceName = instanceId && store
    ? String(store.instanceDB?.[instanceId]?.name ?? op.args['instanceName'] ?? '')
    : String(op.args['instanceName'] ?? '');
  if (instanceName) parts.push(instanceName);

  // Disk labels — resolve engine hostname from disk ID, fall back to disk name or raw field
  const srcId = op.args['sourceDiskId'];
  const dstId = op.args['targetDiskId'];
  if (srcId && dstId && store) {
    const src = store.diskDB?.[srcId];
    const dst = store.diskDB?.[dstId];
    const srcEng = src?.dockedTo ? store.engineDB?.[String(src.dockedTo)] : null;
    const dstEng = dst?.dockedTo ? store.engineDB?.[String(dst.dockedTo)] : null;
    const srcLabel = srcEng ? String(srcEng.hostname) : String(src?.name ?? srcId);
    const dstLabel = dstEng ? String(dstEng.hostname) : String(dst?.name ?? dstId);
    parts.push(`${srcLabel} → ${dstLabel}`);
  } else {
    // Fall back to raw name fields (legacy / test data)
    const srcName = op.args['sourceDiskName'];
    const dstName = op.args['targetDiskName'];
    if (srcName && dstName) parts.push(`${srcName} → ${dstName}`);
  }

  return parts.join(' · ');
};

// ---------------------------------------------------------------------------
// Per-operation card with Done auto-dismiss
// ---------------------------------------------------------------------------

interface OpCardProps {
  op: Operation;
  store: Store | null;
  onDismiss: () => void;
}

const OpCard: Component<OpCardProps> = (props) => {
  const isDone   = () => props.op.status === 'Done';
  const isFailed = () => props.op.status === 'Failed';
  const pct      = () => props.op.progressPercent ?? 0;

  // Auto-dismiss Done cards after 3s
  if (isDone()) {
    const t = setTimeout(() => props.onDismiss(), 3000);
    onCleanup(() => clearTimeout(t));
  }

  return (
    <div class={`operation-card ${isFailed() ? 'operation-card--failed' : ''} ${isDone() ? 'operation-card--done' : ''}`}>
      <div class="operation-card__top">
        <span class="operation-card__kind">{KIND_LABEL[props.op.kind] ?? props.op.kind}</span>
        <div class="operation-card__top-right">
          <span class="operation-card__status">
            {isDone() ? '✓ Done' : props.op.status}
          </span>
          <Show when={isFailed()}>
            <button class="operation-card__dismiss" onClick={props.onDismiss} aria-label="Dismiss">✕</button>
          </Show>
        </div>
      </div>

      <Show when={argsSummary(props.op, props.store)}>
        <div class="operation-card__args">{argsSummary(props.op, props.store)}</div>
      </Show>

      <Show when={!isFailed()}>
        <div class="operation-card__progress-bar" role="progressbar" aria-valuenow={pct()} aria-valuemin={0} aria-valuemax={100}>
          <div class="operation-card__progress-fill" style={{ width: `${isDone() ? 100 : pct()}%` }} />
        </div>
      </Show>

      <Show when={isFailed() && props.op.error}>
        <div class="operation-card__error">{props.op.error}</div>
      </Show>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface OperationProgressProps {
  store: () => Store | null;
}

const OperationProgress: Component<OperationProgressProps> = (props) => {
  // Track dismissed op IDs locally (Done auto-dismissed, Failed manually dismissed)
  const [dismissed, setDismissed] = createSignal<Set<string>>(new Set());

  const dismiss = (opId: string) => {
    setDismissed((prev) => new Set([...prev, opId]));
  };

  const visibleOps = createMemo((): Operation[] => {
    const db = props.store()?.operationDB;
    if (!db) return [];
    const d = dismissed();
    return Object.values(db).filter(
      (op) =>
        !d.has(op.id) &&
        (op.status === 'Pending' || op.status === 'Running' || op.status === 'Done' || op.status === 'Failed')
    );
  });

  return (
    <Show when={visibleOps().length > 0}>
      <div class="operation-progress" role="status" aria-label="Operation progress">
        <div class="operation-progress__header">Operations</div>
        <For each={visibleOps()}>
          {(op) => (
            <OpCard
              op={op}
              store={props.store()}
              onDismiss={() => dismiss(op.id)}
            />
          )}
        </For>
      </div>
    </Show>
  );
};

export default OperationProgress;
