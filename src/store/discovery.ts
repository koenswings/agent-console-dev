/**
 * discovery.ts — Engine auto-discovery
 *
 * Probes a list of candidate hostnames in parallel. Each candidate is probed
 * against GET /api/store-url. Returns all successful results so the caller
 * can auto-connect (1 result) or show a picker (2+ results).
 *
 * Used on first load when no hostname is stored. Non-blocking: the caller
 * shows the onboarding form immediately and auto-connects when discovery
 * resolves.
 */

export interface DiscoveryResult {
  hostname: string;
  storeUrl: string;
  /** Only set when the user specified a non-default port (e.g. host:8080). */
  port?: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Hostname prefixes to probe. Add new fleet naming schemes here. */
export const DISCOVERY_PREFIXES = ['appdocker', 'idea', 'engine'];

/** Probe hostnames from 01 up to and including this number. */
export const DISCOVERY_MAX_NUMBER = 10;

/** Per-host probe timeout in milliseconds. */
export const DISCOVERY_TIMEOUT_MS = 5000;

/** How often (ms) to re-probe while the picker is visible. */
export const DISCOVERY_REFRESH_INTERVAL_MS = 10_000;

// ---------------------------------------------------------------------------
// Candidate list
// ---------------------------------------------------------------------------

/** All hostnames to probe: bare names + .local variants. */
export function buildCandidates(
  prefixes = DISCOVERY_PREFIXES,
  maxNumber = DISCOVERY_MAX_NUMBER,
): string[] {
  const candidates: string[] = [];
  for (const prefix of prefixes) {
    for (let n = 1; n <= maxNumber; n++) {
      const name = `${prefix}${String(n).padStart(2, '0')}`;
      candidates.push(name);
      candidates.push(`${name}.local`);
    }
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Core probe
// ---------------------------------------------------------------------------

async function probeHost(hostname: string, port = 80): Promise<DiscoveryResult | null> {
  try {
    const res = await fetch(`http://${hostname}:${port}/api/store-url`, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const storeUrl = json?.url as string | undefined;
    if (!storeUrl || !storeUrl.startsWith('automerge:')) return null;
    return { hostname, storeUrl, ...(port !== 80 ? { port } : {}) };
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

// ---------------------------------------------------------------------------
// Manual hostname helpers
// ---------------------------------------------------------------------------

export interface HostnameBase {
  /** The bare prefix, e.g. "idea" from "idea01" or "idea01.local" */
  prefix: string;
  /** Whether the original input had a .local suffix */
  hasDotLocal: boolean;
}

/**
 * Extract the base prefix from a manually entered hostname.
 * Returns null for IP addresses or hostnames with no trailing number.
 *
 * Examples:
 *   "idea01"       → { prefix: "idea", hasDotLocal: false }
 *   "idea01.local" → { prefix: "idea", hasDotLocal: true }
 *   "appdocker03"  → { prefix: "appdocker", hasDotLocal: false }
 *   "100.115.60.6" → null  (IP address)
 *   "appdocker"    → null  (no number to strip)
 */
export function extractHostnameBase(input: string): HostnameBase | null {
  const h = input.trim().replace(/:\d+$/, ''); // strip :port before processing
  // IP address — don't try to scan a fleet
  if (/^[\d.]+$/.test(h)) return null;
  const hasDotLocal = /\.local$/i.test(h);
  const bare = h.replace(/\.local$/i, '');
  // Must end with one or more digits
  const match = bare.match(/^(.*?)(\d+)$/);
  if (!match || !match[1]) return null;
  return { prefix: match[1], hasDotLocal };
}

/**
 * Probe all candidate hostnames for a given prefix.
 * Used after manual hostname entry to find sibling engines.
 */
export async function discoverEnginesByPrefix(
  prefix: string,
  hasDotLocal: boolean,
  maxNumber = DISCOVERY_MAX_NUMBER,
): Promise<DiscoveryResult[]> {
  const candidates: string[] = [];
  for (let n = 1; n <= maxNumber; n++) {
    const bare = `${prefix}${String(n).padStart(2, '0')}`;
    // Probe both bare and .local regardless of input — cover both cases
    candidates.push(bare);
    candidates.push(`${bare}.local`);
  }
  // Deduplicate in case hasDotLocal already covered one form
  const unique = [...new Set(candidates)];
  const results = await Promise.all(unique.map(probeHost));
  return results.filter((r): r is DiscoveryResult => r !== null);
}
