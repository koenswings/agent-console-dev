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
export type SidecarApp = 'kolibri' | 'nextcloud';

export const SIDECAR_DEFAULT_PORTS: Record<SidecarApp, number> = {
  kolibri: 18080,
  nextcloud: 18280,
};

const ENV_URL: Record<SidecarApp, string> = {
  kolibri: 'DURATION_KOLIBRI_URL',
  nextcloud: 'DURATION_NEXTCLOUD_URL',
};

const ENV_PORT: Record<SidecarApp, string> = {
  kolibri: 'DURATION_KOLIBRI_PORT',
  nextcloud: 'DURATION_NEXTCLOUD_PORT',
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

export const appKindForInstance = (instanceId: string): SidecarApp => {
  if (instanceId.includes('nextcloud')) return 'nextcloud';
  return 'kolibri';
};
