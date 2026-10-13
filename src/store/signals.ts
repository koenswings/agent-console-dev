/**
 * Pure helper functions for deriving data from the Store.
 *
 * No reactive globals — all functions are pure and take a Store snapshot.
 * Components receive the store as a prop (Accessor<Store|null>) and call
 * these helpers inside their own reactive closures.
 */
import type {
  Store,
  Engine,
  Disk,
  EngineID,
} from '../types/store';
import { isOnline, live, type LiveState } from './live';

// ---------------------------------------------------------------------------
// Pure helpers — safe to call in any context, including unit tests
// ---------------------------------------------------------------------------

/**
 * Online badge. Engines with live heartbeats (ephemeral 'idea/hb' every 10 s):
 * online while one arrived within 30 s (Console clock). Old Engines: the stored
 * lastRun within 90 s. See live.ts. Pass `now` so the comparison is reactive.
 */
export const isEngineOnline = (engine: Engine, now: number = Date.now(), liveState: LiveState = live()): boolean =>
  isOnline(engine, liveState, now);

export interface EngineTreeNode {
  engine: Engine;
  disks: Disk[];
}

/**
 * Returns the full engine/disk tree for a given store snapshot.
 * Pure function — usable in unit tests without any Solid.js setup.
 */
export const getEngineTree = (store: Store): EngineTreeNode[] => {
  return Object.values(store.engineDB ?? {}).map((engine) => ({
    engine,
    disks: Object.values(store.diskDB ?? {}).filter((d) => String(d.dockedTo) === engine.id),
  }));
};

/**
 * Returns all instances for a given store + engineId (pure, no reactive dep).
 */
export const getInstancesForEngine = (store: Store, engineId: EngineID): import('../types/store').Instance[] => {
  const disks = Object.values(store.diskDB ?? {}).filter((d) => String(d.dockedTo) === engineId);
  const diskIds = new Set(disks.map((d) => String(d.id)));
  return Object.values(store.instanceDB ?? {}).filter((inst) => inst.storedOn != null && diskIds.has(String(inst.storedOn)));
};

/**
 * Returns all instances for a given selection (network / engine / disk).
 * Pure function used by InstanceList.
 */
export const getInstancesForSelection = (
  store: Store,
  selection: { type: 'network' | 'engine' | 'disk' | 'unformatted'; id: string; engineId?: string }
): import('../types/store').Instance[] => {
  switch (selection.type) {
    case 'network':
      return Object.values(store.instanceDB ?? {});
    case 'engine':
      return getInstancesForEngine(store, selection.id);
    case 'disk':
      return Object.values(store.instanceDB ?? {}).filter((inst) => String(inst.storedOn) === selection.id);
    case 'unformatted':
      return [];
  }
};

/**
 * Same as getInstancesForSelection but returns instance IDs instead of objects.
 * Use this for ID-keyed <For> loops — Solid reuses scopes for unchanged IDs
 * and only re-renders rows whose data actually changed.
 */
export const getInstanceIdsForSelection = (
  store: Store,
  selection: { type: 'network' | 'engine' | 'disk' | 'unformatted'; id: string; engineId?: string }
): string[] => {
  return getInstancesForSelection(store, selection).map((inst) => inst.id);
};
