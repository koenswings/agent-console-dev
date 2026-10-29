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
 *             Done + op.error `MOVED, source not removed: <reason>` (a warning, not a failure)
 *  - refusals trace errorMessage `MOVE FAILED: <reason>; source kept` (no op)
 *  - identity the target gets a fresh instance id; the name is kept
 * Same-Engine Move is unchanged and never reaches this module's UI.
 */
import { engineHasCapability } from './commands';
import type { Engine, Operation, Store } from '../types/store';

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

export interface MoveInfo { phase: string | null; sourceInstanceId: string | null; targetInstanceId: string | null; targetEngineId: string | null; code: string | null; resultText: string | null }
export const moveInfo = (op: Operation | null): MoveInfo | null => {
  if (!op) return null;
  const m = rawOf((op as unknown as Raw).move);
  return {
    phase: str(m.phase), sourceInstanceId: str(m.sourceInstanceId), targetInstanceId: str(m.targetInstanceId),
    targetEngineId: str(m.targetEngineId), code: str(m.code), resultText: str(m.resultText),
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

// ── Codes (engine#289 b5429d6, MOVE_CODES in src/data/MoveAppShapes.ts) ─────
export const MOVE_REFUSAL_CODES = ['NOT_FOUND', 'AMBIGUOUS', 'SOURCE_REMOTE', 'TARGET_UNREACHABLE', 'PEER_ACCESS', 'TARGET_OUTDATED', 'HELPER_OUTDATED', 'BUSY', 'INVALID'] as const;
export const MOVE_FAILURE_CODES = ['COPY_FAILED', 'VERIFY_NOT_FOUND', 'VERIFY_NOT_RUNNING', 'VERIFY_SIZE', 'VERIFY_TIMEOUT', 'VERIFY_FAILED', 'INTERRUPTED'] as const;
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
  // Failed outcomes (op Failed, source kept)
  COPY_FAILED: (c) => `Couldn't move ${c.app}: the copy to ${c.targetEngine} didn't finish. ${kept(c)}`,
  VERIFY_NOT_FOUND: (c) => `Couldn't move ${c.app}: the copy didn't show up on ${c.targetEngine}. ${kept(c)}`,
  VERIFY_NOT_RUNNING: (c) => `Couldn't move ${c.app}: the copy on ${c.targetEngine} didn't start. ${kept(c)}`,
  VERIFY_SIZE: (c) => `Couldn't move ${c.app}: the copy on ${c.targetEngine} is not complete. ${kept(c)}`,
  VERIFY_TIMEOUT: (c) => `Couldn't move ${c.app}: ${c.targetEngine} didn't confirm the copy in time. ${kept(c)}`,
  VERIFY_FAILED: (c) => `Couldn't move ${c.app}: the copy on ${c.targetEngine} couldn't be checked. ${kept(c)}`,
  INTERRUPTED: (c) => `Couldn't move ${c.app}: ${c.sourceEngine} restarted during the move. ${kept(c)}`,
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
export const moveErrorLine = (message: string, code: string | null, c: MoveCtx): string | null =>
  (code && MOVE_CODE_TEXT[code]?.(c)) || moveFailedLine(message, c.app, c.sourceEngine);

export type MoveOutcome =
  | { kind: 'moved'; text: string }
  | { kind: 'warning'; text: string }
  | { kind: 'failed'; text: string };

/** Final outcome of a finished cross-Engine move (null while running). Code first, text as fallback. */
export const moveOutcome = (op: Operation | null, c: MoveCtx): MoveOutcome | null => {
  if (!op || isMoveRunning(op)) return null;
  const info = moveInfo(op);
  const text = (op.error ?? info?.resultText ?? '').trim();
  const code = info?.code ?? null;
  if (op.status === 'Done') {
    if (code === 'SOURCE_CHANGED') {
      return { kind: 'warning', text: `${c.app} moved to ${c.targetEngine} and works there. The old copy on ${c.sourceEngine} was kept because it changed during the move. Nothing is lost; ask for help to remove the old copy.` };
    }
    if (code === 'SOURCE_NOT_REMOVED' || (code !== 'MOVED' && text.startsWith(NOT_REMOVED_PREFIX))) {
      const reason = text.startsWith(NOT_REMOVED_PREFIX) ? reasonOf(text, NOT_REMOVED_PREFIX) : '';
      return { kind: 'warning', text: `${c.app} moved to ${c.targetEngine} and works there, but the old copy could not be removed${reason ? ` (${reason})` : ''}. Nothing is lost; ask for help to remove the old copy.` };
    }
    return { kind: 'moved', text: `${c.app} moved to ${c.targetEngine}.` };
  }
  return { kind: 'failed', text: moveErrorLine(text || MOVE_FAILED_PREFIX, code, c) ?? text };
};
