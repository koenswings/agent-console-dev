/** Parked / resumed moveApp hint (engine#509 / engine#511 Console contract). */
import { describe, it, expect } from 'vitest';
import type { Instance, Operation, Store } from '../src/types/store';
import {
  SOURCE_STOPPED_HINT,
  PARKED_WAITING_STATUS,
  PARKED_PENDING_STATUS,
  isLocalResumableMove,
  isCrossResumableMove,
  isParkedMove,
  isSourceEngineOp,
  isResumeParkedText,
  parkedStatusFromText,
  showsSourceStoppedHint,
  parkedMoveStatusText,
  sourceStoppedMoveFor,
} from '../src/store/parkedMove';
import { MOVE_CODE_TEXT, MOVE_REFUSAL_CODES, settleMoveOutcome } from '../src/store/moveApp';

const SRC = 'ENGINE_1';
const TGT = 'ENGINE_2';
const SRC_DISK = 'disk-src';
const TGT_DISK = 'disk-tgt';

const inst = (storedOn: string, id = 'inst-src'): Instance => ({
  id,
  instanceOf: 'app-1',
  name: 'kolibri',
  status: 'Stopped',
  port: 8080,
  serviceImages: [],
  created: 0,
  lastBackup: null,
  lastStarted: 0,
  storedOn,
  statusCondition: null,
  currentStep: null,
  totalSteps: null,
  stepLabel: null,
  metrics: null,
});

const base = (overrides: Partial<Operation> & { args?: Record<string, string>; move?: unknown } = {}): Operation => {
  const { args, move, ...rest } = overrides;
  const op: Operation = {
    id: 'mv-local',
    kind: 'moveApp',
    args: {
      instanceId: 'inst-src',
      sourceDiskId: SRC_DISK,
      targetDiskId: TGT_DISK,
      targetInstanceId: 'inst-tgt',
      phase: 'copying',
      wasRunning: '1',
      ...(args ?? {}),
    },
    cause: 'console-command',
    subject: { type: 'instance', id: 'inst-src' },
    engineId: SRC,
    status: 'Pending',
    progressPercent: null,
    currentStep: null,
    totalSteps: null,
    stepLabel: null,
    startedAt: 1_700_000_000_000,
    completedAt: null,
    error: null,
    ...rest,
  };
  if (move !== undefined) (op as unknown as Record<string, unknown>).move = move;
  return op;
};

const crossMove = (extra: Record<string, unknown> = {}) => ({
  phase: 'copying',
  sourceEngineId: SRC,
  targetEngineId: TGT,
  sourceInstanceId: 'inst-src',
  targetInstanceId: 'inst-src',
  code: null,
  resultText: null,
  ...extra,
});

const cross = (overrides: Partial<Operation> & { args?: Record<string, string>; move?: unknown } = {}): Operation =>
  base({
    id: 'mv-cross',
    args: { phase: 'copying', wasRunning: '1', crossEngine: 'true', crossResume: '1' },
    move: crossMove(),
    error: 'RESUME_WAITING: source disk left',
    ...overrides,
  });

const storeOf = (ops: Operation[], storedOn: string | null = SRC_DISK): Store => ({
  engineDB: {},
  diskDB: {},
  appDB: {},
  instanceDB: storedOn == null ? {} : { 'inst-src': inst(storedOn) },
  userDB: {},
  operationDB: Object.fromEntries(ops.map((op) => [op.id, op])),
});

describe('parkedMove helpers — local', () => {
  it('parked waiting: hint + waiting status, no raw code', () => {
    const op = base({ error: 'RESUME_WAITING: source disk left' });
    expect(isLocalResumableMove(op)).toBe(true);
    expect(isParkedMove(op)).toBe(true);
    expect(showsSourceStoppedHint(op)).toBe(true);
    expect(parkedMoveStatusText(op)).toBe(PARKED_WAITING_STATUS);
    expect(parkedMoveStatusText(op)).not.toMatch(/RESUME_/);
    expect(SOURCE_STOPPED_HINT).toBe('Source stopped until the move resumes or gives up');
  });

  it('parked pending: hint + try-again status, no raw code or count', () => {
    const op = base({
      error: 'RESUME_PENDING (1/3): rsync failed',
      args: { phase: 'verified', wasRunning: '1', resumeFailures: '1' },
    });
    expect(isParkedMove(op)).toBe(true);
    expect(showsSourceStoppedHint(op)).toBe(true);
    expect(parkedMoveStatusText(op)).toBe(PARKED_PENDING_STATUS);
    expect(parkedMoveStatusText(op)).not.toMatch(/RESUME_|1\/3/);
  });

  it('resumed running: hint, no parked status rewrite', () => {
    const op = base({ status: 'Running', error: 'Retrying after interrupted run', args: { phase: 'copying', wasRunning: '1' } });
    expect(isParkedMove(op)).toBe(false);
    expect(showsSourceStoppedHint(op)).toBe(true);
    expect(parkedMoveStatusText(op)).toBeNull();
  });

  it("wasRunning '0': no hint, parked status still shown", () => {
    const op = base({ error: 'RESUME_WAITING: target disk left', args: { phase: 'copying', wasRunning: '0' } });
    expect(isParkedMove(op)).toBe(true);
    expect(showsSourceStoppedHint(op)).toBe(false);
    expect(parkedMoveStatusText(op)).toBe(PARKED_WAITING_STATUS);
  });

  it('Done: no hint', () => {
    const op = base({ status: 'Done', error: null, args: { phase: 'done', wasRunning: '1' }, completedAt: 1 });
    expect(isParkedMove(op)).toBe(false);
    expect(showsSourceStoppedHint(op)).toBe(false);
    expect(parkedMoveStatusText(op)).toBeNull();
  });

  it('gave up: Failed RESUME_GAVE_UP, no hint and no raw status', () => {
    const op = base({
      status: 'Failed',
      error: 'RESUME_GAVE_UP: rsync failed',
      args: { phase: 'copying', wasRunning: '1', resumeFailures: '3' },
      completedAt: 1,
    });
    expect(isParkedMove(op)).toBe(false);
    expect(showsSourceStoppedHint(op)).toBe(false);
    expect(parkedMoveStatusText(op)).toBeNull();
  });

  it('Cancelled: no hint (status Cancelled or Failed CANCELLED:)', () => {
    const cancelled = base({ status: 'Cancelled' as Operation['status'], error: 'CANCELLED: operator cancelled' });
    expect(showsSourceStoppedHint(cancelled)).toBe(false);
    expect(isParkedMove(cancelled)).toBe(false);
    expect(parkedMoveStatusText(cancelled)).toBeNull();
    const failedCancel = base({ status: 'Failed', error: 'CANCELLED: operator cancelled', completedAt: 1 });
    expect(showsSourceStoppedHint(failedCancel)).toBe(false);
    expect(isParkedMove(failedCancel)).toBe(false);
  });

  it('unknown RESUME_ prefix: hint if other conditions match, never a raw code', () => {
    const op = base({ error: 'RESUME_PAUSED: waiting on operator' });
    expect(isParkedMove(op)).toBe(false);
    expect(showsSourceStoppedHint(op)).toBe(true);
    expect(parkedMoveStatusText(op)).toBeNull();
    expect(JSON.stringify(op.error)).toContain('RESUME_PAUSED');
    expect(parkedMoveStatusText(op) ?? 'Pending').not.toMatch(/RESUME_/);
  });

  it('Pending with Retrying marker is an in-flight resume: hint, no parked rewrite', () => {
    const op = base({ status: 'Pending', error: 'Retrying after interrupted run', args: { phase: 'verified', wasRunning: '1' } });
    expect(isParkedMove(op)).toBe(false);
    expect(showsSourceStoppedHint(op)).toBe(true);
    expect(parkedMoveStatusText(op)).toBeNull();
  });

  it('sourceStoppedMoveFor finds the source instance and ignores the target id', () => {
    const op = base({ error: 'RESUME_WAITING: disk left' });
    const store = storeOf([op]);
    expect(sourceStoppedMoveFor(store, 'inst-src')?.id).toBe('mv-local');
    expect(sourceStoppedMoveFor(store, 'inst-tgt')).toBeNull();
    expect(sourceStoppedMoveFor(store, 'other')).toBeNull();
    expect(sourceStoppedMoveFor(null, 'inst-src')).toBeNull();
  });
});

describe('parkedMove helpers — cross-Engine (engine#511)', () => {
  it('parked from the source Engine: hint + waiting status', () => {
    const op = cross();
    const store = storeOf([op]);
    expect(isLocalResumableMove(op)).toBe(false);
    expect(isCrossResumableMove(op)).toBe(true);
    expect(isParkedMove(op)).toBe(true);
    expect(isSourceEngineOp(op, SRC)).toBe(true);
    expect(showsSourceStoppedHint(op, SRC, store)).toBe(true);
    expect(parkedMoveStatusText(op)).toBe(PARKED_WAITING_STATUS);
    expect(sourceStoppedMoveFor(store, 'inst-src', SRC)?.id).toBe('mv-cross');
  });

  it('parked from the target Engine: no hint (remote source)', () => {
    const op = cross();
    const store = storeOf([op]);
    expect(isSourceEngineOp(op, TGT)).toBe(false);
    expect(showsSourceStoppedHint(op, TGT, store)).toBe(false);
    expect(sourceStoppedMoveFor(store, 'inst-src', TGT)).toBeNull();
    expect(isParkedMove(op)).toBe(true);
    expect(parkedMoveStatusText(op)).toBe(PARKED_WAITING_STATUS);
  });

  it('engineId fallback: op.engineId when move.sourceEngineId is absent', () => {
    const op = cross({ move: crossMove({ sourceEngineId: undefined }) });
    delete (op as unknown as { move: Record<string, unknown> }).move.sourceEngineId;
    const store = storeOf([op]);
    expect(isSourceEngineOp(op, SRC)).toBe(true);
    expect(isSourceEngineOp(op, TGT)).toBe(false);
    expect(showsSourceStoppedHint(op, SRC, store)).toBe(true);
    expect(showsSourceStoppedHint(op, TGT, store)).toBe(false);
  });

  it("legacy cross-Engine op without crossResume '1': no hint", () => {
    const op = cross({ args: { phase: 'copying', wasRunning: '1', crossEngine: 'true' } });
    expect(isCrossResumableMove(op)).toBe(false);
    expect(showsSourceStoppedHint(op, SRC, storeOf([op]))).toBe(false);
    expect(sourceStoppedMoveFor(storeOf([op]), 'inst-src', SRC)).toBeNull();
  });

  it('checking and removing (still on the source disk) show the hint; verified does not', () => {
    const store = storeOf([cross()]);
    const checking = cross({
      args: { phase: 'checking', wasRunning: '1', crossEngine: 'true', crossResume: '1' },
      move: crossMove({ phase: 'checking' }),
    });
    expect(showsSourceStoppedHint(checking, SRC, store)).toBe(true);
    const removing = cross({
      args: { phase: 'removing', wasRunning: '1', crossEngine: 'true', crossResume: '1' },
      move: crossMove({ phase: 'removing' }),
    });
    expect(showsSourceStoppedHint(removing, SRC, store)).toBe(true);
    const verified = cross({
      args: { phase: 'verified', wasRunning: '1', crossEngine: 'true', crossResume: '1' },
      move: crossMove({ phase: 'verified' }),
    });
    expect(showsSourceStoppedHint(verified, SRC, store)).toBe(false);
  });

  it('storedOn mismatch (already flipped to the target): no hint, even in removing', () => {
    const op = cross({
      args: { phase: 'removing', wasRunning: '1', crossEngine: 'true', crossResume: '1' },
      move: crossMove({ phase: 'removing' }),
    });
    const store = storeOf([op], TGT_DISK);
    expect(showsSourceStoppedHint(op, SRC, store)).toBe(false);
    expect(sourceStoppedMoveFor(store, 'inst-src', SRC)).toBeNull();
  });

  it("give-up: Failed, move.phase 'failed', args.phase kept, no hint", () => {
    const op = cross({
      status: 'Failed',
      error: 'RESUME_GAVE_UP: rsync failed',
      args: { phase: 'checking', wasRunning: '1', crossEngine: 'true', crossResume: '1', resumeFailures: '3' },
      move: crossMove({ phase: 'failed', code: 'RESUME_GAVE_UP' }),
      completedAt: 1,
    });
    const store = storeOf([op]);
    expect(isParkedMove(op)).toBe(false);
    expect(showsSourceStoppedHint(op, SRC, store)).toBe(false);
    expect(showsSourceStoppedHint(op, TGT, store)).toBe(false);
    expect(parkedMoveStatusText(op)).toBeNull();
    expect(sourceStoppedMoveFor(store, 'inst-src', SRC)).toBeNull();
  });

  it('Done SOURCE_CHANGED: no hint; the existing not-moved sentence still applies', () => {
    const op = cross({
      status: 'Done',
      error: 'MOVE STOPPED: the source was started; source kept',
      args: { phase: 'done', wasRunning: '1', crossEngine: 'true', crossResume: '1' },
      move: crossMove({ phase: 'done', code: 'SOURCE_CHANGED' }),
      completedAt: 1,
    });
    const store = storeOf([op]);
    expect(isParkedMove(op)).toBe(false);
    expect(showsSourceStoppedHint(op, SRC, store)).toBe(false);
    expect(MOVE_CODE_TEXT.SOURCE_CHANGED({ app: 'kolibri', sourceEngine: 'idea01', targetEngine: 'idea03' }))
      .toBe('kolibri was not moved: it changed on idea01 while it was being copied, so it stays there.');
  });

  it('Done: no hint on source or target', () => {
    const op = cross({
      status: 'Done',
      error: null,
      args: { phase: 'done', wasRunning: '1', crossEngine: 'true', crossResume: '1' },
      move: crossMove({ phase: 'done', code: 'MOVED' }),
      completedAt: 1,
    });
    const store = storeOf([op]);
    expect(showsSourceStoppedHint(op, SRC, store)).toBe(false);
    expect(showsSourceStoppedHint(op, TGT, store)).toBe(false);
  });

  it('RESUME_PARKED trace text is treated as parked, not an end state', () => {
    const pausedWaiting = 'MOVE PAUSED: RESUME_WAITING: source disk left';
    const pausedPending = 'MOVE PAUSED: RESUME_PENDING (1/3): rsync failed';
    expect(isResumeParkedText(pausedWaiting, 'RESUME_PARKED')).toBe(true);
    expect(isResumeParkedText(pausedPending, 'RESUME_PARKED')).toBe(true);
    expect(parkedStatusFromText(pausedWaiting)).toBe(PARKED_WAITING_STATUS);
    expect(parkedStatusFromText(pausedPending)).toBe(PARKED_PENDING_STATUS);
    expect(parkedStatusFromText(pausedWaiting)).not.toMatch(/RESUME_|MOVE PAUSED/);
    const settle = settleMoveOutcome(() => storeOf([]), 'inst-src', 0, () => ({ app: 'kolibri', sourceEngine: 'idea01', targetEngine: 'idea03' }));
    expect(settle({ kind: 'error', message: pausedWaiting, code: 'RESUME_PARKED' }))
      .toEqual({ kind: 'warning', message: PARKED_WAITING_STATUS, code: 'RESUME_PARKED' });
    expect(settle({ kind: 'error', message: pausedPending, code: 'RESUME_PARKED' }))
      .toEqual({ kind: 'warning', message: PARKED_PENDING_STATUS, code: 'RESUME_PARKED' });
  });

  it('TARGET_OUTDATED and HELPER_OUTDATED already have Move-map sentences (no new keys)', () => {
    expect(MOVE_REFUSAL_CODES).toContain('TARGET_OUTDATED');
    expect(MOVE_REFUSAL_CODES).toContain('HELPER_OUTDATED');
    const c = { app: 'kolibri', sourceEngine: 'idea01', targetEngine: 'idea03' };
    expect(MOVE_CODE_TEXT.TARGET_OUTDATED(c)).toBe(
      "Couldn't move kolibri: idea03 needs a system update before Apps can be moved to it. Nothing was removed: it is still on idea01.",
    );
    expect(MOVE_CODE_TEXT.HELPER_OUTDATED(c)).toBe(
      "Couldn't move kolibri: idea01 needs a system update before Apps can be moved. Nothing was removed: it is still on idea01.",
    );
  });
});
