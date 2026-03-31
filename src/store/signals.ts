import { createSignal } from 'solid-js';
import type { Accessor } from 'solid-js';
import type {
  Store,
  Engine,
  Disk,
  App,
  Instance,
  EngineID,
  DiskID,
  AppID,
} from '../types/store';

// ---------------------------------------------------------------------------
// Module-level reactive store — set by App.tsx via initStoreSignal
// ---------------------------------------------------------------------------
const [_store, _setStore] = createSignal<Store | null>(null);

/**
 * Called once at app startup by App.tsx to wire the connection's store into
 * the module-level signal that all derived accessors read from.
 */
export function initStoreSignal(storeAccessor: Accessor<Store | null>): void {
  // We deliberately avoid createEffect here to keep this file importable in
  // pure-JS test environments.  App.tsx calls initStoreSignal inside a
  // createEffect so the wiring is reactive.
  _setStore(storeAccessor());
}

/**
 * Directly set the store value (used by App.tsx inside a createEffect and
 * exposed for tests that need to inject a store without a live connection).
 */
export const setStoreSignal = _setStore;

// ---------------------------------------------------------------------------
// Reactive Accessors
// ---------------------------------------------------------------------------

/** All engines in the store. */
export const engines: Accessor<Engine[]> = () => {
  const s = _store();
  if (!s) return [];
  return Object.values(s.engineDB);
};

/** Engines as a raw record (for internal use). */
export const engineDB: Accessor<Record<EngineID, Engine>> = () => {
  const s = _store();
  if (!s) return {};
  return s.engineDB;
};

/** All disks docked to the given engine. */
export const disksForEngine = (engineId: EngineID): Disk[] => {
  const s = _store();
  if (!s) return [];
  return Object.values(s.diskDB).filter((d) => d.dockedTo === engineId);
};

/** All instances stored on the given disk. */
export const instancesForDisk = (diskId: DiskID): Instance[] => {
  const s = _store();
  if (!s) return [];
  return Object.values(s.instanceDB).filter((inst) => inst.storedOn === diskId);
};

/** The App that the instance was created from, looked up by instanceOf (AppID). */
export const appForInstance = (instanceOf: AppID): App | undefined => {
  const s = _store();
  if (!s) return undefined;
  return s.appDB[instanceOf];
};

/** All instances across the entire network. */
export const allInstances: Accessor<Instance[]> = () => {
  const s = _store();
  if (!s) return [];
  return Object.values(s.instanceDB);
};

// ---------------------------------------------------------------------------
// Pure helpers (no reactive dependency — safe to test without Solid context)
// ---------------------------------------------------------------------------

/**
 * Returns true when the engine has been seen within the last 2 minutes.
 * The Engine writes lastRun on each heartbeat tick.
 */
export const isEngineOnline = (engine: Engine): boolean => {
  const twoMinutesAgo = Date.now() - 2 * 60 * 1000;
  return engine.lastRun > twoMinutesAgo;
};

export interface EngineTreeNode {
  engine: Engine;
  disks: Disk[];
}

/**
 * Returns the full engine/disk tree for a given store snapshot.
 * Pure function — usable in unit tests without any Solid.js setup.
 */
export const getEngineTree = (store: Store): EngineTreeNode[] => {
  return Object.values(store.engineDB).map((engine) => ({
    engine,
    disks: Object.values(store.diskDB).filter((d) => d.dockedTo === engine.id),
  }));
};

/**
 * Returns all instances for a given store + engineId (pure, no reactive dep).
 */
export const getInstancesForEngine = (store: Store, engineId: EngineID): Instance[] => {
  const disks = Object.values(store.diskDB).filter((d) => d.dockedTo === engineId);
  const diskIds = new Set(disks.map((d) => d.id));
  return Object.values(store.instanceDB).filter((inst) => inst.storedOn != null && diskIds.has(inst.storedOn));
};

/**
 * Returns all instances for a given selection (network / engine / disk).
 * Pure function used by InstanceList.
 */
export const getInstancesForSelection = (
  store: Store,
  selection: { type: 'network' | 'engine' | 'disk'; id: string }
): Instance[] => {
  switch (selection.type) {
    case 'network':
      return Object.values(store.instanceDB);
    case 'engine':
      return getInstancesForEngine(store, selection.id);
    case 'disk':
      return Object.values(store.instanceDB).filter((inst) => inst.storedOn === selection.id);
  }
};
