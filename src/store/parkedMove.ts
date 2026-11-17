/**
 * moveApp park / resume helpers (engine#509 / engine#497).
 *
 * A local move has kind `moveApp`, no `op.move`, and `args.phase` set.
 * A cross-Engine move has `op.move` (idea#79). Until Axle's option A
 * "Console contract" PR pins the (a) fields, cross-Engine resume reuses the
 * local markers (Pending + RESUME_WAITING / RESUME_PENDING, RETRY_MARKER,
 * Failed RESUME_GAVE_UP, args.wasRunning, and phase on args or op.move).
 * The hint is shown only for a move whose source is on this Engine
 * (`isSourceEngineOp`). While a move that stopped a running source is parked
 * or in flight again, the Console shows: "Source stopped until the move resumes or gives up".
 */
import type { Operation, Store } from '../types/store';

export const SOURCE_STOPPED_HINT = 'Source stopped until the move resumes or gives up';

/** Parked because a disk went away; waiting for it to be docked again. */
export const PARKED_WAITING_STATUS = 'Waiting for the disk to come back';
/** Parked after a counted failure; resumes at the next boot or dock. */
export const PARKED_PENDING_STATUS = 'Waiting to try again';

/** Local parked / mid-resume phases (engine#509). */
const LOCAL_HINT_PHASES = new Set(['copying', 'verified']);
/**
 * Cross-Engine: the same local names, plus `checking` (idea#79 mid-move,
 * storedOn has not flipped yet). `removing` is not included: storedOn may
 * already be on the target.
 */
const CROSS_HINT_PHASES = new Set(['copying', 'verified', 'checking']);
const HINT_STATUSES = new Set(['Pending', 'Running']);

type Raw = Record<string, unknown>;
const rawOf = (o: unknown): Raw => (o && typeof o === 'object' ? (o as Raw) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const rawMove = (op: Operation | null | undefined): unknown =>
  op ? (op as unknown as Raw).move : undefined;
const errorText = (op: Operation): string => String(op.error ?? '');

const phaseOf = (op: Operation): string =>
  str(op.args?.phase) ?? str(rawOf(rawMove(op)).phase) ?? '';

const sourceInstanceIdOf = (op: Operation): string =>
  String(str(rawOf(rawMove(op)).sourceInstanceId) ?? op.args?.instanceId ?? op.subject?.id ?? '');

/**
 * Provisional: is this move's source on `engineId`? Prefer
 * `op.move.sourceEngineId` when present, else `op.engineId`.
 * One-line change once Axle pins the field in the Console contract PR.
 */
export const isSourceEngineOp = (op: Operation | null | undefined, engineId: string | null | undefined): boolean => {
  if (!op || engineId == null || engineId === '') return false;
  const id = String(engineId);
  const fromMove = str(rawOf(rawMove(op)).sourceEngineId);
  if (fromMove) return fromMove === id;
  return String(op.engineId) === id;
};

/** Local resumable move: kind moveApp, no op.move, args.phase set. */
export const isLocalResumableMove = (op: Operation | null | undefined): boolean =>
  !!op && op.kind === 'moveApp' && rawMove(op) == null && !!op.args?.phase;

/** Local or cross-Engine moveApp that can park / resume in place. */
export const isResumableMove = (op: Operation | null | undefined): boolean =>
  !!op && op.kind === 'moveApp' && (rawMove(op) != null || !!op.args?.phase);

/** Pending move waiting for a disk (WAITING) or the next boot or dock (PENDING). */
export const isParkedMove = (op: Operation | null | undefined): boolean =>
  isResumableMove(op)
  && op!.status === 'Pending'
  && /^RESUME_(WAITING|PENDING)\b/.test(errorText(op!));

const hintPhases = (op: Operation): Set<string> =>
  rawMove(op) != null ? CROSS_HINT_PHASES : LOCAL_HINT_PHASES;

/**
 * Show the source-stopped hint for a parked or in-flight resumed move that
 * stopped a running source (`args.wasRunning === '1'`). Local moves are
 * unchanged (no engine id required). A cross-Engine move (`op.move` present)
 * also needs `engineId` to be the source Engine (`isSourceEngineOp`).
 */
export const showsSourceStoppedHint = (
  op: Operation | null | undefined,
  engineId?: string | null,
): boolean => {
  if (!isResumableMove(op)) return false;
  if (!HINT_STATUSES.has(op!.status)) return false;
  if (op!.args?.wasRunning !== '1') return false;
  if (!hintPhases(op!).has(phaseOf(op!))) return false;
  if (rawMove(op) != null) return isSourceEngineOp(op, engineId);
  return true;
};

/**
 * Plain status line for a parked move. Unknown RESUME_ prefixes, and
 * in-flight resumes, return null so the card keeps "Pending" / "Running"
 * and never shows a raw code.
 */
export const parkedMoveStatusText = (op: Operation | null | undefined): string | null => {
  if (!isResumableMove(op) || op!.status !== 'Pending') return null;
  const err = errorText(op!);
  if (/^RESUME_WAITING\b/.test(err)) return PARKED_WAITING_STATUS;
  if (/^RESUME_PENDING\b/.test(err)) return PARKED_PENDING_STATUS;
  return null;
};

/**
 * The newest parked / mid-resume move that is keeping this source instance
 * stopped on `engineId` (the instance's Engine; required for a cross-Engine op).
 */
export const sourceStoppedMoveFor = (
  store: Store | null,
  instanceId: string,
  engineId?: string | null,
): Operation | null => {
  if (!store || !instanceId) return null;
  const id = String(instanceId);
  return Object.values(store.operationDB ?? {})
    .filter((op) => showsSourceStoppedHint(op, engineId) && sourceInstanceIdOf(op) === id)
    .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
};
