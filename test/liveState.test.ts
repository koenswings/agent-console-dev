/**
 * live.ts: ephemeral hb/metrics state (store-design, Koen decision 2026-10-13).
 * Online 30 s on the Console clock, metrics stale after 45 s, fallback to the
 * stored lastRun (90 s) and instance.metrics for old Engines.
 */
import { describe, it, expect } from 'vitest';
import {
  applyEphemeral, emptyLive, isOnline, metricsFor, engineClockOf,
  LIVE_OFFLINE_MS, LIVE_METRICS_STALE_MS,
} from '../src/store/live';
import { isEngineOnline } from '../src/store/signals';
import { snapshotAtSend } from '../src/store/remoteConfirm';

const M = (cpu: number) => ({ cpuPercent: cpu, memUsageBytes: 1, memLimitBytes: 2, memPercent: 50, netRxBytes: 0, netTxBytes: 0, blockReadBytes: 0, blockWriteBytes: 0, sampledAt: 5 });
const T = 1_000_000;

describe('live state (ephemeral hb + metrics)', () => {
  it('hb makes an Engine online for 30 s on the Console clock, whatever its own clock says', () => {
    const s = applyEphemeral(emptyLive(), { type: 'idea/hb', v: 1, engineId: 'E1', now: 42, bootedAt: 1 }, T);
    expect(isOnline({ id: 'E1' as any, lastRun: 0 as any }, s, T + LIVE_OFFLINE_MS)).toBe(true);
    expect(isOnline({ id: 'E1' as any, lastRun: 0 as any }, s, T + LIVE_OFFLINE_MS + 1)).toBe(false);
  });

  it('an Engine that sends hb is judged by hb only, even when its stored lastRun is fresh', () => {
    const s = applyEphemeral(emptyLive(), { type: 'idea/hb', engineId: 'E1', now: T }, T);
    expect(isOnline({ id: 'E1' as any, lastRun: (T + 100_000) as any }, s, T + 60_000)).toBe(false);
  });

  it('old Engine (never sent hb): stored lastRun within 90 s', () => {
    const e = { id: 'OLD' as any, lastRun: (T - 80_000) as any };
    expect(isOnline(e, emptyLive(), T)).toBe(true);
    expect(isOnline(e, emptyLive(), T + 20_000)).toBe(false);
    expect(isEngineOnline({ ...e } as any, T, emptyLive())).toBe(true);
  });

  it('malformed or unknown messages are ignored', () => {
    const s0 = emptyLive();
    for (const m of [null, 1, 'x', {}, { type: 'idea/hb' }, { type: 'other', engineId: 'E' }, { type: 'idea/metrics', engineId: 'E' }])
      expect(applyEphemeral(s0, m, T)).toBe(s0);
  });

  it('metrics: newest live sample of any Engine; stale after 45 s; also counts as a beat', () => {
    let s = applyEphemeral(emptyLive(), { type: 'idea/metrics', engineId: 'E1', sampledAt: 7, instances: { i1: M(10) } }, T);
    s = applyEphemeral(s, { type: 'idea/metrics', engineId: 'E2', sampledAt: 7, instances: { i1: M(20) } }, T + 1000);
    const inst = { id: 'i1' as any, status: 'Running' as any, metrics: M(99) as any };
    expect(metricsFor(inst, s, T + 1000)).toEqual({ metrics: M(20), stale: false, receivedAt: T + 1000 });
    expect(metricsFor(inst, s, T + 1000 + LIVE_METRICS_STALE_MS + 1).stale).toBe(true);
    expect(isOnline({ id: 'E1' as any, lastRun: 0 as any }, s, T + 10)).toBe(true);
  });

  it('metrics fallback: stored instance.metrics for old Engines; none when not Running', () => {
    expect(metricsFor({ id: 'i9' as any, status: 'Running' as any, metrics: M(3) as any }, emptyLive(), T)).toEqual({ metrics: M(3), stale: false, receivedAt: null });
    const s = applyEphemeral(emptyLive(), { type: 'idea/metrics', engineId: 'E1', instances: { i1: M(1) } }, T);
    expect(metricsFor({ id: 'i1' as any, status: 'Stopped' as any, metrics: null }, s, T).metrics).toBeNull();
    expect(metricsFor(null, s, T).metrics).toBeNull();
  });

  it('engine clock: hb now + elapsed Console time; else stored lastRun; else null', () => {
    const s = applyEphemeral(emptyLive(), { type: 'idea/hb', engineId: 'E1', now: 500 }, T);
    expect(engineClockOf('E1', s, 1, T + 2000)).toBe(2500);
    expect(engineClockOf('E2', s, 77, T)).toBe(77);
    expect(engineClockOf('E2', s, 0, T)).toBeNull();
    expect(engineClockOf(null, s, undefined, T)).toBeNull();
  });

  it('snapshotAtSend falls back to the stored lastRun when no hb was received', () => {
    const store = () => ({ engineDB: { E9: { lastRun: 1234 } }, operationDB: {}, instanceDB: {} } as any);
    expect(snapshotAtSend(store, 'E9').engineClock).toBe(1234);
  });
});
