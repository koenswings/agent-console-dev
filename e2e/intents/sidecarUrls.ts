/**
 * Sidecar URL helpers for App-open Path B (idea#168 / Kid App#10 @9ba7876).
 *
 * Gap: post-dock sidecar HTTP is Running, but Console overview cards may not
 * show open-instance-<id> until Axle wires startInstances (Path A). Path B
 * navigates the sidecar base URL on the same hostname as the Console page.
 *
 * Env overrides (full URL wins over port):
 *   DURATION_KOLIBRI_URL / DURATION_NEXTCLOUD_URL
 *   DURATION_KOLIBRI_PORT (default 18080; idea03 Kolibri → 18081)
 *   DURATION_NEXTCLOUD_PORT (default 18280)
 */
export type SidecarApp = 'kolibri' | 'nextcloud' | 'kiwix';

export const SIDECAR_DEFAULT_PORTS: Record<SidecarApp, number> = {
  kolibri: 18080,
  nextcloud: 18280,
  kiwix: 18380,
};

const ENV_URL: Record<SidecarApp, string> = {
  kolibri: 'DURATION_KOLIBRI_URL',
  nextcloud: 'DURATION_NEXTCLOUD_URL',
  kiwix: 'DURATION_KIWIX_URL',
};

const ENV_PORT: Record<SidecarApp, string> = {
  kolibri: 'DURATION_KOLIBRI_PORT',
  nextcloud: 'DURATION_NEXTCLOUD_PORT',
  kiwix: 'DURATION_KIWIX_PORT',
};

/** Read sidecar port from env or default (pure; no I/O). */
export const sidecarPort = (
  app: SidecarApp,
  env: NodeJS.ProcessEnv = process.env,
): number => {
  const raw = env[ENV_PORT[app]];
  if (raw && /^\d+$/.test(raw)) return Number(raw);
  return SIDECAR_DEFAULT_PORTS[app];
};

/**
 * Build sidecar base URL from Console page origin (same host, swap port).
 * Full DURATION_*_URL env overrides win. Trailing slash stripped.
 */
export const resolveSidecarUrl = (
  app: SidecarApp,
  consolePageUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): string => {
  const full = env[ENV_URL[app]]?.trim();
  if (full) return full.replace(/\/$/, '');

  let hostname = 'localhost';
  let protocol = 'http:';
  try {
    const u = new URL(consolePageUrl);
    hostname = u.hostname || hostname;
    protocol = u.protocol || protocol;
  } catch {
    /* about:blank or invalid — keep localhost */
  }
  const port = sidecarPort(app, env);
  return `${protocol}//${hostname}:${port}`;
};

/** Regex matching a Path B / Path A App tab URL for Kolibri or Nextcloud. */
export const APP_TAB_URL_RE =
  /kolibri|nextcloud|18080|18081|18280|\/learn|\/coach|\/facility|\/apps\/files/i;

const originOf = (u: string | undefined): string | null => {
  if (!u) return null;
  try {
    return new URL(u.trim()).origin;
  } catch {
    return null;
  }
};

/**
 * Which App a tab URL belongs to (null = Console / blank / unknown). Order: env
 * full-URL origins, sidecar ports, then path markers. Kolibri paths win over the
 * generic Nextcloud ones so a leftover Kolibri tab (e.g. :18080/en/device/#/content,
 * cover-all-8c8fe30-r9) is never taken for Nextcloud.
 */
export const appKindForUrl = (url: string, env: NodeJS.ProcessEnv = process.env): SidecarApp | null => {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  for (const app of ['kolibri', 'nextcloud', 'kiwix'] as const) {
    const o = originOf(env[ENV_URL[app]]);
    if (o && o === u.origin) return app;
  }
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  for (const app of ['kolibri', 'nextcloud', 'kiwix'] as const) {
    if (port === sidecarPort(app, env)) return app;
  }
  if (port === 18080 || port === 18081) return 'kolibri';
  if (port === 18280) return 'nextcloud';
  if (port === 18380) return 'kiwix';
  const p = u.pathname;
  if (/\/(learn|coach|facility|device|auth)(\/|$)|kolibri/i.test(p)) return 'kolibri';
  if (/^\/viewer$/.test(p) && /^#[^/]+\//.test(u.hash)) return 'kiwix';
  if (/\/apps\/|\/index\.php\/|^\/s\/[^/]+|^\/login(\/|$)|nextcloud/i.test(p)) return 'nextcloud';
  return null;
};

export const appKindForInstance = (instanceId: string): SidecarApp => {
  if (instanceId.includes('nextcloud')) return 'nextcloud';
  if (instanceId.includes('kiwix')) return 'kiwix';
  return 'kolibri';
};

/** Poll budget before Path B / Open-ready (Prefer A r19 ghost Running). Default 90s. */
export function sidecarReadyTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DURATION_SIDECAR_READY_MS?.trim();
  if (raw && /^\d+$/.test(raw)) return Math.max(1_000, Number(raw));
  return 90_000;
}

/** True for HTTP 2xx/3xx (Kolibri often 302). */
export function isSidecarHttpReadyStatus(status: number): boolean {
  return status >= 200 && status < 400;
}
