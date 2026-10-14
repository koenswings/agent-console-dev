/**
 * appUrl.ts — build the link used to open an App instance.
 *
 * `.local` names only resolve via mDNS, which many learner devices (Android
 * phones/tablets, some networks) cannot do, and never remotely. Host order:
 *
 *   1. App on the engine the Console page was loaded from, in production web
 *      mode: the host the page was opened with (`window.location.hostname`) —
 *      whatever already worked for this device (IP, name or Tailscale).
 *   2. Any other engine that publishes its LAN address in the store
 *      (`engine.lanAddress`): that IP.
 *   3. Otherwise `<hostname>.local` via `ensureLocal()` — a fallback only,
 *      never used when an IP is available.
 *
 * The connected engine is the one named by the page host, the same host
 * App.tsx uses as the connection hostname in production web mode.
 */
import { isProductionWebMode } from './engine';

/** Add .local suffix if hostname is a bare name (not an IP, not already .local). */
export function ensureLocal(hostname: string): string {
  if (!hostname || hostname === 'localhost') return hostname;
  if (/^[\d.]+$/.test(hostname)) return hostname; // IP address — leave as-is
  if (hostname.endsWith('.local')) return hostname;
  return `${hostname}.local`;
}

/** True for IPv4 literals and IPv6 literals (bracketed or not). */
export function isIpLiteral(host: string): boolean {
  return /^[\d.]+$/.test(host) || host.includes(':');
}

/** Bracket a bare IPv6 literal so it can be used as a URL host. */
function urlHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

/** First DNS label, lower-cased: `idea02.local` / `idea02.tailnet.ts.net` → `idea02`. */
function shortName(host: string): string {
  return host.split('.')[0].toLowerCase();
}

export interface AppHostContext {
  /** Hostname the Console page was opened with (`window.location.hostname`). */
  pageHostname: string;
  /** Result of `isProductionWebMode()`; false in dev and extension mode. */
  productionWebMode: boolean;
  /** Number of engines in the store — used only when the page host is an IP. */
  engineCount: number;
}

/** Read the live page context. Kept separate so the pure helpers stay testable. */
export function currentAppHostContext(engineCount: number): AppHostContext {
  return {
    pageHostname: window.location.hostname,
    productionWebMode: isProductionWebMode(),
    engineCount,
  };
}

/**
 * Is `engineHostname` the engine the Console page is served from?
 *
 * Name match on the first DNS label (`idea02`, `idea02.local` and a MagicDNS
 * FQDN all match engine `idea02`). An IP page host carries no name, so it can
 * only be attributed when the store holds exactly one engine; otherwise the
 * engine is treated as "other" and keeps today's `.local` link.
 */
export function isConnectedEngine(engineHostname: string, ctx: AppHostContext): boolean {
  if (!ctx.productionWebMode || !engineHostname || !ctx.pageHostname) return false;
  if (isIpLiteral(ctx.pageHostname)) return ctx.engineCount === 1;
  return shortName(engineHostname) === shortName(ctx.pageHostname);
}

/** What appUrl needs from a store Engine record (or just its hostname). */
export type AppEngine = string | { hostname: string; lanAddress?: string | null };

/** The Engine's published LAN address, if it is a usable IP literal. */
export function engineLanAddress(engine: AppEngine): string | null {
  if (typeof engine === 'string') return null;
  const a = String(engine.lanAddress ?? '').trim();
  return a && isIpLiteral(a) ? a : null;
}

/** Host (no scheme, no port) to use in an App link for an engine. */
export function resolveAppHost(engine: AppEngine, ctx: AppHostContext): string {
  const hostname = typeof engine === 'string' ? engine : String(engine.hostname ?? '');
  if (isConnectedEngine(hostname, ctx)) return urlHost(ctx.pageHostname);
  const ip = engineLanAddress(engine);
  if (ip) return urlHost(ip);
  return ensureLocal(hostname);
}

/** Full App link: `http://<host>:<port>`. */
export function buildAppUrl(engine: AppEngine, port: number, ctx: AppHostContext): string {
  return `http://${resolveAppHost(engine, ctx)}:${port}`;
}
