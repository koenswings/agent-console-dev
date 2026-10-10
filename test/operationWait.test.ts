/**
 * Stage 2 r63 FAIL@43 (copy_app): the post-Confirm settle (~120 s) tried to Start the source while copyApp
 * (498 MB image rsync) still held the instance lock. r64: with the duration harness's waitOperation hook,
 * copy/move/restore Intents wait for the Operation to END before their single post-op Start.
 */
import { describe, expect, it, vi } from 'vitest';
import { awaitOperationIfWired, isOperationLockMessage, OperationWaitError } from '../e2e/intents/operationWait';
import type { IntentContext, WaitOperationResult } from '../e2e/intents/types';

let captured: IntentContext | null = null;
vi.mock('../e2e/intents/registry', () => ({
  getIntent: () => async (ctx: IntentContext) => { captured = ctx; },
  intentRegistry: {},
  CONSOLE_INTENT_NAMES: [],
}));

const page = {} as IntentContext['page'];
const hook = (r: Partial<WaitOperationResult>) => vi.fn(async () => ({ status: 'Done', detail: '', elapsedMs: 0, ...r }) as WaitOperationResult);

/** Model of the r63 copy: the Engine holds the lock until t=330 s; Start before that is refused. */
const r63 = () => {
  let t = 0;
  const lockUntil = 330_000;
  return {
    advance: (ms: number) => { t += ms; },
    start: () => { if (t < lockUntil) throw new Error('start-instance-kolibri-grade5a-001 still disabled after 120000ms (title="Operation in progress")'); return 'Running'; },
    waitOperation: vi.fn(async () => { t = Math.max(t, lockUntil); return { status: 'Done', detail: 'copyApp#op1 Done', elapsedMs: lockUntil } as WaitOperationResult; }),
  };
};

describe('awaitOperationIfWired', () => {
  it('r63 replay: legacy flow (Start after the 120 s settle) hits the lock; the hooked flow waits for Done and Starts once', async () => {
    const old = r63();
    old.advance(120_000);
    expect(() => old.start()).toThrow(/Operation in progress/);
    const now = r63();
    const ctx: IntentContext = { page, waitOperation: now.waitOperation };
    const r = await awaitOperationIfWired(ctx, { kind: 'copyApp', instanceId: 'kolibri-grade5a-001', sinceMs: 0 }, 'copy_app');
    expect(r?.status).toBe('Done');
    expect(now.start()).toBe('Running');
    expect(now.waitOperation).toHaveBeenCalledWith({ kind: 'copyApp', instanceId: 'kolibri-grade5a-001', sinceMs: 0 });
  });
  it('copy Error fails at once with the harness dump; no post-op Start', async () => {
    const start = vi.fn();
    const ctx: IntentContext = { page, waitOperation: hook({ status: 'Error', detail: 'copyApp Failed: rsync exited with code 23 | ops=[…]', elapsedMs: 3_000 }) };
    await expect(awaitOperationIfWired(ctx, { kind: 'copyApp', instanceId: 'k', sinceMs: 0 }, 'copy_app').then(start))
      .rejects.toThrow(/copy_app: copyApp for k ended Error after 3000ms — copyApp Failed: rsync exited with code 23 .*No post-op Start attempted/);
    expect(start).not.toHaveBeenCalled();
  });
  it('Timeout fails with the dumped state', async () => {
    const ctx: IntentContext = { page, waitOperation: hook({ status: 'Timeout', detail: 'moveApp not terminal within 900000ms | ops=[idea01:moveApp#m status=Running]', elapsedMs: 900_000 }) };
    const p = awaitOperationIfWired(ctx, { kind: 'moveApp', instanceId: 'k', sinceMs: 0 }, 'move_app');
    await expect(p).rejects.toBeInstanceOf(OperationWaitError);
    await expect(awaitOperationIfWired(ctx, { kind: 'moveApp', sinceMs: 0 }, 'move_app')).rejects.toThrow(/status=Running/);
  });
  it('no hook (plain e2e) or no Operation seen → null: the legacy settle runs unchanged', async () => {
    expect(await awaitOperationIfWired({ page }, { kind: 'restoreApp', sinceMs: 0 }, 'restore_from_backup')).toBeNull();
    expect(await awaitOperationIfWired({ page, waitOperation: hook({ status: 'NotSeen' }) }, { kind: 'restoreApp', sinceMs: 0 }, 'restore_from_backup')).toBeNull();
  });
  it('lock detection matches the Start title', () => {
    expect(isOperationLockMessage('still disabled after 120000ms (title="Operation in progress")')).toBe(true);
    expect(isOperationLockMessage('never Running')).toBe(false);
  });
});

describe('durationBridge passes waitOperation into the Intent context', () => {
  it('runDurationIntent → ctx.waitOperation', async () => {
    const { runDurationIntent } = await import('../e2e/intents/durationBridge');
    const w = hook({});
    const r = await runDurationIntent({ page, action: 'copy_app', instanceId: 'k', waitOperation: w });
    expect(r.ok).toBe(true);
    expect(captured?.waitOperation).toBe(w);
    captured = null;
    await runDurationIntent({ page, action: 'copy_app' });
    expect(captured!.waitOperation).toBeUndefined();
  });
});
