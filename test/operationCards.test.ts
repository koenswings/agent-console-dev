/**
 * walk98 (cover-all-c1cc4bb step 98): the backup_instance Intent judged the stale Failed scheduled-backup
 * card hj8ch6cexyfoev7mvla (16 Nov) instead of the op the click created (0xo3wv7fs9o7lh2o7vx, Done).
 */
import { describe, expect, it } from 'vitest';
import {
  snapshotOpIds,
  waitForNewOp,
  type OpCardView,
  type WaitNewOpDeps,
} from '../e2e/intents/operationCards';
import { throwUnlessNewBackupOpOk } from '../e2e/intents/operatorDeepActions';

const STALE: OpCardView = {
  id: 'hj8ch6cexyfoev7mvla',
  status: 'Failed',
  error: 'INTERRUPTED: scheduled backup was interrupted by an Engine restart',
};
const NEW_ID = '0xo3wv7fs9o7lh2o7vx';

/** Fake clock + a card list that changes with time: steps are [atMs, cards]. */
function world(steps: Array<[number, OpCardView[]]>, refusalAt?: [number, string]) {
  let t = 0;
  const cardsAt = () => {
    let cur: OpCardView[] = [];
    for (const [at, cards] of steps) if (t >= at) cur = cards;
    return cur;
  };
  const deps: WaitNewOpDeps = {
    read: async () => cardsAt(),
    readRefusal: async () => (refusalAt && t >= refusalAt[0] ? refusalAt[1] : ''),
    now: () => t,
    sleep: async (ms) => { t += ms; },
  };
  return { deps, at: () => t, setNow: (ms: number) => { t = ms; } };
}

describe('waitForNewOp (walk98)', () => {
  it('stale Failed card on screen before the click + new op Done => pass on the new op', async () => {
    const w = world([[0, [STALE]], [2_000, [STALE, { id: NEW_ID, status: 'Done', error: '' }]]]);
    const baseline = await snapshotOpIds(w.deps.read);
    expect([...baseline]).toEqual([STALE.id]);
    const out = await waitForNewOp(baseline, 30_000, w.deps);
    expect(out).toMatchObject({ kind: 'seen', op: { id: NEW_ID, status: 'Done' } });
    expect(() => throwUnlessNewBackupOpOk(out, 'kolibri-grade5a-001', 30_000)).not.toThrow();
  });

  it('stale Failed card first in the DOM and new op Running => still the new op (no first() bias)', async () => {
    const w = world([[0, [STALE]], [500, [STALE, { id: NEW_ID, status: 'Running', error: '' }]]]);
    const out = await waitForNewOp(await snapshotOpIds(w.deps.read), 30_000, w.deps);
    expect(out).toMatchObject({ kind: 'seen', op: { id: NEW_ID } });
  });

  it('new op Failed => fail, naming the new op and its error, not the stale one', async () => {
    const w = world([[0, [STALE]], [1_000, [STALE, { id: NEW_ID, status: 'Failed', error: 'disk full' }]]]);
    const out = await waitForNewOp(await snapshotOpIds(w.deps.read), 30_000, w.deps);
    expect(out).toMatchObject({ kind: 'failed', op: { id: NEW_ID } });
    expect(() => throwUnlessNewBackupOpOk(out, 'kolibri-grade5a-001', 30_000)).toThrow(
      /Operation 0xo3wv7fs9o7lh2o7vx Failed for kolibri-grade5a-001: disk full/,
    );
  });

  it('no new op => timeout fail, and the stale Failed card is not blamed', async () => {
    const w = world([[0, [STALE]]]);
    const out = await waitForNewOp(await snapshotOpIds(w.deps.read), 5_000, w.deps);
    expect(out.kind).toBe('timeout');
    expect(w.at()).toBeGreaterThanOrEqual(5_000);
    let msg = '';
    try { throwUnlessNewBackupOpOk(out, 'kolibri-grade5a-001', 5_000); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/no NEW backupApp Operation for kolibri-grade5a-001 within 5000ms/);
    expect(msg).toMatch(/Ignored 1 older card\(s\).*hj8ch6cexyfoev7mvla=Failed/);
    expect(msg).not.toMatch(/INTERRUPTED/);
  });

  it('empty baseline and no cards => timeout', async () => {
    const w = world([]);
    const out = await waitForNewOp(new Set(), 1_000, w.deps);
    expect(out).toEqual({ kind: 'timeout', ignoredStale: [] });
    expect(() => throwUnlessNewBackupOpOk(out, 'x', 1_000)).toThrow(/no NEW backupApp Operation for x/);
  });

  it('CommandFeedback refusal => fail loud even with a stale card present', async () => {
    const w = world([[0, [STALE]]], [200, 'Backup refused']);
    const out = await waitForNewOp(await snapshotOpIds(w.deps.read), 30_000, w.deps);
    expect(out).toEqual({ kind: 'refused', message: 'Backup refused' });
    expect(() => throwUnlessNewBackupOpOk(out, 'i1', 30_000)).toThrow(/Engine refused \/ failed backup for i1 \(CommandFeedback: Backup refused\)/);
  });

  it('a stale card whose status changes (Failed -> Running again) is still not "new"', async () => {
    const w = world([[0, [STALE]], [1_000, [{ ...STALE, status: 'Running', error: '' }]]]);
    const out = await waitForNewOp(await snapshotOpIds(w.deps.read), 3_000, w.deps);
    expect(out.kind).toBe('timeout');
  });
});
