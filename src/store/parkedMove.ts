/**
 * moveApp park / resume helpers (engine#509 / engine#511 Console contract).
 *
 * A local move has kind `moveApp`, no `op.move`, and `args.phase` set
 * (`copying` / `verified`). A new cross-Engine move has `op.move` and
 * `args.crossResume === '1'` (engine#497 option A, engine#511). It reuses the
 * local markers (Pending + RESUME_WAITING / RESUME_PENDING, RETRY_MARKER,
 * Failed RESUME_GAVE_UP, args.wasRunning). `args.phase === op.move.phase`
 * while in flight or parked; after a give-up, `op.move.phase` becomes
 * `failed` and `args.phase` keeps the phase it gave up in.
 * Cross-Engine phases are copying → checking → removing → done/failed
 * (no `verified`). The "Source stopped…" hint follows the engine#511 rule
 * and is only shown when the source is still on the source disk.
 */
import type { Operation, Store } from '../types/store';

export const SOURCE_STOPPED_HINT = 'Source stopped until the move resumes or gives up';

/** Parked because a disk went away; waiting for it to be docked again. */
export const PARKED_WAITING_STATUS = 'Waiting for the disk to come back';
/** Parked after a counted failure; resumes at the next boot or dock. */
export const PARKED_PENDING_STATUS = 'Waiting to try again';

/** Local parked / mid-resume phases (engine#509). */
const LOCAL_HINT_PHASES = new Set(['copying', 'verified']);
/** Cross-Engine mid-move phases (engine#511). No `verified`. */
const CROSS_HINT_PHASES = new Set(['copying', 'checking', 'removing']);
const HINT_STATUSES = new Set(['Pending', 'Running']);

type Raw = Record<string, unknown>;
const rawOf = (o: unknown): Raw => (o && typeof o === 'object' ? (o as Raw) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const rawMove = (op: Operation | null | undefined): unknown =>
  op ? (op as unknown as Raw).move : undefined;
const errorText = (op: Operation): string => String(op.error ?? '');

export const sourceInstanceIdOf = (op: Operation): string =>
  String(str(rawOf(rawMove(op)).sourceInstanceId) ?? op.args?.instanceId ?? op.subject?.id ?? '');

/**
 * The source Engine of a move: `op.move.sourceEngineId` when present
 * (new engine#511 ops; always equal to `op.engineId`), else `op.engineId`.
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

/** A new cross-Engine resumable move (engine#511): op.move and args.crossResume '1'. */
export const isCrossResumableMove = (op: Operation | null | undefined): boolean =>
  !!op && op.kind === 'moveApp' && rawMove(op) != null && op.args?.crossResume === '1';

/** Local or new cross-Engine moveApp that can park / resume in place. */
export const isResumableMove = (op: Operation | null | undefined): boolean =>
  isLocalResumableMove(op) || isCrossResumableMove(op);

/** Trace or op text for a parked run (engine#511): code RESUME_PARKED, text starts `MOVE PAUSED: RESUME_…`. */
export const isResumeParkedText = (raw: string | null | undefined, code?: string | null): boolean =>
  code === 'RESUME_PARKED' || /^(?:MOVE PAUSED:\s*)?RESUME_(WAITING|PENDING)\b/.test(String(raw ?? '').trim());

/** Plain waiting line from a parked error or `MOVE PAUSED: RESUME_…` trace text. */
export const parkedStatusFromText = (raw: string | null | undefined): string | null => {
  const m = String(raw ?? '').trim().match(/^(?:MOVE PAUSED:\s*)?RESUME_(WAITING|PENDING)\b/);
  if (!m) return null;
  return m[1] === 'WAITING' ? PARKED_WAITING_STATUS : PARKED_PENDING_STATUS;
};

/** Pending move waiting for a disk (WAITING) or the next boot or dock (PENDING). */
export const isParkedMove = (op: Operation | null | undefined): boolean =>
  isResumableMove(op) && op!.status === 'Pending' && isResumeParkedText(errorText(op!));

/**
 * Show the source-stopped hint for a parked or in-flight resumed move that
 * stopped a running source (`args.wasRunning === '1'`).
 *
 * Local moves are unchanged (phases `copying` / `verified`). A cross-Engine
 * move follows the engine#511 rule: `args.crossResume === '1'`, phase in
 * `{copying, checking, removing}`, `instance.storedOn === args.sourceDiskId`,
 * plus the source-Engine check (`isSourceEngineOp`). Older cross ops without
 * `crossResume` get no hint.
 */
export const showsSourceStoppedHint = (
  op: Operation | null | undefined,
  engineId?: string | null,
  store?: Store | null,
): boolean => {
  if (!op || op.kind !== 'moveApp' || !HINT_STATUSES.has(op.status) || op.args?.wasRunning !== '1') return false;
  if (isLocalResumableMove(op)) return LOCAL_HINT_PHASES.has(String(op.args.phase));
  if (!isCrossResumableMove(op)) return false;
  if (!CROSS_HINT_PHASES.has(String(op.args?.phase ?? ''))) return false;
  const instId = sourceInstanceIdOf(op);
  const storedOn = store?.instanceDB?.[instId]?.storedOn;
  if (String(storedOn ?? '') !== String(op.args?.sourceDiskId ?? '')) return false;
  return isSourceEngineOp(op, engineId);
};

/**
 * Plain status line for a parked move. Unknown RESUME_ prefixes, and
 * in-flight resumes, return null so the card keeps "Pending" / "Running"
 * and never shows a raw code.
 */
export const parkedMoveStatusText = (op: Operation | null | undefined): string | null => {
  if (!isResumableMove(op) || op!.status !== 'Pending') return null;
  return parkedStatusFromText(errorText(op!));
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
    .filter((op) => showsSourceStoppedHint(op, engineId, store) && sourceInstanceIdOf(op) === id)
    .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
};
