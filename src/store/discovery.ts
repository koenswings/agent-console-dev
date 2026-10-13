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

import { formatHostPort, parsePort } from './storage';

export interface DiscoveryResult {
  hostname: string;
  storeUrl: string;
  /** HTTP port the Engine answered on, when it is not 80. Absent = port 80. */
  port?: number;
  /** Engine id, when /api/store-url reports one (newer Engines). */
  engineId?: string;
}

/**
 * Default HTTP port for Engine probes: the port this Console page was served
 * from (Engines serve the Console and /api/store-url on the same port, e.g.
 * :8080 on the Pi pool), falling back to 80 when the page has no explicit
 * port (port 80/443, extension pages, tests without a location).
 */
export function enginePortFromLocation(
  loc: Pick<Location, 'protocol' | 'port'> | null | undefined,
): number {
  if (!loc) return 80;
  if (loc.protocol !== 'http:' && loc.protocol !== 'https:') return 80;
  return parsePort(loc.port) ?? 80;
}

export function defaultEnginePort(): number {
  try {
    return enginePortFromLocation(typeof window === 'undefined' ? null : window.location);
  } catch {
    return 80;
  }
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

export async function probeHost(
  hostname: string,
  port: number = defaultEnginePort(),
): Promise<DiscoveryResult | null> {
  try {
    const res = await fetch(`http://${formatHostPort(hostname, port)}/api/store-url`, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const storeUrl = json?.url as string | undefined;
    if (!storeUrl || !storeUrl.startsWith('automerge:')) return null;
    const engineId = typeof json?.engineId === 'string' && json.engineId ? json.engineId : undefined;
    return {
      hostname,
      storeUrl,
      ...(port !== 80 ? { port } : {}),
      ...(engineId ? { engineId } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Identity of the Engine behind a result. The store URL is NOT an identity:
 * every Engine in a fleet serves the same fleet store URL. Use the Engine id
 * when the Engine reports one; otherwise the hostname without `.local`
 * (lower-cased), since discovery probes `name` and `name.local`, which are
 * the same machine. This is also the key of the `connect-engine-<name>` id.
 */
export function engineKey(r: DiscoveryResult): string {
  if (r.engineId) return `id:${r.engineId}`;
  return `host:${r.hostname.trim().replace(/\.local\.?$/i, '').toLowerCase()}`;
}

/**
 * Collapse results that are the same Engine (e.g. `idea01` and
 * `idea01.local`). Keeps the first per Engine; candidate order puts the bare
 * name before `.local`, so the picker shows one row per Engine.
 */
export function dedupeEngines(results: DiscoveryResult[]): DiscoveryResult[] {
  const seen = new Set<string>();
  const out: DiscoveryResult[] = [];
  for (const r of results) {
    const key = engineKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Probe all candidate hostnames in parallel. Returns ALL successful results
 * in candidate order, one per Engine (deduped by engine id / bare hostname). Caller decides: 0 = form, 1 = auto-connect, 2+ = picker.
 */
export async function discoverAllEngines(): Promise<DiscoveryResult[]> {
  const candidates = buildCandidates();
  const port = defaultEnginePort();
  const results = await Promise.all(candidates.map((c) => probeHost(c, port)));
  return dedupeEngines(results.filter((r): r is DiscoveryResult => r !== null));
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
  const h = input.trim();
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
  port: number = defaultEnginePort(),
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
  const results = await Promise.all(unique.map((c) => probeHost(c, port)));
  return dedupeEngines(results.filter((r): r is DiscoveryResult => r !== null));
}
