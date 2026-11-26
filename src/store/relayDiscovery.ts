/**
 * Engine discovery on a page served by an Engine with the sign-in API
 * (agent-engine-dev#582): the page may only talk to its own origin, so it no
 * longer probes other hosts. The Engine list comes from the store, and an
 * Engine counts as reachable when the relay gets an answer from its
 * GET /api/engines/<id>/auth/info (an older Engine answers through the relay
 * with ENGINE_VERSION_MISMATCH, which still means reachable).
 */
import type { Store } from '../types/store';
import { EngineApiError, type EngineApiTransport } from './engineApi';
import { fetchAuthInfo } from './engineAuth';
import { enginesFromStore, type DiscoveryResult } from './discovery';

/** True when `engineId` answered through the relay (or is the page's Engine and answered). */
export async function relayReachable(t: EngineApiTransport, engineId: string): Promise<boolean> {
  try {
    await fetchAuthInfo(t, engineId);
    return true;
  } catch (err) {
    return err instanceof EngineApiError && err.code === 'ENGINE_VERSION_MISMATCH';
  }
}

/** The store's Engines that answer through the relay, as connectable entries. */
export async function relayDiscovery(
  t: EngineApiTransport | null,
  store: Store | null,
  storeUrl: string,
): Promise<DiscoveryResult[]> {
  if (!t) return [];
  const all = enginesFromStore(store, storeUrl);
  const ok = await Promise.all(all.map((r) => (r.engineId ? relayReachable(t, r.engineId) : Promise.resolve(false))));
  return all.filter((_, i) => ok[i]);
}
