/**
 * The failed-op message on an app's row (InstanceRow), idea#498 follow-up to #201.
 *
 * Since #201, dismissing a Failed card only hides it in this browser, so the
 * row message must clear on its own:
 *  - a NEWER finished op (Done, Failed or Cancelled, any kind) of the same
 *    instance replaces it: a newer Failed op of a kind the row shows becomes
 *    the message; anything else clears it. "Newer" compares the op's finish
 *    time, or its start time when it has none (ops have no separate creation time);
 *  - otherwise it hides ROW_FAILURE_TTL_MS (24 h) after the op failed;
 *  - it hides when the user dismissed that op's card (store/dismissedOps.ts).
 * The 24 h are measured on the op's Engine clock (engineClockOf: its last hb,
 * else its stored lastRun), never the Console clock against an Engine timestamp,
 * falling back to the Console clock only when that Engine's clock is unknown.
 */
import type { Operation, Store } from '../types/store';
import { engineClockOf, type LiveState } from './live';
import { isOpDismissed } from './dismissedOps';

export const ROW_FAILURE_TTL_MS = 24 * 60 * 60 * 1000;
const FINISHED = new Set(['Done', 'Failed', 'Cancelled']);

/** Finish time of an op; its start time when it has none. */
export const opFinishedAt = (op: Pick<Operation, 'completedAt' | 'startedAt'>): number =>
  Number(op.completedAt ?? op.startedAt ?? 0) || 0;

const isForInstance = (op: Operation, instanceId: string): boolean =>
  String(op.args?.instanceId ?? '') === instanceId
  || (op.subject?.type === 'instance' && String(op.subject.id) === instanceId);

/**
 * The newest finished op of this instance, when it is a Failed op the row shows
 * (`shown`); else null. No clock: a separate step applies the expiry.
 */
export const latestRowFailure = (store: Store | null, instanceId: string, shown: (op: Operation) => boolean): Operation | null => {
  if (!store || !instanceId) return null;
  let newest: Operation | null = null;
  for (const op of Object.values(store.operationDB ?? {})) {
    if (!FINISHED.has(String(op.status)) || !isForInstance(op, instanceId)) continue;
    if (!newest || opFinishedAt(op) > opFinishedAt(newest)) newest = op;
  }
  return newest && newest.status === 'Failed' && shown(newest) ? newest : null;
};

/** True while the failure is younger than ROW_FAILURE_TTL_MS on its Engine's clock and not dismissed here. */
export const rowFailureVisible = (op: Operation, store: Store | null, live: LiveState, now: number): boolean => {
  if (isOpDismissed(op.id)) return false;
  const engineId = op.engineId == null ? null : String(op.engineId);
  const lastRun = engineId ? store?.engineDB?.[engineId]?.lastRun : undefined;
  const clock = engineClockOf(engineId, live, lastRun, now) ?? now;
  return clock - opFinishedAt(op) < ROW_FAILURE_TTL_MS;
};
