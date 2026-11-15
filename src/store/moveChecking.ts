/**
 * Live progress during the Checking step of a cross-Engine Move (idea#498).
 *
 * The TARGET Engine sends an ephemeral (never stored) message about once a
 * second while it checks that the moved app stays up:
 *   { type: 'idea/progress', opId, step: 'Checking', bytesDone, bytesTotal,
 *     checking: { phase: 'starting' | 'stabilising' | 'stable', label, stableElapsedMs, stableTargetMs } }
 * It is matched on opId only, whichever Engine it came from (Engines relay
 * ephemeral messages to their peers). Elapsed time is not monotonic: when the
 * port stops answering, the phase goes back to 'starting' at 0 ms.
 * Engines that don't send it leave today's plain Checking step text.
 */
import { createSignal } from 'solid-js';
import type { Operation } from '../types/store';
import { isMoveRunning, moveStepIndex } from './moveApp';

export const MOVE_PROGRESS_TYPE = 'idea/progress';
/** No message for this long: drop the live line (about 15 missed 1 s messages; liveNow ticks every 5 s). */
export const MOVE_CHECKING_STALE_MS = 15_000;
const CHECKING_STEP = 1;

export interface MoveChecking {
  phase: string;
  label: string | null;
  stableElapsedMs: number | null;
  stableTargetMs: number | null;
  receivedAt: number;
}

type Raw = Record<string, unknown>;
const ms = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Pure: the map (by opId) after one ephemeral message; unchanged unless it carries a `checking` object. */
export const applyMoveChecking = (
  state: Record<string, MoveChecking>, message: unknown, receivedAt: number,
): Record<string, MoveChecking> => {
  const m = message as Raw | null;
  if (!m || typeof m !== 'object' || m.type !== MOVE_PROGRESS_TYPE) return state;
  if (typeof m.opId !== 'string' || !m.opId) return state;
  const c = m.checking as Raw | null | undefined;
  if (!c || typeof c !== 'object') return state;
  const phase = text(c.phase);
  const label = text(c.label);
  if (!phase && !label) return state;
  return {
    ...state,
    [m.opId]: { phase: phase ?? '', label, stableElapsedMs: ms(c.stableElapsedMs), stableTargetMs: ms(c.stableTargetMs), receivedAt },
  };
};

/** Plain sentence for one message; checking.label for a phase we don't know; null = nothing to show. */
export const moveCheckingText = (c: MoveChecking): string | null => {
  const secs = (v: number) => Math.round(v / 1000);
  if (c.phase === 'starting') return 'Starting on the new Engine';
  if (c.phase === 'stabilising' && c.stableElapsedMs != null && c.stableTargetMs != null && c.stableTargetMs > 0) {
    const target = secs(c.stableTargetMs);
    const done = Math.min(Math.floor(c.stableElapsedMs / 1000), target);
    return `Checking it stays up: ${done} of ${target} seconds`;
  }
  if (c.phase === 'stable') {
    return c.stableTargetMs != null && c.stableTargetMs > 0
      ? `It stayed up for ${secs(c.stableTargetMs)} seconds`
      : 'It stays up';
  }
  return c.label;
};

/**
 * The live Checking line for this op, or null (fall back to the step text):
 * only while the op runs and is on the Checking step, and the last message
 * is fresh (MOVE_CHECKING_STALE_MS).
 */
export const moveCheckingLine = (
  op: Operation | null, state: Record<string, MoveChecking>, now: number,
): string | null => {
  if (!op || !isMoveRunning(op) || moveStepIndex(op) !== CHECKING_STEP) return null;
  const c = state[op.id];
  if (!c || now - c.receivedAt > MOVE_CHECKING_STALE_MS) return null;
  return moveCheckingText(c);
};

const [moveChecking, setMoveChecking] = createSignal<Record<string, MoveChecking>>({});
export { moveChecking };
/** Fed from live.ts receiveEphemeral. */
export const receiveMoveChecking = (message: unknown, receivedAt: number = Date.now()): void => {
  const m = message as Raw | null;
  if (m?.type !== MOVE_PROGRESS_TYPE || !m.checking) return;
  setMoveChecking((s) => applyMoveChecking(s, message, receivedAt));
};
export const resetMoveChecking = (): void => { setMoveChecking({}); };
