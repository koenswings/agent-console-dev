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
import { leaveAppToConsole } from './operatorDeepActions';

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

/* ------------------------------------------------------------------------- */
/* share_to_class (nc_browse → nc_share)                                      */
/* ------------------------------------------------------------------------- */

/**
 * Nextcloud 31.0.1 sharing sidebar markup (apps/files_sharing + apps/files
 * sources at v31.0.1; same hooks as upstream cypress/e2e/files_sharing):
 *   - row inline action  [data-cy-files-list-row-action="sharing-status"]
 *   - row menu fallback  button "Actions" → [data-cy-files-list-row-action="details"]
 *   - sidebar            [data-cy-sidebar], tab [aria-controls="tab-sharing"]
 *   - sharee search      #sharing-search-input (NcSelect, disabled when !canReshare)
 *   - share entries      li.sharing-entry, title "<name> (group)",
 *                        .share-select aria-label 'Quick share options, the current selected is "View only"'
 *   - details editor     .sharingTabDetailsView h1 ("Share with group"),
 *                        [data-cy-files-sharing-share-permissions-bundle="read-only"],
 *                        [data-cy-files-sharing-share-editor-action="save"]
 */
export const NC_SHARE_SELECTORS = {
  rowShareAction: '[data-cy-files-list-row-action="sharing-status"]',
  rowActionsButton: 'button[aria-label="Actions"]',
  menuDetails: '[data-cy-files-list-row-action="details"]',
  sidebar: ['[data-cy-sidebar]', '#app-sidebar-vue'],
  sharingTab: '[aria-controls="tab-sharing"]',
  search: '#sharing-search-input',
  option: '.vs__dropdown-menu [role="option"]',
  entry: 'li.sharing-entry',
  entryTitle: '.sharing-entry__summary__desc',
  entryQuickSelect: '.share-select',
  entryDetails: '[data-cy-files-sharing-share-actions]',
  details: '.sharingTabDetailsView',
  detailsTitle: '.sharingTabDetailsView h1',
  readOnly: '[data-cy-files-sharing-share-permissions-bundle="read-only"]',
  save: '[data-cy-files-sharing-share-editor-action="save"]',
  /** NcAppSidebar (@nextcloud/vue 8.23.1) close button: NcButton.app-sidebar__close, aria-label "Close sidebar". */
  sidebarClose: ['.app-sidebar__close', 'button[aria-label="Close sidebar"]'],
} as const;

/** Title NC 31 renders for a group share entry (SharingEntry.vue `title`). */
export const ncGroupShareTitle = (group: string): string => `${group} (group)`;

/** True when a sharing entry's text/aria names exactly this group share (owner suffix allowed). */
export function isGroupShareEntryText(text: string, group: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  const want = ncGroupShareTitle(group);
  return t === want || t.startsWith(`${want} `);
}

/** Selected bundle from the quick-share select aria-label / text, or null. */
export function ncQuickShareSelected(label: string): string | null {
  const m = /current selected is "([^"]+)"/.exec(label);
  if (m) return m[1]!;
  const t = label.replace(/\s+/g, ' ').trim();
  return t || null;
}

/** OCS failure text from a files_sharing API JSON body (or null). */
export function ncOcsFailure(status: number, body: unknown): string | null {
  const meta = (body as { ocs?: { meta?: { status?: string; statuscode?: number; message?: string } } })?.ocs?.meta;
  if (status < 400 && (!meta || meta.status === 'ok' || (meta.statuscode ?? 200) < 400)) return null;
  return `HTTP ${status}${meta?.statuscode ? ` / OCS ${meta.statuscode}` : ''}${meta?.message ? `: ${meta.message}` : ''}`;
}

/** Signed-in Nextcloud uid from <head data-user> (core layout.user.php). */
export const ncSignedInUser = async (app: Page): Promise<string | null> => {
  const uid = await app.locator('head').first().getAttribute('data-user').catch(() => null);
  return uid && uid.trim() ? uid.trim() : null;
};

const SHARE_API = /\/ocs\/v[12]\.php\/apps\/files_sharing\/api\/v1\/shares(\/\d+)?(\?|$)/;

const firstVisible = async (app: Page, selectors: readonly string[]): Promise<string | null> => {
  for (const s of selectors) {
    if (await app.locator(s).first().isVisible().catch(() => false)) return s;
  }
  return null;
};

/** Open the Files sidebar on the Sharing tab for a row (inline Share icon, else Actions → Details). */
export const ncOpenSharingSidebar = async (app: Page, tag: string, name: string): Promise<string> => {
  const row = app.locator(ncRowSelector(name)).first();
  if (!(await waitFor(async () => (await row.count().catch(() => 0)) > 0, app, SETTLE_MS))) {
    throw new Error(`${tag}: "${name}" not listed in ${ncFilesDir(app.url())} (rows: ${await rowNames(app)}).`);
  }
  const inline = row.locator(NC_SHARE_SELECTORS.rowShareAction).first();
  if ((await inline.count().catch(() => 0)) > 0 && (await inline.isVisible().catch(() => false))) {
    await inline.click({ timeout: 8_000 });
  } else {
    const menu = row.locator(NC_SHARE_SELECTORS.rowActionsButton).first();
    if ((await menu.count().catch(() => 0)) === 0) {
      throw new Error(`${tag}: "${name}" row has neither a Share action nor an Actions menu (${app.url()}).`);
    }
    await menu.click({ timeout: 8_000 });
    const details = app.locator(`${NC_SHARE_SELECTORS.menuDetails} button, button${NC_SHARE_SELECTORS.menuDetails}`).last();
    if (!(await waitFor(async () => details.isVisible().catch(() => false), app, 8_000))) {
      throw new Error(`${tag}: Actions menu for "${name}" has no "Details" entry (${app.url()}).`);
    }
    await details.click({ timeout: 8_000 });
  }
  let sidebar: string | null = null;
  if (!(await waitFor(async () => (sidebar = await firstVisible(app, NC_SHARE_SELECTORS.sidebar)) !== null, app, SETTLE_MS))) {
    throw new Error(`${tag}: Files sidebar did not open for "${name}" (${app.url()}).`);
  }
  const side = app.locator(sidebar!).first();
  if (!(await waitFor(async () => ((await side.innerText().catch(() => '')) ?? '').includes(name), app, 8_000))) {
    throw new Error(`${tag}: sidebar opened but is not for "${name}" (${app.url()}).`);
  }
  const tab = side.locator(NC_SHARE_SELECTORS.sharingTab).first();
  if ((await tab.count().catch(() => 0)) === 0) {
    throw new Error(`${tag}: sidebar for "${name}" has no Sharing tab (files_sharing disabled?) (${app.url()}).`);
  }
  if ((await tab.getAttribute('aria-selected').catch(() => null)) !== 'true') {
    await tab.click({ timeout: 8_000 });
  }
  const ready = await waitFor(
    async () =>
      (await side.locator(NC_SHARE_SELECTORS.search).count().catch(() => 0)) > 0 ||
      (await side.locator(NC_SHARE_SELECTORS.entry).count().catch(() => 0)) > 0,
    app,
    SETTLE_MS,
  );
  if (!ready) throw new Error(`${tag}: Sharing tab for "${name}" did not render (${app.url()}).`);
  return sidebar!;
};

/** The sharing entry for a group, or null. */
const groupEntry = async (app: Page, sidebar: string, group: string) => {
  const entries = app.locator(`${sidebar} ${NC_SHARE_SELECTORS.entry}`);
  const n = await entries.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const e = entries.nth(i);
    const text = (await e.locator(NC_SHARE_SELECTORS.entryTitle).first().innerText().catch(() => '')) ?? '';
    if (isGroupShareEntryText(text, group)) return e;
  }
  return null;
};

const entryTitles = async (app: Page, sidebar: string): Promise<string> => {
  const t = await app
    .locator(`${sidebar} ${NC_SHARE_SELECTORS.entry} ${NC_SHARE_SELECTORS.entryTitle}`)
    .allInnerTexts()
    .catch(() => [] as string[]);
  return t.length ? t.map((s) => s.trim()).join(' | ') : '(none)';
};

/**
 * share_to_class: teacher shares Class Materials with group Grade 5A, View only,
 * through the Files sharing sidebar. Creates the share, or (repeat walk) opens
 * the existing group share and re-saves it as View only. Success = the group
 * entry's quick-share select reads "View only" and the OCS save did not fail.
 * Ends on nc_share (sidebar open on the Sharing tab).
 */
export const runShareToClass = async (app: Page): Promise<'created' | 'updated'> => {
  const tag = 'idea#166 share_to_class';
  const group = NC.group;
  const folder = NC.folders.materials;
  await ensureNextcloudFiles(app, tag, null);
  const uid = await ncSignedInUser(app);
  if (uid !== NC.auth.teacher.username) {
    throw new Error(
      `${tag}: needs the teacher session; Nextcloud is signed in as ${uid ?? '(unknown)'} (${app.url()}). ` +
        `Run open_nextcloud_as_teacher first.`,
    );
  }
  await ncOpenClassRoot(app, tag);
  const sidebar = await ncOpenSharingSidebar(app, tag, folder);
  const side = app.locator(sidebar).first();

  const existing = await groupEntry(app, sidebar, group);
  let mode: 'created' | 'updated';
  if (existing) {
    mode = 'updated';
    const btn = existing.locator(NC_SHARE_SELECTORS.entryDetails).first();
    if ((await btn.count().catch(() => 0)) === 0) {
      throw new Error(`${tag}: existing "${ncGroupShareTitle(group)}" share on "${folder}" is not editable by ${uid}.`);
    }
    await btn.click({ timeout: 8_000 });
  } else {
    mode = 'created';
    const search = side.locator(NC_SHARE_SELECTORS.search).first();
    if ((await search.count().catch(() => 0)) === 0) {
      throw new Error(`${tag}: no sharee search on "${folder}" (shares: ${await entryTitles(app, sidebar)}).`);
    }
    if (await search.isDisabled().catch(() => false)) {
      throw new Error(
        `${tag}: Nextcloud does not allow sharing "${folder}" (sharee search disabled; resharing not permitted). ` +
          `If it lives on the Files Disk mount "${NC.shareName}", the files_external mount needs enable_sharing (Kid fixture).`,
      );
    }
    await search.click({ timeout: 8_000 });
    await search.pressSequentially(group, { delay: 40 });
    const option = app.locator(NC_SHARE_SELECTORS.option).filter({ has: app.getByText(group, { exact: true }) }).first();
    if (!(await waitFor(async () => option.isVisible().catch(() => false), app, SETTLE_MS))) {
      const offered = await app.locator(NC_SHARE_SELECTORS.option).allInnerTexts().catch(() => [] as string[]);
      throw new Error(
        `${tag}: group "${group}" not offered by sharee search (offered: ${offered.map((s) => s.replace(/\s+/g, ' ').trim()).join(' | ') || '(none)'}).`,
      );
    }
    await option.click({ timeout: 8_000 });
  }

  const details = side.locator(NC_SHARE_SELECTORS.details).first();
  if (!(await waitFor(async () => details.isVisible().catch(() => false), app, SETTLE_MS))) {
    throw new Error(`${tag}: share details editor did not open for "${group}" (${mode}).`);
  }
  const h1 = ((await side.locator(NC_SHARE_SELECTORS.detailsTitle).first().innerText().catch(() => '')) ?? '').trim();
  if (mode === 'created' && h1 !== 'Share with group') {
    throw new Error(`${tag}: picked a non-group sharee for "${group}" (editor title "${h1}").`);
  }
  const ro = side.locator(NC_SHARE_SELECTORS.readOnly).first();
  if ((await ro.count().catch(() => 0)) === 0) {
    throw new Error(`${tag}: share editor has no "View only" option (${NC_SHARE_SELECTORS.readOnly}).`);
  }
  await ro.click({ timeout: 8_000 });
  const radio = ro.locator('input[type="radio"]').first();
  if (!(await waitFor(async () => radio.isChecked().catch(() => false), app, 5_000))) {
    throw new Error(`${tag}: clicked "View only" but the permission radio is not checked.`);
  }

  const saved = app
    .waitForResponse((r) => SHARE_API.test(r.url()) && ['POST', 'PUT'].includes(r.request().method()), { timeout: SETTLE_MS })
    .catch(() => null);
  await side.locator(NC_SHARE_SELECTORS.save).first().click({ timeout: 8_000 });
  const resp = await saved;
  if (resp) {
    const failure = ncOcsFailure(resp.status(), await resp.json().catch(() => null));
    if (failure) throw new Error(`${tag}: Nextcloud rejected the ${mode === 'created' ? 'new' : 'updated'} share of "${folder}" with "${group}" (${failure}).`);
  } else if (mode === 'created') {
    throw new Error(`${tag}: Save sent no share request to Nextcloud within ${SETTLE_MS}ms.`);
  }

  let label = '';
  const proven = await waitFor(
    async () => {
      if (await details.isVisible().catch(() => false)) return false;
      const e = await groupEntry(app, sidebar, group);
      if (!e) return false;
      const qs = e.locator(NC_SHARE_SELECTORS.entryQuickSelect).first();
      // NcActions puts the aria-label on its toggle button; the root shows the name.
      const aria =
        (await qs.getAttribute('aria-label').catch(() => null)) ??
        (await qs.locator('[aria-label*="current selected"]').first().getAttribute('aria-label').catch(() => null)) ??
        '';
      label = aria || ((await qs.innerText().catch(() => '')) ?? '');
      return ncQuickShareSelected(label) === 'View only';
    },
    app,
    SETTLE_MS,
  );
  if (!proven) {
    throw new Error(
      `${tag}: after Save, "${ncGroupShareTitle(group)}" is not shown as View only on "${folder}" ` +
        `(quick-share "${ncQuickShareSelected(label) ?? '(missing)'}"; shares: ${await entryTitles(app, sidebar)}).`,
    );
  }
  return mode;
};

export const share_to_class: IntentFn = async ({ page }) => {
  await runShareToClass(ncAppPage(page, 'idea#166 share_to_class'));
};

/* ------------------------------------------------------------------------- */
/* done_sharing / back_to_console_from_share (leave nc_share)                 */
/* ------------------------------------------------------------------------- */

/**
 * nc_share precondition: teacher session, Files sidebar open on the Sharing tab,
 * share editor closed (share_to_class saved). Returns the sidebar selector.
 */
export const ncAssertShareState = async (app: Page, tag: string): Promise<string> => {
  await ensureNextcloudFiles(app, tag, null);
  const uid = await ncSignedInUser(app);
  if (uid !== NC.auth.teacher.username) {
    throw new Error(`${tag}: nc_share is a teacher state; Nextcloud is signed in as ${uid ?? '(unknown)'} (${app.url()}).`);
  }
  const sidebar = await firstVisible(app, NC_SHARE_SELECTORS.sidebar);
  if (!sidebar) {
    throw new Error(`${tag}: not in nc_share: no Files sidebar open (${app.url()}). Run share_to_class first.`);
  }
  const side = app.locator(sidebar).first();
  const tab = side.locator(NC_SHARE_SELECTORS.sharingTab).first();
  if ((await tab.getAttribute('aria-selected').catch(() => null)) !== 'true') {
    throw new Error(`${tag}: not in nc_share: Files sidebar is open but not on the Sharing tab (${app.url()}).`);
  }
  if (await side.locator(NC_SHARE_SELECTORS.details).first().isVisible().catch(() => false)) {
    throw new Error(`${tag}: share editor still open (unsaved share); share_to_class did not finish (${app.url()}).`);
  }
  return sidebar;
};

/** done_sharing (nc_share → nc_browse): close the sharing sidebar; Files list stays in the same folder. */
export const runDoneSharing = async (app: Page): Promise<string> => {
  const tag = 'idea#166 done_sharing';
  const sidebar = await ncAssertShareState(app, tag);
  const dir = ncFilesDir(app.url());
  const side = app.locator(sidebar).first();
  let close: string | null = null;
  for (const s of NC_SHARE_SELECTORS.sidebarClose) {
    if (await side.locator(s).first().isVisible().catch(() => false)) {
      close = s;
      break;
    }
  }
  if (!close) throw new Error(`${tag}: sharing sidebar has no "Close sidebar" button (${app.url()}).`);
  await side.locator(close).first().click({ timeout: 8_000 });
  const closed = await waitFor(async () => (await firstVisible(app, NC_SHARE_SELECTORS.sidebar)) === null, app, SETTLE_MS);
  if (!closed) throw new Error(`${tag}: clicked "Close sidebar" but the Files sidebar is still open (${app.url()}).`);
  const browse = await waitFor(
    async () => ncFilesDir(app.url()) === dir && (await app.locator(NC_SELECTORS.breadcrumbs).count().catch(() => 0)) > 0,
    app,
    SETTLE_MS,
  );
  if (!browse) {
    throw new Error(`${tag}: after closing the sidebar Files is not browsing ${dir} (now ${ncFilesDir(app.url())}; ${app.url()}).`);
  }
  return dir!;
};

export const done_sharing: IntentFn = async ({ page }) => {
  await runDoneSharing(ncAppPage(page, 'idea#166 done_sharing'));
};

/**
 * back_to_console_from_share (nc_share → console_teacher): from the open sharing
 * sidebar, leave Nextcloud the same way as leave_nextcloud_as_teacher (close the
 * app tab, prove the Console overview). Loud-fail if not in nc_share first.
 */
export const back_to_console_from_share: IntentFn = async ({ page }) => {
  const tag = 'idea#166 back_to_console_from_share';
  const app = ncAppPage(page, tag);
  if (app === page) {
    throw new Error(`${tag}: Nextcloud is not in its own tab; cannot leave it without closing the Console.`);
  }
  await ncAssertShareState(app, tag);
  await leaveAppToConsole(page);
  if (!app.isClosed()) {
    throw new Error(`${tag}: Nextcloud tab still open after leaving to the Console (${app.url()}).`);
  }
};
