import { describe, it, expect } from 'vitest';
import {
  getActiveOpsForInstance,
  getActiveOpsForDisk,
  isInstanceLocked,
  isDiskLocked,
} from '../store/operations';
import type { Store, Operation } from '../types/store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeStore = (ops: Operation[]): Store => ({
  engineDB: {},
  diskDB: {},
  appDB: {},
  instanceDB: {},
  userDB: {},
  operationDB: Object.fromEntries(ops.map((op) => [op.id, op])),
});

const makeOp = (overrides: Partial<Operation> = {}): Operation => ({
  id: 'op-001',
  kind: 'copyApp',
  args: { instanceId: 'inst-001', sourceDiskId: 'disk-src', targetDiskId: 'disk-tgt' },
  engineId: 'engine-001',
  status: 'Running',
  progressPercent: 45,
  startedAt: Date.now(),
  completedAt: null,
  error: null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// getActiveOpsForInstance
// ---------------------------------------------------------------------------

describe('getActiveOpsForInstance', () => {
  it('returns empty array when store is null', () => {
    expect(getActiveOpsForInstance(null, 'inst-001')).toEqual([]);
  });

  it('returns empty array when no ops in store', () => {
    expect(getActiveOpsForInstance(makeStore([]), 'inst-001')).toEqual([]);
  });

  it('returns Running copyApp that matches instanceId', () => {
    const op = makeOp({ status: 'Running' });
    expect(getActiveOpsForInstance(makeStore([op]), 'inst-001')).toHaveLength(1);
  });

  it('returns Pending op that matches instanceId', () => {
    const op = makeOp({ status: 'Pending' });
    expect(getActiveOpsForInstance(makeStore([op]), 'inst-001')).toHaveLength(1);
  });

  it('returns active backupApp with matching instanceId', () => {
    const op = makeOp({
      kind: 'backupApp',
      args: { instanceId: 'inst-001', backupDiskId: 'disk-bkp' },
      status: 'Running',
    });
    expect(getActiveOpsForInstance(makeStore([op]), 'inst-001')).toHaveLength(1);
  });

  it('excludes Done ops', () => {
    const op = makeOp({ status: 'Done' });
    expect(getActiveOpsForInstance(makeStore([op]), 'inst-001')).toHaveLength(0);
  });

  it('excludes Failed ops', () => {
    const op = makeOp({ status: 'Failed' });
    expect(getActiveOpsForInstance(makeStore([op]), 'inst-001')).toHaveLength(0);
  });

  it('excludes ops for a different instanceId', () => {
    const op = makeOp({ status: 'Running' });
    expect(getActiveOpsForInstance(makeStore([op]), 'inst-other')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getActiveOpsForDisk
// ---------------------------------------------------------------------------

describe('getActiveOpsForDisk', () => {
  it('returns empty array when store is null', () => {
    expect(getActiveOpsForDisk(null, 'disk-src')).toEqual([]);
  });

  it('returns empty array when no ops in store', () => {
    expect(getActiveOpsForDisk(makeStore([]), 'disk-src')).toEqual([]);
  });

  it('matches sourceDiskId', () => {
    const op = makeOp({ status: 'Running' });
    expect(getActiveOpsForDisk(makeStore([op]), 'disk-src')).toHaveLength(1);
  });

  it('matches targetDiskId', () => {
    const op = makeOp({ status: 'Running' });
    expect(getActiveOpsForDisk(makeStore([op]), 'disk-tgt')).toHaveLength(1);
  });

  it('matches backupDiskId', () => {
    const op = makeOp({
      kind: 'backupApp',
      args: { instanceId: 'inst-001', backupDiskId: 'disk-bkp' },
      status: 'Running',
    });
    expect(getActiveOpsForDisk(makeStore([op]), 'disk-bkp')).toHaveLength(1);
  });

  it('excludes Done ops', () => {
    const op = makeOp({ status: 'Done' });
    expect(getActiveOpsForDisk(makeStore([op]), 'disk-src')).toHaveLength(0);
  });

  it('excludes Failed ops', () => {
    const op = makeOp({ status: 'Failed' });
    expect(getActiveOpsForDisk(makeStore([op]), 'disk-src')).toHaveLength(0);
  });

  it('does not match an unrelated disk', () => {
    const op = makeOp({ status: 'Running' });
    expect(getActiveOpsForDisk(makeStore([op]), 'disk-other')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// isInstanceLocked
// ---------------------------------------------------------------------------

describe('isInstanceLocked', () => {
  it('returns false when store is null', () => {
    expect(isInstanceLocked(null, 'inst-001')).toBe(false);
  });

  it('returns false when no active ops', () => {
    expect(isInstanceLocked(makeStore([]), 'inst-001')).toBe(false);
  });

  it('returns true with active copyApp for matching instanceId', () => {
    const op = makeOp({ status: 'Running' });
    expect(isInstanceLocked(makeStore([op]), 'inst-001')).toBe(true);
  });

  it('returns true with active backupApp for matching instanceId', () => {
    const op = makeOp({
      kind: 'backupApp',
      args: { instanceId: 'inst-001', backupDiskId: 'disk-bkp' },
      status: 'Running',
    });
    expect(isInstanceLocked(makeStore([op]), 'inst-001')).toBe(true);
  });

  it('returns false for Done ops', () => {
    const op = makeOp({ status: 'Done' });
    expect(isInstanceLocked(makeStore([op]), 'inst-001')).toBe(false);
  });

  it('returns false for Failed ops', () => {
    const op = makeOp({ status: 'Failed' });
    expect(isInstanceLocked(makeStore([op]), 'inst-001')).toBe(false);
  });

  it('returns false for a different instanceId', () => {
    const op = makeOp({ status: 'Running' });
    expect(isInstanceLocked(makeStore([op]), 'inst-other')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isDiskLocked
// ---------------------------------------------------------------------------

describe('isDiskLocked', () => {
  it('returns false when store is null', () => {
    expect(isDiskLocked(null, 'disk-src')).toBe(false);
  });

  it('returns false when no active ops', () => {
    expect(isDiskLocked(makeStore([]), 'disk-src')).toBe(false);
  });

  it('returns true when sourceDiskId matches', () => {
    const op = makeOp({ status: 'Running' });
    expect(isDiskLocked(makeStore([op]), 'disk-src')).toBe(true);
  });

  it('returns true when targetDiskId matches', () => {
    const op = makeOp({ status: 'Running' });
    expect(isDiskLocked(makeStore([op]), 'disk-tgt')).toBe(true);
  });

  it('returns true when backupDiskId matches', () => {
    const op = makeOp({
      kind: 'backupApp',
      args: { instanceId: 'inst-001', backupDiskId: 'disk-bkp' },
      status: 'Running',
    });
    expect(isDiskLocked(makeStore([op]), 'disk-bkp')).toBe(true);
  });

  it('returns false for Done ops', () => {
    const op = makeOp({ status: 'Done' });
    expect(isDiskLocked(makeStore([op]), 'disk-src')).toBe(false);
  });

  it('returns false for an unrelated disk', () => {
    const op = makeOp({ status: 'Running' });
    expect(isDiskLocked(makeStore([op]), 'disk-other')).toBe(false);
  });
});
