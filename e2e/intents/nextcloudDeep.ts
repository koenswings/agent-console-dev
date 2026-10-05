/**
 * Nextcloud 31.0.1 deep Intents (idea#166, Kid koenswings/nextcloud:1.0-31.0.1).
 *
 * Selectors are Nextcloud upstream production markup (`data-cy-*`, `data-login-form*`),
 * not Kid testids:
 *   - login:  [data-login-form], #user, #password, [data-login-form-submit]
 *   - files:  [data-cy-files-content-breadcrumbs], tr[data-cy-files-list-row-name="<name>"],
 *             [data-cy-files-list-row-name-link]
 *   - URL:    /apps/files/files[/<fileid>]?dir=/<path>
 *
 * Prefer A: real UI clicks, loud-fail, no URL rewrites to fake a folder.
 */
import type { Page } from '@playwright/test';
import type { IntentFn } from './types';
import { DURATION_FIXTURES } from './fixtures';
import { openAppInstance, resolveAppPage } from './openApp';

const NC = DURATION_FIXTURES.nextcloud;
const SETTLE_MS = 20_000;

export const NC_SELECTORS = {
  loginForm: ['[data-login-form]', 'input#password'],
  loginUser: ['[data-login-form-input-user] input', 'input#user', 'input[name="user"]'],
  loginPassword: ['[data-login-form-input-password] input', 'input#password', 'input[name="password"]'],
  loginSubmit: ['[data-login-form-submit]', 'button[type="submit"]'],
  filesNav: [
    'nav.app-menu a[href$="/apps/files/"]',
    '#appmenu a[href*="/apps/files"]',
    'a[href$="/apps/files/"]',
  ],
  breadcrumbs: '[data-cy-files-content-breadcrumbs]',
  breadcrumbRoot: ['[data-cy-files-content-breadcrumbs] a >> nth=0'],
  anyRow: 'tr[data-cy-files-list-row]',
} as const;

export const ncRowSelector = (name: string): string =>
  `tr[data-cy-files-list-row-name="${name.replace(/"/g, '\\"')}"]`;
export const ncRowLinkSelector = (name: string): string =>
  `${ncRowSelector(name)} [data-cy-files-list-row-name-link]`;

/** True on Nextcloud's login page. */
export function isNcLoginUrl(url: string): boolean {
  try {
    return /\/login\b/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * Files app directory from the URL: decoded `dir` query ('/' when absent),
 * or null when not on /apps/files.
 */
export function ncFilesDir(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/\/apps\/files(\/|$)/.test(u.pathname)) return null;
    const dir = u.searchParams.get('dir');
    if (!dir) return '/';
    const norm = dir.replace(/\/+$/, '');
    return norm === '' ? '/' : norm;
  } catch {
    return null;
  }
}

/** Passwords to try for a fixture account: configured first, then legacy username. */
export function ncPasswordCandidates(creds: { username: string; password: string }): string[] {
  return [...new Set([creds.password, creds.username].filter(Boolean))];
}

const firstPresent = async (app: Page, selectors: readonly string[]): Promise<string | null> => {
  for (const s of selectors) {
    if ((await app.locator(s).first().count().catch(() => 0)) > 0) return s;
  }
  return null;
};

const waitFor = async (pred: () => Promise<boolean> | boolean, app: Page, ms: number): Promise<boolean> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await pred()) return true;
    await app.waitForTimeout(250);
  }
  return !!(await pred());
};

const rowNames = async (app: Page): Promise<string> => {
  const names = await app
    .locator(NC_SELECTORS.anyRow)
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-cy-files-list-row-name') ?? '?'))
    .catch(() => [] as string[]);
  return names.length ? names.join(', ') : '(no rows)';
};

/**
 * Make sure the tab is Nextcloud Files, signed in. With `creds`, a login form
 * is filled (configured password, then legacy password=username once). Without
 * creds, a login form is a loud-fail (deep Intents must not guess the role).
 */
export const ensureNextcloudFiles = async (
  app: Page,
  tag: string,
  creds: { username: string; password: string } | null,
): Promise<void> => {
  const onLogin = async () => isNcLoginUrl(app.url()) || (await firstPresent(app, NC_SELECTORS.loginForm)) !== null;
  const landed = await waitFor(
    async () => (await onLogin()) || (await app.locator(NC_SELECTORS.breadcrumbs).count().catch(() => 0)) > 0 ||
      ncFilesDir(app.url()) !== null || /\/apps\//.test(app.url()),
    app,
    SETTLE_MS,
  );
  if (!landed) {
    throw new Error(`${tag}: Nextcloud did not render a login form or an app page within ${SETTLE_MS}ms (${app.url()}).`);
  }

  if (await onLogin()) {
    if (!creds) {
      throw new Error(
        `${tag}: Nextcloud shows its login page (${app.url()}); not signed in. ` +
          `Run open_nextcloud_as_teacher / open_nextcloud_as_learner first.`,
      );
    }
    const tried: string[] = [];
    for (const pw of ncPasswordCandidates(creds)) {
      const user = await firstPresent(app, NC_SELECTORS.loginUser);
      const pass = await firstPresent(app, NC_SELECTORS.loginPassword);
      const submit = await firstPresent(app, NC_SELECTORS.loginSubmit);
      if (!user || !pass || !submit) {
        throw new Error(`${tag}: Nextcloud login form incomplete on ${app.url()} (user=${!!user} password=${!!pass} submit=${!!submit}).`);
      }
      await app.locator(user).first().fill(creds.username);
      await app.locator(pass).first().fill(pw);
      await app.locator(submit).first().click({ timeout: 8_000 });
      tried.push(pw === creds.username ? 'legacy=username' : 'configured');
      const left = await waitFor(async () => !(await onLogin()), app, 25_000);
      if (left) break;
    }
    if (await onLogin()) {
      throw new Error(
        `${tag}: Nextcloud refused ${creds.username} (tried ${tried.join(', ')}) on ${app.url()}. ` +
          `Set DURATION_NC_${creds.username === NC.auth.teacher.username ? 'TEACHER' : 'LEARNER'}_PASSWORD.`,
      );
    }
  }

  if (ncFilesDir(app.url()) === null) {
    const nav = await firstPresent(app, NC_SELECTORS.filesNav);
    if (!nav) {
      throw new Error(`${tag}: signed in but no Files app link in the Nextcloud header on ${app.url()}.`);
    }
    await app.locator(nav).first().click({ timeout: 8_000 });
  }
  const files = await waitFor(
    async () => ncFilesDir(app.url()) !== null && (await app.locator(NC_SELECTORS.breadcrumbs).count().catch(() => 0)) > 0,
    app,
    SETTLE_MS,
  );
  if (!files) {
    throw new Error(`${tag}: Nextcloud Files list (${NC_SELECTORS.breadcrumbs}) did not render on ${app.url()}.`);
  }
};

/** Click the root breadcrumb until the Files dir is '/'. */
export const ncGoRoot = async (app: Page, tag: string): Promise<void> => {
  if (ncFilesDir(app.url()) === '/') return;
  const crumb = await firstPresent(app, NC_SELECTORS.breadcrumbRoot);
  if (!crumb) throw new Error(`${tag}: no root breadcrumb on ${app.url()}.`);
  await app.locator(crumb).first().click({ timeout: 8_000 });
  if (!(await waitFor(() => ncFilesDir(app.url()) === '/', app, SETTLE_MS))) {
    throw new Error(`${tag}: root breadcrumb did not return Files to / (${app.url()}).`);
  }
};

/** Open a child folder row by name; success only when `dir` becomes `<parent>/<name>`. */
export const ncOpenFolder = async (app: Page, tag: string, name: string): Promise<string> => {
  const parent = ncFilesDir(app.url()) ?? '/';
  const want = `${parent === '/' ? '' : parent}/${name}`;
  const link = ncRowLinkSelector(name);
  const present = await waitFor(async () => (await app.locator(link).count().catch(() => 0)) > 0, app, SETTLE_MS);
  if (!present) {
    throw new Error(`${tag}: folder "${name}" not listed in ${parent} on ${app.url()} (rows: ${await rowNames(app)}).`);
  }
  await app.locator(link).first().click({ timeout: 8_000 });
  if (!(await waitFor(() => ncFilesDir(app.url()) === want, app, SETTLE_MS))) {
    throw new Error(`${tag}: clicked "${name}" but Files dir is ${ncFilesDir(app.url())} (want ${want}; ${app.url()}).`);
  }
  return want;
};

/**
 * Directory that holds the class folders: '/' when "Class Materials" is at the
 * root, else the Files Disk mount folder (fixture shareName). Leaves Files there.
 */
export const ncOpenClassRoot = async (app: Page, tag: string): Promise<string> => {
  await ncGoRoot(app, tag);
  const marker = ncRowSelector(NC.folders.materials);
  const mount = ncRowSelector(NC.shareName);
  const seen = await waitFor(
    async () => (await app.locator(marker).count().catch(() => 0)) > 0 || (await app.locator(mount).count().catch(() => 0)) > 0,
    app,
    SETTLE_MS,
  );
  if (!seen) {
    throw new Error(
      `${tag}: neither "${NC.folders.materials}" nor the Files Disk folder "${NC.shareName}" at Files root ` +
        `(${app.url()}; rows: ${await rowNames(app)}).`,
    );
  }
  if ((await app.locator(marker).count().catch(() => 0)) > 0) return '/';
  return ncOpenFolder(app, tag, NC.shareName);
};

/** True for a Nextcloud tab URL (sidecar :18280, /apps/…, NC login), never Kolibri. */
export function isNextcloudTabUrl(url: string): boolean {
  if (!url || /\/(learn|coach|facility)\b|:1808\d/i.test(url)) return false;
  return /:18280\b|nextcloud|\/apps\/|\/index\.php\/|\/login\b/i.test(url);
}

/**
 * Newest open Nextcloud tab. Deep Intents start from nc_browse, so a missing
 * tab is a loud-fail (open_nextcloud_as_* must run first), not a re-open.
 */
export const ncAppPage = (page: Page, tag: string): Page => {
  const pages = page.context().pages();
  for (let i = pages.length - 1; i >= 0; i--) {
    try {
      if (isNextcloudTabUrl(pages[i]!.url())) return pages[i]!;
    } catch {
      /* closed */
    }
  }
  const fallback = resolveAppPage(page);
  if (fallback !== page && isNextcloudTabUrl(fallback.url())) return fallback;
  throw new Error(
    `${tag}: no Nextcloud tab open (tabs: ${pages.map((p) => p.url() || 'about:blank').join(', ')}). ` +
      `Run open_nextcloud_as_teacher / open_nextcloud_as_learner first.`,
  );
};

/** Open Nextcloud from Console and prove a signed-in Files list. */
const openNextcloudVerified = async (
  page: Page,
  instanceId: string | undefined,
  role: 'teacher' | 'learner',
): Promise<void> => {
  const tag = `idea#166 open_nextcloud_as_${role}`;
  const app = await openAppInstance(page, instanceId ?? NC.instanceId, 'nextcloud');
  await ensureNextcloudFiles(app, tag, NC.auth[role]);
};

export const open_nextcloud_as_teacher: IntentFn = async ({ page, instanceId }) =>
  openNextcloudVerified(page, instanceId, 'teacher');

export const open_nextcloud_as_learner: IntentFn = async ({ page, instanceId }) =>
  openNextcloudVerified(page, instanceId, 'learner');

/**
 * browse_folders (nc_browse dwell): open Class Materials, Drop Zone and Collab
 * in turn through the Files list, each proven by the `dir` URL, returning to
 * the class root between them. No share / drop / edit.
 */
export const runBrowseFolders = async (app: Page): Promise<string[]> => {
  const tag = 'idea#166 browse_folders';
  await ensureNextcloudFiles(app, tag, null);
  const visited: string[] = [];
  for (const name of [NC.folders.materials, NC.folders.drop, NC.folders.collab]) {
    const base = await ncOpenClassRoot(app, tag);
    if (base !== '/' && ncFilesDir(app.url()) !== base) {
      throw new Error(`${tag}: expected Files at ${base} before opening "${name}" (${app.url()}).`);
    }
    visited.push(await ncOpenFolder(app, tag, name));
  }
  await ncOpenClassRoot(app, tag);
  return visited;
};

export const browse_folders: IntentFn = async ({ page }) => {
  await runBrowseFolders(ncAppPage(page, 'idea#166 browse_folders'));
};
