/**
 * Cross-Engine moveApp adapter (idea#79; Engine agent-engine-dev#289).
 *
 * The ONLY module that knows the cross-Engine Move shapes (Axle, idea#79
 * comments 6493375826 / 6493673502; engine src/data/MoveAppShapes.ts):
 *  - cap      `moveAppCrossEngine`, needed on BOTH the source and the target Engine
 *  - command  unchanged: `moveApp <instance> <sourceDiskId> <targetDiskId>` to the SOURCE Engine
 *  - op       one `moveApp` op, args.crossEngine 'true', currentStep 0..2, totalSteps 3,
 *             stepLabel Copying | Checking | Removing the old copy, and
 *             `move: { phase, targetEngineId, sourceInstanceId, targetInstanceId, code, resultText, … }`
 *  - results  Done `MOVED to <hostname>`; Failed `MOVE FAILED: <reason>; source kept` (op.error);
 *             Done + op.error `MOVED, source not removed: <reason>` (a warning, not a failure);
 *             its wording follows the row's storedOn at the end (movePlacement), not the text
 *  - engine#388 (agent-engine-dev #390, merged 4a30798): a pre-flip failure stops and quarantines
 *             the target copy and records `move.targetCleanup` 'quarantined' | 'failed' (null
 *             when not tried, e.g. COPY_FAILED, or an older Engine). SOURCE_CHANGED is a Done op
 *             with an ok trace that did NOT move the app (storedOn stays on the source); other
 *             pre-flip errors in the Removing step are Failed SOURCE_KEPT. Only MOVED and
 *             SOURCE_NOT_REMOVED (storedOn on the target when known) count as moved (moveOutcome).
 *  - refusals trace errorMessage `MOVE FAILED: <reason>; source kept` (no op)
 *  - identity the instance keeps its id and name (engine#381, 53f151d): one instanceDB row,
 *             move.targetInstanceId equals sourceInstanceId, and the Backup Disk link follows.
 *             storedOn flips to the target at the start of "Removing the old copy" (after
 *             verify); a plain copyApp still gets a fresh id. Older Engines minted a fresh id.
 * Same-Engine Move is unchanged and never reaches this module's UI.
 */
import { engineHasCapability } from './commands';
import type { Engine, Operation, Store } from '../types/store';
import type { TraceOutcome } from './commandResult';

export const CAP_MOVE_CROSS = 'moveAppCrossEngine' as const;
export const MOVE_FAILED_PREFIX = 'MOVE FAILED:';
export const NOT_REMOVED_PREFIX = 'MOVED, source not removed:';

export const canMoveCrossEngine = (source: Engine | null | undefined, target: Engine | null | undefined): boolean =>
  engineHasCapability(source, CAP_MOVE_CROSS) && engineHasCapability(target, CAP_MOVE_CROSS);

/** Engine ids of the two disks, and whether they differ. */
export const moveEngines = (store: Store | null, sourceDiskId: string, targetDiskId: string): { sourceEngineId: string | null; targetEngineId: string | null; cross: boolean } => {
  const s = store?.diskDB?.[sourceDiskId]?.dockedTo;
  const t = store?.diskDB?.[targetDiskId]?.dockedTo;
  const sourceEngineId = s ? String(s) : null;
  const targetEngineId = t ? String(t) : null;
  return { sourceEngineId, targetEngineId, cross: !!sourceEngineId && !!targetEngineId && sourceEngineId !== targetEngineId };
};

/** True when this drop is a cross-Engine Move both Engines support (new UI on). */
export const crossMoveSupported = (store: Store | null, sourceDiskId: string, targetDiskId: string): boolean => {
  const e = moveEngines(store, sourceDiskId, targetDiskId);
  return e.cross && canMoveCrossEngine(store?.engineDB?.[e.sourceEngineId!], store?.engineDB?.[e.targetEngineId!]);
};

// ── Text ────────────────────────────────────────────────────────────────────
export const moveConfirmText = (app: string, targetEngine: string): string =>
  `${app} moves to ${targetEngine}. It is copied there and checked first; only then is the old copy removed.`;

export const MOVE_STEPS = ['Copying', 'Checking', 'Removing the old copy'] as const;
const STEP_TEXT: Record<string, (engine: string) => string> = {
  Copying: (e) => `Copying to ${e}`,
  Checking: (e) => `Checking the copy on ${e}`,
  'Removing the old copy': () => 'Removing the old copy',
};

type Raw = Record<string, unknown>;
const rawOf = (o: unknown): Raw => (o && typeof o === 'object' ? (o as Raw) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export type TargetCleanup = 'quarantined' | 'failed' | null;
export interface MoveInfo {
  phase: string | null; sourceInstanceId: string | null; targetInstanceId: string | null; targetEngineId: string | null;
  code: string | null; resultText: string | null;
  /** engine#388: what happened to the target copy after a pre-flip failure (null = not tried / older Engine). */
  targetCleanup: TargetCleanup; targetCleanupDetail: string | null;
}
export const moveInfo = (op: Operation | null): MoveInfo | null => {
  if (!op) return null;
  const m = rawOf((op as unknown as Raw).move);
  return {
    phase: str(m.phase), sourceInstanceId: str(m.sourceInstanceId), targetInstanceId: str(m.targetInstanceId),
    targetEngineId: str(m.targetEngineId), code: str(m.code), resultText: str(m.resultText),
    targetCleanup: m.targetCleanup === 'quarantined' || m.targetCleanup === 'failed' ? m.targetCleanup : null,
    targetCleanupDetail: str(m.targetCleanupDetail),
  };
};

/** The newest cross-Engine moveApp op for the source instance, started at/after `since`. */
export const latestMoveOp = (store: Store | null, sourceInstanceId: string, since = 0): Operation | null =>
  Object.values(store?.operationDB ?? {})
    .filter((op) => op.kind === 'moveApp' && op.startedAt >= since
      && (moveInfo(op)?.sourceInstanceId ?? String(op.args?.instanceId)) === sourceInstanceId
      && (op.args?.crossEngine === 'true' || !!rawOf((op as unknown as Raw).move).phase))
    .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;

export const isMoveRunning = (op: Operation | null): boolean => !!op && (op.status === 'Running' || op.status === 'Pending');

/** Step index 0..2 (null when unknown). */
export const moveStepIndex = (op: Operation | null): number | null => {
  if (!op) return null;
  const byLabel = op.stepLabel ? MOVE_STEPS.indexOf(op.stepLabel as typeof MOVE_STEPS[number]) : -1;
  if (byLabel >= 0) return byLabel;
  const phase = moveInfo(op)?.phase;
  const byPhase = phase === 'copying' ? 0 : phase === 'checking' ? 1 : phase === 'removing' ? 2 : -1;
  if (byPhase >= 0) return byPhase;
  return typeof op.currentStep === 'number' && op.currentStep >= 0 && op.currentStep <= 2 ? op.currentStep : null;
};

export const moveStepText = (op: Operation | null, targetEngine: string): string | null => {
  const i = moveStepIndex(op);
  return i == null ? null : `Step ${i + 1} of 3: ${STEP_TEXT[MOVE_STEPS[i]](targetEngine)}`;
};

const reasonOf = (text: string, prefix: string): string =>
  text.trim().slice(prefix.length).replace(/;\s*source kept\s*\.?$/i, '').trim().replace(/[.;\s]+$/, '');

// ── Codes (engine#289 b5429d6, engine#381 53f151d, engine#388 4a30798; MOVE_CODES in src/data/MoveAppShapes.ts) ─
export const MOVE_REFUSAL_CODES = ['NOT_FOUND', 'AMBIGUOUS', 'SOURCE_REMOTE', 'TARGET_UNREACHABLE', 'PEER_ACCESS', 'TARGET_OUTDATED', 'HELPER_OUTDATED', 'BUSY', 'INVALID', 'TARGET_EXISTS'] as const;
export const MOVE_FAILURE_CODES = ['COPY_FAILED', 'VERIFY_NOT_FOUND', 'VERIFY_NOT_RUNNING', 'VERIFY_SIZE', 'VERIFY_TIMEOUT', 'VERIFY_FAILED', 'INTERRUPTED', 'SOURCE_KEPT'] as const;
export const MOVE_DONE_CODES = ['MOVED', 'SOURCE_NOT_REMOVED', 'SOURCE_CHANGED'] as const;

export interface MoveCtx { app: string; sourceEngine: string; targetEngine: string }
const kept = (c: MoveCtx): string => `Nothing was removed: it is still on ${c.sourceEngine}.`;

/** Refusals and failures (source kept): one plain sentence per code. */
export const MOVE_CODE_TEXT: Record<string, (c: MoveCtx) => string> = {
  // Refusals (no op; trace errorCode)
  NOT_FOUND: (c) => `Couldn't move ${c.app}: it is no longer on this disk. Nothing changed.`,
  AMBIGUOUS: (c) => `Couldn't move ${c.app}: more than one app matches. ${kept(c)}`,
  SOURCE_REMOTE: (c) => `Couldn't move ${c.app}: its disk is no longer in ${c.sourceEngine}. Nothing changed.`,
  TARGET_UNREACHABLE: (c) => `Couldn't move ${c.app}: ${c.targetEngine} can't be reached. Check that ${c.targetEngine} is switched on and connected to the school network, then try again. ${kept(c)}`,
  PEER_ACCESS: (c) => `Couldn't move ${c.app}: ${c.sourceEngine} and ${c.targetEngine} are not yet allowed to share Apps. Ask for help. ${kept(c)}`,
  TARGET_OUTDATED: (c) => `Couldn't move ${c.app}: ${c.targetEngine} needs a system update before Apps can be moved to it. ${kept(c)}`,
  HELPER_OUTDATED: (c) => `Couldn't move ${c.app}: ${c.sourceEngine} needs a system update before Apps can be moved. ${kept(c)}`,
  BUSY: (c) => `Couldn't move ${c.app}: something else is running on it or on the target disk. Try again when it is done. ${kept(c)}`,
  INVALID: (c) => `Couldn't move ${c.app} to that disk. ${kept(c)}`,
  // engine#381 (53f151d): the same id is already stored on the target Engine, or its folder is on the target disk.
  TARGET_EXISTS: (c) => `Couldn't move ${c.app}: an app with the same id is already on ${c.targetEngine}. ${kept(c)}`,
  // Failed outcomes (op Failed, source kept)
  COPY_FAILED: (c) => `Couldn't move ${c.app}: the copy to ${c.targetEngine} didn't finish. ${kept(c)}`,
  VERIFY_NOT_FOUND: (c) => `Couldn't move ${c.app}: the copy didn't show up on ${c.targetEngine}. ${kept(c)}`,
  VERIFY_NOT_RUNNING: (c) => `Couldn't move ${c.app}: the copy on ${c.targetEngine} didn't start. ${kept(c)}`,
  VERIFY_SIZE: (c) => `Couldn't move ${c.app}: the copy on ${c.targetEngine} is not complete. ${kept(c)}`,
  VERIFY_TIMEOUT: (c) => `Couldn't move ${c.app}: ${c.targetEngine} didn't confirm the copy in time. ${kept(c)}`,
  VERIFY_FAILED: (c) => `Couldn't move ${c.app}: the copy on ${c.targetEngine} couldn't be checked. ${kept(c)}`,
  INTERRUPTED: (c) => `Couldn't move ${c.app}: ${c.sourceEngine} restarted during the move. ${kept(c)}`,
  // engine#388: any other pre-flip error in the Removing step (op Failed)
  SOURCE_KEPT: (c) => `${c.app} was not moved, so it stays on ${c.sourceEngine}.`,
  // engine#388: op Done with an ok trace, but NOT a move (the source was started or written to)
  SOURCE_CHANGED: (c) => `${c.app} was not moved: it changed on ${c.sourceEngine} while it was being copied, so it stays there.`,
};

/** Codes after which the Engine tries to clean up the target copy (engine#388); only these get a cleanup sentence. */
export const MOVE_CLEANUP_CODES: ReadonlySet<string> = new Set(['SOURCE_KEPT', 'SOURCE_CHANGED', 'VERIFY_NOT_FOUND', 'VERIFY_NOT_RUNNING', 'VERIFY_SIZE', 'VERIFY_TIMEOUT', 'VERIFY_FAILED']);

/** The sentence about the target copy by move.targetCleanup (engine#388); null = not reported. */
export const targetCleanupLine = (cleanup: TargetCleanup, targetEngine: string): string | null =>
  cleanup === 'quarantined' ? MOVE_TARGET_SET_ASIDE(targetEngine) : cleanup === 'failed' ? MOVE_TARGET_LEFTOVER(targetEngine) : null;

const withCleanup = (line: string, code: string | null, cleanup: TargetCleanup, c: MoveCtx): string => {
  const extra = code && MOVE_CLEANUP_CODES.has(code) ? targetCleanupLine(cleanup, c.targetEngine) : null;
  return extra ? `${line} ${extra}` : line;
};

/** Fallback for an unknown code: the Engine's reason in the approved sentence (Steve, #179). */
export const moveFailedLine = (message: string, app: string, sourceEngine: string): string | null => {
  const t = message.trim();
  const at = t.indexOf(MOVE_FAILED_PREFIX);
  if (at < 0) return null;
  const reason = reasonOf(t.slice(at), MOVE_FAILED_PREFIX);
  return `Couldn't move ${app}${reason ? ` (${reason})` : ''}. Nothing was removed: it is still on ${sourceEngine}.`;
};

/**
 * The whole line for a failed / refused Move: the code first (trace errorCode,
 * result.code or op.move.code), else the `MOVE FAILED:` text; null = not ours.
 */
export const moveErrorLine = (message: string, code: string | null, c: MoveCtx, cleanup: TargetCleanup = null): string | null => {
  const byCode = code ? MOVE_CODE_TEXT[code]?.(c) : undefined;
  return byCode ? withCleanup(byCode, code, cleanup, c) : moveFailedLine(message, c.app, c.sourceEngine);
};

/** `moved`: the app ended on the target (only MOVED / SOURCE_NOT_REMOVED, engine#388); never from op Done or trace ok alone. */
export type MoveOutcome =
  | { kind: 'moved'; text: string; moved: true }
  | { kind: 'warning'; text: string; moved: boolean }
  | { kind: 'failed'; text: string; moved: false };

/** Where the app's instanceDB row is when the op ends: on the source disk, the target disk, or unknown. */
export type MovePlacement = 'source' | 'target' | null;

/**
 * Engine 53f151d (Axle): SOURCE_CHANGED and a SOURCE_NOT_REMOVED thrown before
 * storedOn flips leave the row on the source disk; only SOURCE_NOT_REMOVED after
 * the flip (removeSource failed) leaves it on the target. The result text is not
 * reliable (engine#388), so the outcome branches on the row's storedOn.
 */
export const movePlacement = (store: Store | null, op: Operation | null): MovePlacement => {
  if (!store || !op) return null;
  const info = moveInfo(op);
  const sourceDiskId = String(op.args?.sourceDiskId ?? '');
  const targetDiskId = String(op.args?.targetDiskId ?? '');
  const sourceId = info?.sourceInstanceId ?? String(op.args?.instanceId ?? '');
  const targetId = info?.targetInstanceId ?? sourceId;
  const at = (id: string): string | null => {
    const v = store.instanceDB?.[id]?.storedOn;
    return v == null ? null : String(v);
  };
  if (targetId && targetDiskId && at(targetId) === targetDiskId) return 'target';
  if (sourceId && sourceDiskId && at(sourceId) === sourceDiskId) return 'source';
  return null;
};

/** The sentence about the copy left on the target (engine#388 targetCleanup 'failed', and older Engines). */
export const MOVE_TARGET_LEFTOVER = (targetEngine: string): string => `A leftover copy is on ${targetEngine}.`;
/** engine#388 targetCleanup 'quarantined': the target copy was stopped and set aside. */
export const MOVE_TARGET_SET_ASIDE = (targetEngine: string): string => `The unfinished copy on ${targetEngine} was set aside.`;

/**
 * Done with the source not removed (SOURCE_CHANGED / SOURCE_NOT_REMOVED): one sentence per placement.
 * `cleanup` (engine#388) picks the target-copy sentence; null keeps the older storedOn-based wording.
 */
export const sourceNotRemovedLine = (code: string | null, placement: MovePlacement, c: MoveCtx, cleanup: TargetCleanup = null): string => {
  if (code === 'SOURCE_CHANGED' && cleanup) return withCleanup(MOVE_CODE_TEXT.SOURCE_CHANGED(c), code, cleanup, c);
  if (placement === 'target' && code !== 'SOURCE_CHANGED') return `${c.app} moved to ${c.targetEngine}. The old copy on ${c.sourceEngine} couldn't be removed.`;
  if (placement === 'source') {
    const target = targetCleanupLine(cleanup, c.targetEngine) ?? MOVE_TARGET_LEFTOVER(c.targetEngine);
    return code === 'SOURCE_CHANGED'
      ? `${MOVE_CODE_TEXT.SOURCE_CHANGED(c)} ${target}`
      : `${c.app} was not moved, so it stays on ${c.sourceEngine}. ${target}`;
  }
  return `The move of ${c.app} didn't finish cleanly. Check ${c.sourceEngine} and ${c.targetEngine} to see where it is.`;
};

/**
 * Final outcome of a finished cross-Engine move (null while running). Code first, text as fallback.
 * `placement` (movePlacement at the end of the op) decides the wording when the source wasn't removed.
 *
 * Moved (success) ONLY for MOVED or SOURCE_NOT_REMOVED, and then only when the row is on the
 * target or its place is unknown. SOURCE_CHANGED is a Done op with an ok trace that did not move
 * the app (engine#388): a warning, never a success. No code (older Engine): the storedOn logic.
 */
export const moveOutcome = (op: Operation | null, c: MoveCtx, placement: MovePlacement = null): MoveOutcome | null => {
  if (!op || isMoveRunning(op)) return null;
  const info = moveInfo(op);
  const text = (op.error ?? info?.resultText ?? '').trim();
  const code = info?.code ?? null;
  const cleanup = info?.targetCleanup ?? null;
  if (op.status === 'Done') {
    if (code === 'SOURCE_CHANGED') return { kind: 'warning', text: sourceNotRemovedLine(code, placement, c, cleanup), moved: false };
    if (code === 'MOVED') {
      return placement === 'source'
        ? { kind: 'warning', text: sourceNotRemovedLine(null, null, c), moved: false }
        : { kind: 'moved', text: `${c.app} moved to ${c.targetEngine}.`, moved: true };
    }
    if (code === 'SOURCE_NOT_REMOVED' || text.startsWith(NOT_REMOVED_PREFIX)) {
      // Unknown placement never claims it is on the target (idea#498).
      return { kind: 'warning', text: sourceNotRemovedLine(code, placement, c, cleanup), moved: placement === 'target' };
    }
    if (code) return { kind: 'warning', text: moveErrorLine(text, code, c, cleanup) ?? sourceNotRemovedLine(null, null, c), moved: false };
    return { kind: 'moved', text: `${c.app} moved to ${c.targetEngine}.`, moved: true };
  }
  return { kind: 'failed', text: moveErrorLine(text || MOVE_FAILED_PREFIX, code, c, cleanup) ?? text, moved: false };
};

/** App and Engine names of a moveApp op, from the store (for op cards and store confirmation). */
export const moveCtxOf = (store: Store | null, op: Operation): MoveCtx => {
  const info = moveInfo(op);
  const host = (id: string | null | undefined): string | null => (id ? String(store?.engineDB?.[id]?.hostname ?? '') || null : null);
  const instanceId = info?.sourceInstanceId ?? String(op.args?.instanceId ?? '');
  const targetDisk = store?.diskDB?.[String(op.args?.targetDiskId ?? '')];
  return {
    app: String(store?.instanceDB?.[instanceId]?.name ?? op.args?.instanceName ?? instanceId) || 'The app',
    sourceEngine: host(String(op.engineId ?? '')) ?? 'the source Engine',
    targetEngine: host(info?.targetEngineId ?? (targetDisk?.dockedTo ? String(targetDisk.dockedTo) : null)) ?? 'the other Engine',
  };
};

/** Outcome of a finished moveApp op with names from the store; null while running or for another kind. */
export const moveOpOutcome = (store: Store | null, op: Operation | null): MoveOutcome | null =>
  op && op.kind === 'moveApp' ? moveOutcome(op, moveCtxOf(store, op), movePlacement(store, op)) : null;

/** A Done moveApp op that did not move the app (e.g. SOURCE_CHANGED): shown as a warning, not a success. */
export const isMoveDoneNotMoved = (store: Store | null, op: Operation | null): boolean =>
  !!op && op.status === 'Done' && moveOpOutcome(store, op)?.moved === false;

/**
 * commandResult `settle` for a sent moveApp (desktop drag and mobile Move sheet): an ok
 * trace or Done op is a success only when the app moved (engine#388). The newest move op
 * of the instance decides; before it is visible, an ok trace's result code does.
 */
export const settleMoveOutcome = (store: () => Store | null, instanceId: string, since: number, ctx: () => MoveCtx) =>
  (o: TraceOutcome): TraceOutcome => {
    if (o.kind !== 'ok') return o;
    const s = store();
    const op = latestMoveOp(s, instanceId, since);
    if (op && op.status === 'Done') {
      const out = moveOpOutcome(s, op);
      const code = moveInfo(op)?.code ?? null;
      return out && !out.moved ? { kind: 'warning', message: out.text, ...(code ? { code } : {}) } : o;
    }
    if (o.code === 'SOURCE_CHANGED') return { kind: 'warning', message: MOVE_CODE_TEXT.SOURCE_CHANGED(ctx()), code: o.code };
    return o;
  };

/** The failure sentence for a sent moveApp, with the target-copy sentence from the newest move op. */
export const moveErrorLineFor = (store: Store | null, instanceId: string, since: number, message: string, code: string | null, ctx: MoveCtx): string | null => {
  const info = moveInfo(latestMoveOp(store, instanceId, since));
  return moveErrorLine(message, code ?? info?.code ?? null, ctx, info?.targetCleanup ?? null);
};
