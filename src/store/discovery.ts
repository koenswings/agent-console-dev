/**
 * discovery.ts — Engine auto-discovery
 *
 * Probes a list of candidate hostnames in parallel. The first to respond to
 * GET /api/store-url wins. Returns the hostname and store URL so the caller
 * can connect without any manual configuration.
 *
 * Used on first load when no hostname is stored. Non-blocking: the caller
 * shows the onboarding form immediately and auto-connects when discovery
 * resolves.
 */

export interface DiscoveryResult {
  hostname: string;
  storeUrl: string;
}

// ---------------------------------------------------------------------------
// Candidate list
// ---------------------------------------------------------------------------

const PREFIXES = ['appdocker', 'idea', 'engine'];
const NUMBERS = ['01', '02', '03'];

/** All hostnames to probe: bare names + .local variants. */
function buildCandidates(): string[] {
  const candidates: string[] = [];
  for (const prefix of PREFIXES) {
    for (const n of NUMBERS) {
      const name = `${prefix}${n}`;
      candidates.push(name);
      candidates.push(`${name}.local`);
    }
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Core probe
// ---------------------------------------------------------------------------

async function probeHost(hostname: string): Promise<DiscoveryResult | null> {
  try {
    const res = await fetch(`http://${hostname}/api/store-url`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const storeUrl = json?.url as string | undefined;
    if (!storeUrl || !storeUrl.startsWith('automerge:')) return null;
    return { hostname, storeUrl };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Probe all candidate hostnames in parallel. Returns ALL successful results
 * in candidate order. Caller decides: 0 = form, 1 = auto-connect, 2+ = picker.
 */
export async function discoverAllEngines(): Promise<DiscoveryResult[]> {
  const candidates = buildCandidates();
  const results = await Promise.all(candidates.map(probeHost));
  return results.filter((r): r is DiscoveryResult => r !== null);
}

/**
 * Convenience: probe and return the single best result, or null.
 * Only use when you're certain at most one engine will respond.
 */
export async function discoverEngine(): Promise<DiscoveryResult | null> {
  const results = await discoverAllEngines();
  return results[0] ?? null;
}

/**
 * Returns the candidate list — useful for displaying "scanning…" UI feedback
 * or for tests.
 */
export function getDiscoveryCandidates(): string[] {
  return buildCandidates();
}
