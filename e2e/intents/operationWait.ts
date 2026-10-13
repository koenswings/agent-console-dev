/**
 * Stage 2 r63 FAIL@43 (copy_app): after Confirm the Intent's ~120 s settle tried to Start the source while
 * the Engine copyApp still held the instance lock ("Operation in progress"); the copy (≈498 MB image
 * rsync) finished minutes later. When the duration harness hands a `waitOperation` hook, long-running
 * Intents (copy/move/restore) wait for the Operation to end in the store BEFORE their single post-op
 * Start/settle. Without the hook (plain e2e runs) behaviour is unchanged.
 */
import type { IntentContext, WaitOperationResult, WaitOperationKind } from './types';

export class OperationWaitError extends Error {}

/**
 * Wait for the Operation started at/after `sinceMs` to end. Returns the result when it ended Done,
 * null when no hook is wired or no Operation was seen (caller keeps its legacy settle).
 * Throws on Error (Failed/Cancelled) and on the harness budget (Timeout), with the harness's dump.
 */
export async function awaitOperationIfWired(
  ctx: IntentContext,
  q: { kind: WaitOperationKind; instanceId?: string; sinceMs: number },
  intent: string,
): Promise<WaitOperationResult | null> {
  if (typeof ctx.waitOperation !== 'function') return null;
  const r = await ctx.waitOperation(q);
  if (r.status === 'Done') return r;
  if (r.status === 'NotSeen') return null;
  throw new OperationWaitError(
    `idea#168 ${intent}: ${q.kind} for ${q.instanceId ?? '?'} ended ${r.status} after ${r.elapsedMs}ms — ${r.detail}. ` +
      `No post-op Start attempted. No soft-pass.`,
  );
}

/** True for a Start/Stop button blocked by an Operation lock. */
export const isOperationLockMessage = (msg: string): boolean => /operation in progress/i.test(msg);
