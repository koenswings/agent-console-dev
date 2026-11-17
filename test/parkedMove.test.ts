/** Parked / resumed moveApp hint (engine#509; cross-Engine resume provisional on engine#497 option A). */
import { describe, it, expect } from 'vitest';
import type { Operation, Store } from '../src/types/store';
import {
  SOURCE_STOPPED_HINT,
  PARKED_WAITING_STATUS,
  PARKED_PENDING_STATUS,
  isLocalResumableMove,
  isParkedMove,
  isSourceEngineOp,
  showsSourceStoppedHint,
  parkedMoveStatusText,
  sourceStoppedMoveFor,
} from '../src/store/parkedMove';

const SRC = 'ENGINE_1';
const TGT = 'ENGINE_2';

const base = (overrides: Partial<Operation> & { args?: Record<string, string>; move?: unknown } = {}): Operation => {
  const { args, move, ...rest } = overrides;
  const op: Operation = {
    id: 'mv-local',
    kind: 'moveApp',
    args: {
      instanceId: 'inst-src',
      sourceDiskId: 'disk-src',
      targetDiskId: 'disk-tgt',
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
    args: { phase: 'copying', wasRunning: '1', crossEngine: 'true' },
    move: crossMove(),
    error: 'RESUME_WAITING: source disk left',
    ...overrides,
  });

const storeOf = (...ops: Operation[]): Store => ({
  engineDB: {},
  diskDB: {},
  appDB: {},
  instanceDB: {},
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
    const store = storeOf(op);
    expect(sourceStoppedMoveFor(store, 'inst-src')?.id).toBe('mv-local');
    expect(sourceStoppedMoveFor(store, 'inst-tgt')).toBeNull();
    expect(sourceStoppedMoveFor(store, 'other')).toBeNull();
    expect(sourceStoppedMoveFor(null, 'inst-src')).toBeNull();
  });
});

describe('parkedMove helpers — cross-Engine (provisional, engine#497 option A)', () => {
  it('parked from the source Engine: hint + waiting status', () => {
    const op = cross();
    expect(isLocalResumableMove(op)).toBe(false);
    expect(isParkedMove(op)).toBe(true);
    expect(isSourceEngineOp(op, SRC)).toBe(true);
    expect(showsSourceStoppedHint(op, SRC)).toBe(true);
    expect(parkedMoveStatusText(op)).toBe(PARKED_WAITING_STATUS);
    expect(sourceStoppedMoveFor(storeOf(op), 'inst-src', SRC)?.id).toBe('mv-cross');
  });

  it('parked from the target Engine: no hint (remote source)', () => {
    const op = cross();
    expect(isSourceEngineOp(op, TGT)).toBe(false);
    expect(showsSourceStoppedHint(op, TGT)).toBe(false);
    expect(sourceStoppedMoveFor(storeOf(op), 'inst-src', TGT)).toBeNull();
    // The move itself is still parked; the status line may appear on its card.
    expect(isParkedMove(op)).toBe(true);
    expect(parkedMoveStatusText(op)).toBe(PARKED_WAITING_STATUS);
  });

  it('engineId fallback: op.engineId when move.sourceEngineId is absent', () => {
    const op = cross({ move: crossMove() }); // no sourceEngineId
    expect(isSourceEngineOp(op, SRC)).toBe(true);
    expect(isSourceEngineOp(op, TGT)).toBe(false);
    expect(showsSourceStoppedHint(op, SRC)).toBe(true);
    expect(showsSourceStoppedHint(op, TGT)).toBe(false);
  });

  it('engineId: move.sourceEngineId wins over op.engineId when present', () => {
    const op = cross({
      engineId: TGT, // would be wrong if we only looked here
      move: crossMove({ sourceEngineId: SRC }),
    });
    expect(isSourceEngineOp(op, SRC)).toBe(true);
    expect(isSourceEngineOp(op, TGT)).toBe(false);
    expect(showsSourceStoppedHint(op, SRC)).toBe(true);
    expect(showsSourceStoppedHint(op, TGT)).toBe(false);
  });

  it('no hint when this Engine is unknown', () => {
    const op = cross();
    expect(isSourceEngineOp(op, null)).toBe(false);
    expect(showsSourceStoppedHint(op)).toBe(false);
    expect(showsSourceStoppedHint(op, null)).toBe(false);
    expect(sourceStoppedMoveFor(storeOf(op), 'inst-src')).toBeNull();
  });

  it('checking phase (idea#79 mid-move) is treated as in-flight; removing is not', () => {
    const checking = cross({
      args: { phase: 'checking', wasRunning: '1', crossEngine: 'true' },
      move: crossMove({ phase: 'checking' }),
    });
    expect(showsSourceStoppedHint(checking, SRC)).toBe(true);
    const removing = cross({
      args: { phase: 'removing', wasRunning: '1', crossEngine: 'true' },
      move: crossMove({ phase: 'removing' }),
    });
    expect(showsSourceStoppedHint(removing, SRC)).toBe(false);
  });

  it('phase may come from op.move when args.phase is absent', () => {
    const op = cross({
      args: { wasRunning: '1', crossEngine: 'true' },
      move: crossMove({ phase: 'copying' }),
    });
    expect(showsSourceStoppedHint(op, SRC)).toBe(true);
  });

  it('gave up: Failed RESUME_GAVE_UP, no hint on source or target', () => {
    const op = cross({
      status: 'Failed',
      error: 'RESUME_GAVE_UP: rsync failed',
      args: { phase: 'copying', wasRunning: '1', crossEngine: 'true', resumeFailures: '3' },
      completedAt: 1,
    });
    expect(isParkedMove(op)).toBe(false);
    expect(showsSourceStoppedHint(op, SRC)).toBe(false);
    expect(showsSourceStoppedHint(op, TGT)).toBe(false);
    expect(parkedMoveStatusText(op)).toBeNull();
    expect(sourceStoppedMoveFor(storeOf(op), 'inst-src', SRC)).toBeNull();
  });

  it('Done: no hint on source or target', () => {
    const op = cross({
      status: 'Done',
      error: null,
      args: { phase: 'done', wasRunning: '1', crossEngine: 'true' },
      move: crossMove({ phase: 'done', code: 'MOVED' }),
      completedAt: 1,
    });
    expect(isParkedMove(op)).toBe(false);
    expect(showsSourceStoppedHint(op, SRC)).toBe(false);
    expect(showsSourceStoppedHint(op, TGT)).toBe(false);
    expect(parkedMoveStatusText(op)).toBeNull();
  });
});
