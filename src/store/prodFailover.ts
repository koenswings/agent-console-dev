/**
 * prodFailover.ts — the serving Engine went away (idea#203).
 *
 * Served from an Engine (production web), the Console connects only to its
 * page host and the 15 s failover in App.tsx is off. When that Engine is
 * switched off mid-session the Console would say "Connecting…" forever, and a
 * reload fails because the page host is gone.
 *
 * After PROD_FAILOVER_MS without a connection (having been connected once):
 *   1. probe the page host again: it answers (Engine restarted, or the
 *      idea.local name moved to another holder) → reconnect in place;
 *   2. otherwise probe the other Engines from the last-known network database
 *      (name.local and published LAN address) and open the first that answers
 *      at its own Console URL, so the app links, command log and a later
 *      reload all follow the live Engine;
 *   3. nobody answers → stay, retry every PROD_FAILOVER_RETRY_MS.
 */
import { enginesFromStore, probeHost, type DiscoveryResult } from './discovery';
import { normHost } from './connectedEngine';
import { formatHostPort } from './storage';

export const PROD_FAILOVER_MS = 30_000;
export const PROD_FAILOVER_RETRY_MS = 30_000;

type StoreLike = Parameters<typeof enginesFromStore>[0];

/** Other Engines to try, in store order, without the page host's own Engine. */
export function failoverCandidates(store: StoreLike, pageHostname: string, port: number): DiscoveryResult[] {
  const page = normHost(pageHostname);
  const byName = enginesFromStore(store, '', port, false);
  const byLan = enginesFromStore(store, '', port, true);
  const names = new Map<string, string>(); // engineId -> normalised hostname
  for (const [k, e] of Object.entries(store?.engineDB ?? {})) if (e?.hostname) names.set(String(e.id ?? k), normHost(e.hostname));
  const lans = new Map<string, string>();
  for (const [k, e] of Object.entries(store?.engineDB ?? {})) if (e?.lanAddress) lans.set(String(e.id ?? k), String(e.lanAddress).trim());
  const out: DiscoveryResult[] = [];
  const seen = new Set<string>();
  for (const r of [...byName, ...byLan]) {
    const id = r.engineId ?? '';
    if (names.get(id) === page || (lans.get(id) && lans.get(id) === pageHostname)) continue;
    const key = `${r.hostname}:${r.port ?? 80}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export const consoleUrl = (r: Pick<DiscoveryResult, 'hostname' | 'port'>): string =>
  `http://${formatHostPort(r.hostname, r.port ?? 80)}/`;

export type FailoverStep =
  | { kind: 'reconnect' }
  | { kind: 'navigate'; url: string; engine: DiscoveryResult }
  | { kind: 'none' };

/** Decide what to do; probes in parallel, picks the first candidate (in order) that answered. */
export async function decideFailover(
  store: StoreLike,
  pageHostname: string,
  port: number,
  probe: (host: string, port: number) => Promise<DiscoveryResult | null> = probeHost,
): Promise<FailoverStep> {
  if (await probe(pageHostname, port)) return { kind: 'reconnect' };
  const cands = failoverCandidates(store, pageHostname, port);
  const results = await Promise.all(cands.map((c) => probe(c.hostname, c.port ?? 80)));
  const i = results.findIndex((r) => r !== null);
  if (i < 0) return { kind: 'none' };
  return { kind: 'navigate', url: consoleUrl(cands[i]), engine: cands[i] };
}
