/**
 * live.ts: liveness and container metrics that are NOT stored in the store doc
 * (store-design PROPOSAL, Koen decision 2026-10-13).
 *
 * Engines broadcast two automerge-repo ephemeral messages on the store doc handle;
 * the Engines relay them to every peer of the doc, so a Console connected to ANY
 * Engine receives them from EVERY Engine:
 *   { type: 'idea/hb', v: 1, engineId, now, bootedAt }                every 10 s
 *   { type: 'idea/metrics', v: 1, engineId, sampledAt, instances }    every 15 s
 *       instances: { [instanceId]: DockerMetrics } (Running instances only)
 *
 * All times we compare are on the CONSOLE clock (receivedAt), never the Pi's:
 * school Pis may have no RTC. Engine `now` is kept only as that Engine's clock
 * estimate for remoteConfirm's same-Engine skew check.
 *
 * Old Engines (before this change) send nothing: callers fall back to the stored
 * engine.lastRun (90 s rule) and instance.metrics.
 */
import { createSignal } from 'solid-js';
import type { DockerMetrics, Engine, Instance } from '../types/store';
import { receiveUpdateProgress } from './updateApp';

/** No hb for this long: the Engine is offline (3 x 10 s). */
export const LIVE_OFFLINE_MS = 30_000;
/** Metrics older than this are shown greyed as stale (3 x 15 s). */
export const LIVE_METRICS_STALE_MS = 45_000;
/** Stored lastRun rule for old Engines (heartbeat every 30 s, 3x tolerance). */
export const LEGACY_ONLINE_MS = 90_000;

export interface LiveBeat { receivedAt: number; engineNow: number | null; bootedAt: number | null }
export interface LiveMetrics { receivedAt: number; sampledAt: number | null; instances: Record<string, DockerMetrics> }
export interface LiveState { beats: Record<string, LiveBeat>; metrics: Record<string, LiveMetrics> }

export const emptyLive = (): LiveState => ({ beats: {}, metrics: {} });

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Pure: the state after an ephemeral message received at `receivedAt`
 * (Console clock). Unknown or malformed messages return `state` unchanged.
 */
export const applyEphemeral = (state: LiveState, message: unknown, receivedAt: number): LiveState => {
  const m = message as Record<string, unknown> | null;
  if (!m || typeof m !== 'object' || typeof m.engineId !== 'string' || !m.engineId) return state;
  const engineId = m.engineId;
  if (m.type === 'idea/hb') {
    return { ...state, beats: { ...state.beats, [engineId]: { receivedAt, engineNow: num(m.now), bootedAt: num(m.bootedAt) } } };
  }
  if (m.type === 'idea/metrics' && m.instances && typeof m.instances === 'object') {
    const live: LiveMetrics = { receivedAt, sampledAt: num(m.sampledAt), instances: m.instances as Record<string, DockerMetrics> };
    // a metrics message also proves the Engine is alive
    const beat = state.beats[engineId];
    return {
      beats: { ...state.beats, [engineId]: { receivedAt, engineNow: beat?.engineNow ?? null, bootedAt: beat?.bootedAt ?? null } },
      metrics: { ...state.metrics, [engineId]: live },
    };
  }
  return state;
};

/**
 * Online: live hb within LIVE_OFFLINE_MS when this Engine has ever sent one;
 * otherwise (old Engine) the stored lastRun within LEGACY_ONLINE_MS.
 */
export const isOnline = (engine: Pick<Engine, 'id' | 'lastRun'>, live: LiveState, now: number): boolean => {
  const beat = live.beats[String(engine.id)];
  if (beat) return now - beat.receivedAt <= LIVE_OFFLINE_MS;
  return Number(engine.lastRun) > now - LEGACY_ONLINE_MS;
};

export interface MetricsView { metrics: DockerMetrics | null; stale: boolean; receivedAt: number | null }

/**
 * Metrics of an instance: the newest live sample from any Engine (stale after
 * LIVE_METRICS_STALE_MS); else the stored instance.metrics (old Engines).
 */
export const metricsFor = (inst: Pick<Instance, 'id' | 'status' | 'metrics'> | null | undefined, live: LiveState, now: number): MetricsView => {
  if (!inst) return { metrics: null, stale: false, receivedAt: null };
  let best: { m: DockerMetrics; at: number } | null = null;
  for (const lm of Object.values(live.metrics)) {
    const m = lm.instances?.[String(inst.id)];
    if (m && (!best || lm.receivedAt > best.at)) best = { m, at: lm.receivedAt };
  }
  if (best && inst.status === 'Running') return { metrics: best.m, stale: now - best.at > LIVE_METRICS_STALE_MS, receivedAt: best.at };
  if (inst.status !== 'Running') return { metrics: null, stale: false, receivedAt: null };
  return { metrics: inst.metrics ?? null, stale: false, receivedAt: null };
};

/**
 * That Engine's clock now, estimated from its last hb (its `now` plus the time
 * since we received it, Console clock); else its stored lastRun; else null.
 */
export const engineClockOf = (engineId: string | null | undefined, live: LiveState, storedLastRun: unknown, now: number): number | null => {
  if (engineId) {
    const beat = live.beats[engineId];
    if (beat?.engineNow != null) return beat.engineNow + Math.max(0, now - beat.receivedAt);
  }
  const lr = Number(storedLastRun);
  return Number.isFinite(lr) && lr > 0 ? lr : null;
};

// ── the app-wide reactive state (one Engine connection at a time) ───────────
const [live, setLive] = createSignal<LiveState>(emptyLive());
const [liveNow, setLiveNow] = createSignal(Date.now());
if (typeof setInterval === 'function') setInterval(() => setLiveNow(Date.now()), 5_000);

export { live, liveNow };
/** Feed one received ephemeral message (engine.ts). */
export const receiveEphemeral = (message: unknown, receivedAt: number = Date.now()): void => {
  setLive((s) => applyEphemeral(s, message, receivedAt));
  receiveUpdateProgress(message, receivedAt);
};
/** Forget everything (new connection / dispose). */
export const resetLive = (): void => { setLive(emptyLive()); };
