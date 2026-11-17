/**
 * Local (same-Engine) moveApp park / resume helpers (engine#509 / engine#497).
 *
 * A local move has kind `moveApp`, no `op.move` (cross-Engine uses that field
 * and is not covered yet), and `args.phase` set. It parks as Pending with
 * `RESUME_WAITING` / `RESUME_PENDING` and resumes in the same op id.
 * While a move that stopped a running source is parked or in flight again,
 * the Console shows: "Source stopped until the move resumes or gives up".
 */
import type { Operation, Store } from '../types/store';

export const SOURCE_STOPPED_HINT = 'Source stopped until the move resumes or gives up';

/** Parked because a disk went away; waiting for it to be docked again. */
export const PARKED_WAITING_STATUS = 'Waiting for the disk to come back';
/** Parked after a counted failure; resumes at the next boot or dock. */
export const PARKED_PENDING_STATUS = 'Waiting to try again';

const HINT_PHASES = new Set(['copying', 'verified']);
const HINT_STATUSES = new Set(['Pending', 'Running']);

const rawMove = (op: Operation | null | undefined): unknown =>
  op ? (op as unknown as Record<string, unknown>).move : undefined;

const errorText = (op: Operation): string => String(op.error ?? '');

/** Local resumable move: kind moveApp, no op.move, args.phase set. */
export const isLocalResumableMove = (op: Operation | null | undefined): boolean =>
  !!op && op.kind === 'moveApp' && rawMove(op) == null && !!op.args?.phase;

/** Pending local move waiting for a disk (WAITING) or the next boot or dock (PENDING). */
export const isParkedMove = (op: Operation | null | undefined): boolean =>
  isLocalResumableMove(op)
  && op!.status === 'Pending'
  && /^RESUME_(WAITING|PENDING)\b/.test(errorText(op!));

/**
 * Show the source-stopped hint for a parked or in-flight resumed local move
 * that stopped a running source (`args.wasRunning === '1'`).
 */
export const showsSourceStoppedHint = (op: Operation | null | undefined): boolean =>
  isLocalResumableMove(op)
  && HINT_PHASES.has(String(op!.args.phase))
  && op!.args.wasRunning === '1'
  && HINT_STATUSES.has(op!.status);

/**
 * Plain status line for a parked local move. Unknown RESUME_ prefixes, and
 * in-flight resumes, return null so the card keeps "Pending" / "Running"
 * and never shows a raw code.
 */
export const parkedMoveStatusText = (op: Operation | null | undefined): string | null => {
  if (!isLocalResumableMove(op) || op!.status !== 'Pending') return null;
  const err = errorText(op!);
  if (/^RESUME_WAITING\b/.test(err)) return PARKED_WAITING_STATUS;
  if (/^RESUME_PENDING\b/.test(err)) return PARKED_PENDING_STATUS;
  return null;
};

/** The newest local move that is keeping this source instance stopped, if any. */
export const sourceStoppedMoveFor = (store: Store | null, instanceId: string): Operation | null => {
  if (!store || !instanceId) return null;
  const id = String(instanceId);
  return Object.values(store.operationDB ?? {})
    .filter((op) => showsSourceStoppedHint(op) && String(op.args?.instanceId ?? op.subject?.id ?? '') === id)
    .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
};
