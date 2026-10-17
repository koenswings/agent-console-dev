/**
 * appUrl.ts — the one place that builds the link used to open an App instance.
 * Every Open button / link (AppCard, InstanceRow, MobileAppList, UsbStickRow)
 * goes through `buildAppUrl`.
 *
 * `.local` names only resolve via mDNS, which many learner devices (Android
 * phones/tablets, some networks) cannot do, and never remotely. Host order:
 *
 *   1. App on the Engine that served the Console page (production web mode):
 *      the host the page was opened with (`window.location.hostname`) —
 *      whatever already worked for this device (IP, name or Tailscale). That
 *      Engine is recognised by any of:
 *        - name: first DNS label of the page host = engine hostname;
 *        - IP: page host = the Engine's published `lanAddress`;
 *        - id: the Engine id the page host reported on /api/store-url
 *          (only when the Console is connected to the page host itself);
 *        - an IP page host with exactly one Engine in the store.
 *   2. Any other Engine that publishes its LAN address (`engine.lanAddress`):
 *      that IP.
 *   3. Otherwise `<hostname>.local` via `ensureLocal()` — last fallback only.
 *
 * The instance port is always part of the URL. A missing / non-numeric / 0 /
 * out-of-range port gives `null` (callers render a disabled Open button), so
 * no `http://host:undefined` or port-less link is ever produced.
 */
import { isProductionWebMode } from './engine';
import { pageEngineId } from './connectedEngine';
import type { Store } from '../types/store';

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
  /**
   * Engine id of the Engine serving the page, when known (from the page
   * host's /api/store-url `engineId`, see connectedEngine.ts `pageEngineId`).
   */
  pageEngineId?: string | null;
}

/** Read the live page context. Kept separate so the pure helpers stay testable. */
export function currentAppHostContext(engineCount: number, pageEngine: string | null = null): AppHostContext {
  return {
    pageHostname: window.location.hostname,
    productionWebMode: isProductionWebMode(),
    engineCount,
    pageEngineId: pageEngine,
  };
}

/**
 * Live page context for a store: engine count plus the page Engine's id when
 * the Console is connected to the page host. Reactive when called inside a
 * memo / JSX (reads the store accessor's value and the connectedEngine signals).
 */
export function appHostContextFor(store: Store | null | undefined): AppHostContext {
  const engineCount = Object.keys(store?.engineDB ?? {}).length;
  return currentAppHostContext(engineCount, pageEngineId(store, window.location.hostname));
}

/** Lower-case, strip IPv6 brackets: for comparing a page host with an address. */
function normAddr(host: string): string {
  return host.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
}

/** What appUrl needs from a store Engine record (or just its hostname). */
export type AppEngine = string | { id?: string | null; hostname: string; lanAddress?: string | null };

/** The Engine's published LAN address, if it is a usable IP literal. */
export function engineLanAddress(engine: AppEngine): string | null {
  if (typeof engine === 'string') return null;
  const a = String(engine.lanAddress ?? '').trim();
  return a && isIpLiteral(a) ? a : null;
}

/**
 * Is `engine` the Engine the Console page is served from? See the header for
 * the four ways it is recognised. Never in dev / extension mode (the page host
 * is then the dev server, not an Engine).
 */
export function isConnectedEngine(engine: AppEngine, ctx: AppHostContext): boolean {
  if (!ctx.productionWebMode || !ctx.pageHostname) return false;
  const hostname = typeof engine === 'string' ? engine : String(engine.hostname ?? '');
  const id = typeof engine === 'string' ? null : engine.id;
  if (id && ctx.pageEngineId && String(id) === String(ctx.pageEngineId)) return true;
  if (isIpLiteral(ctx.pageHostname)) {
    const ip = engineLanAddress(engine);
    if (ip && normAddr(ip) === normAddr(ctx.pageHostname)) return true;
    // An IP page host with an id or address that names another Engine is not this one.
    return ctx.engineCount === 1 && !ctx.pageEngineId;
  }
  return !!hostname && shortName(hostname) === shortName(ctx.pageHostname);
}

/** Host (no scheme, no port) to use in an App link for an engine; '' if none. */
export function resolveAppHost(engine: AppEngine, ctx: AppHostContext): string {
  const hostname = typeof engine === 'string' ? engine : String(engine.hostname ?? '');
  if (isConnectedEngine(engine, ctx)) return urlHost(ctx.pageHostname);
  const ip = engineLanAddress(engine);
  if (ip) return urlHost(ip);
  return ensureLocal(hostname.trim());
}

/** A usable TCP port (1–65535) from a store value, or null. */
export function validAppPort(port: unknown): number | null {
  if (typeof port !== 'number' && typeof port !== 'string') return null;
  if (typeof port === 'string' && !/^\d+$/.test(port.trim())) return null;
  const n = Number(port);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

/**
 * Full App link `http://<host>:<port>`, or null when there is no usable port
 * or no host — the caller then renders the Open button disabled.
 */
export function buildAppUrl(engine: AppEngine | null | undefined, port: unknown, ctx: AppHostContext): string | null {
  if (!engine) return null;
  const p = validAppPort(port);
  if (p === null) return null;
  const host = resolveAppHost(engine, ctx);
  if (!host) return null;
  return `http://${host}:${p}`;
}
