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

/** Per-host probe timeout in milliseconds. */
export const DISCOVERY_TIMEOUT_MS = 5000;

/** How often (ms) to re-probe while the picker is visible. */
export const DISCOVERY_REFRESH_INTERVAL_MS = 10_000;

// ---------------------------------------------------------------------------
// Bootstrap candidates (idea#184)
// ---------------------------------------------------------------------------
//
// Pis have free, unique sticker names (e.g. `brave-otter`); there is no
// number scheme to guess and no shared alias. A browser cannot browse mDNS,
// so the Console bootstraps from ONE known host:
//   1. the host this page was served from (the operator typed the sticker
//      name, `http://<name>.local:<port>`), and
//   2. Engines the operator connected to before (history),
// and then lists every Engine from the network database (engineDB), see
// enginesFromStore().

const isLoopback = (h: string) => h === '' || h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';

/**
 * Hosts to probe on first load: the page host (when the page was served by
 * a real host, not loopback or an extension) and previously used Engines.
 * A name is probed as given and with `.local` added; IPs as given.
 * Never generates names.
 */
export function bootstrapCandidates(
  loc: Pick<Location, 'protocol' | 'hostname'> | null | undefined,
  history: string[] = [],
): string[] {
  const seeds: string[] = [];
  if (loc && (loc.protocol === 'http:' || loc.protocol === 'https:') && !isLoopback(loc.hostname)) {
    seeds.push(loc.hostname);
  }
  seeds.push(...history);
  const out: string[] = [];
  for (const raw of seeds) {
    const h = raw.trim();
    if (!h) continue;
    if (/^[\d.]+$/.test(h) || h.includes(':')) { out.push(h); continue; }
    const bare = h.replace(/\.local\.?$/i, '');
    if (bare.includes('.')) { out.push(h); continue; } // FQDN (e.g. MagicDNS): as given
    out.push(bare, `${bare}.local`);
  }
  return [...new Set(out)];
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
 * Probe the bootstrap candidates (page host + history) in parallel. Returns
 * the Engines that answered, one per Engine. The full Engine list comes from
 * the network database once connected (enginesFromStore). Caller decides:
 * 0 = form, 1 = auto-connect, 2+ = picker.
 */
export async function discoverAllEngines(history?: string[]): Promise<DiscoveryResult[]> {
  let hist = history;
  if (!hist) {
    try {
      const { readEngineHistory } = await import('./storage');
      hist = await readEngineHistory();
    } catch {
      hist = [];
    }
  }
  const loc = typeof window === 'undefined' ? null : window.location;
  const candidates = bootstrapCandidates(loc, hist);
  const port = defaultEnginePort();
  const results = await Promise.all(candidates.map((c) => probeHost(c, port)));
  return dedupeEngines(results.filter((r): r is DiscoveryResult => r !== null));
}

/**
 * Convenience: probe and return the single best result, or null.
 */
export async function discoverEngine(): Promise<DiscoveryResult | null> {
  const results = await discoverAllEngines();
  return results[0] ?? null;
}

// ---------------------------------------------------------------------------
// Engine list from the network database (idea#184)
// ---------------------------------------------------------------------------

interface StoreEngineLike {
  id?: string;
  hostname?: string;
  lanAddress?: string | null;
}

/** True when this page was opened by an IPv4 address. */
export function pageHostIsIp(): boolean {
  try {
    return typeof window !== 'undefined' && /^\d+\.\d+\.\d+\.\d+$/.test(window.location.hostname);
  } catch {
    return false;
  }
}

/**
 * Every Engine in the network database as a connectable entry:
 * `<hostname>.local` on the given port, keyed by Engine id, sorted by name.
 * Engines without a hostname are skipped. No name pattern is assumed.
 */
export function enginesFromStore(
  store: { engineDB?: Record<string, StoreEngineLike> } | null | undefined,
  storeUrl: string,
  port: number = defaultEnginePort(),
  preferLanAddress: boolean = pageHostIsIp(),
): DiscoveryResult[] {
  const out: DiscoveryResult[] = [];
  for (const [key, e] of Object.entries(store?.engineDB ?? {})) {
    const name = e?.hostname?.trim();
    if (!name) continue;
    // mDNS (.local) does not cross subnets: when the Console itself was opened
    // by IP (e.g. a classroom PC on a Wi-Fi subnet), use the Engine's
    // published LAN address when it has one.
    const lan = e.lanAddress?.trim();
    const host = preferLanAddress && lan ? lan
      : /\.local\.?$/i.test(name) || name.includes('.') ? name : `${name}.local`;
    out.push({
      hostname: host,
      storeUrl,
      ...(port !== 80 ? { port } : {}),
      engineId: e.id ?? key,
    });
  }
  out.sort((a, b) => a.hostname.localeCompare(b.hostname));
  return dedupeEngines(out);
}
