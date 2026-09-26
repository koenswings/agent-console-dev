/**
 * appUrl.ts — build the link used to open an App instance.
 *
 * `.local` names only resolve via mDNS on the Engine's own LAN, so a
 * `http://<engine>.local:<port>` link fails when the Console is reached
 * remotely (e.g. over Tailscale at `http://idea02:8080`). Rules:
 *
 *   - App on the engine the Console is connected to, in production web mode:
 *     use the host the Console page was opened with (`window.location.hostname`),
 *     so `idea02.local` in a school and `idea02` / a Tailscale IP remotely.
 *   - App on any other engine, or dev / extension mode (where the page host is
 *     localhost or an extension origin, not the engine): `<hostname>.local`
 *     via `ensureLocal()`.
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

/** Host (no scheme, no port) to use in an App link for an engine. */
export function resolveAppHost(engineHostname: string, ctx: AppHostContext): string {
  if (isConnectedEngine(engineHostname, ctx)) return urlHost(ctx.pageHostname);
  return ensureLocal(engineHostname);
}

/** Full App link: `http://<host>:<port>`. */
export function buildAppUrl(engineHostname: string, port: number, ctx: AppHostContext): string {
  return `http://${resolveAppHost(engineHostname, ctx)}:${port}`;
}
