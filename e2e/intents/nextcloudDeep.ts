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

/**
 * Nextcloud First-run wizard (nextcloud/firstrunwizard stable31 App.vue): NcModal
 * id="firstrunwizard" (aria-modal) that blocks every click on first login. The intro
 * video page has no button (Escape → NcModal @close); the slides have a custom
 * NcButton aria-label "Close" (SlideShow.vue). close() also DELETEs
 * /apps/firstrunwizard/wizard so it does not come back for that user.
 */
export const NC_FIRSTRUN = {
  root: '#firstrunwizard',
  close: ['#firstrunwizard button[aria-label="Close"]', '#firstrunwizard .header-close'],
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
    // Race fix (Axle nextcloud-share-smoke-2da863c-r1): leaving /login does not mean the
    // dashboard header has rendered. Poll for the Files link up to SETTLE_MS, never count once.
    let nav: string | null = null;
    await app.waitForLoadState?.('load', { timeout: SETTLE_MS }).catch(() => {});
    const found = await waitFor(
      async () => ncFilesDir(app.url()) !== null || (nav = await firstPresent(app, NC_SELECTORS.filesNav)) !== null,
      app,
      SETTLE_MS,
    );
    if (ncFilesDir(app.url()) === null) {
      if (!found || !nav) {
        const title = await app.title?.().catch(() => '') ?? '';
        const hrefs = await app
          .locator('header a[href]')
          .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))
          .catch(() => [] as string[]);
        throw new Error(
          `${tag}: signed in but no Files app link in the Nextcloud header within ${SETTLE_MS}ms on ${app.url()} ` +
            `(title="${title}"; header links: ${hrefs.length ? hrefs.slice(0, 12).join(', ') : '(none)'}; ` +
            `tried ${NC_SELECTORS.filesNav.join(' | ')}).`,
        );
      }
      // The First-run wizard opens on first login and intercepts the click
      // (Axle smoke 198eb69-r1); it may also appear a moment after the header.
      let lastErr: unknown = null;
      let done = false;
      for (let attempt = 0; attempt < 3 && !done; attempt++) {
        await ncDismissFirstRunWizard(app, tag);
        try {
          await app.locator(nav).first().click({ timeout: 5_000 });
          done = true;
        } catch (e) {
          lastErr = e;
          if (!(await wizardOpen(app))) break;
        }
      }
      if (!done) {
        const msg = lastErr instanceof Error ? lastErr.message.split('\n')[0] : String(lastErr);
        throw new Error(`${tag}: could not click the Nextcloud Files link on ${app.url()} (${msg}).`);
      }
    }
  }
  const files = await waitFor(
    async () => ncFilesDir(app.url()) !== null && (await app.locator(NC_SELECTORS.breadcrumbs).count().catch(() => 0)) > 0,
    app,
    SETTLE_MS,
  );
  if (!files) {
    throw new Error(`${tag}: Nextcloud Files list (${NC_SELECTORS.breadcrumbs}) did not render on ${app.url()}.`);
  }
  // Wizard can also open over Files (first login straight into /apps/files).
  await ncDismissFirstRunWizard(app, tag);
};

const wizardOpen = async (app: Page): Promise<boolean> => {
  try {
    return await app.locator(NC_FIRSTRUN.root).first().isVisible();
  } catch {
    return false;
  }
};

/**
 * Dismiss the First-run wizard if it is up: Close (or a Skip button, if this NC build
 * has one), else Escape; retried until it is gone. Loud-fail if it stays.
 * Returns how it was dismissed ('none' when it was not shown).
 */
export const ncDismissFirstRunWizard = async (app: Page, tag: string): Promise<string> => {
  if (!(await wizardOpen(app))) return 'none';
  const used: string[] = [];
  for (let attempt = 0; attempt < 4 && (await wizardOpen(app)); attempt++) {
    let clicked = false;
    for (const s of NC_FIRSTRUN.close) {
      const btn = app.locator(s).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 3_000 }).catch(() => {});
        used.push('close');
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      const skip = app.locator(NC_FIRSTRUN.root).first().getByRole?.('button', { name: /skip/i }).first();
      if (skip && (await skip.isVisible().catch(() => false))) {
        await skip.click({ timeout: 3_000 }).catch(() => {});
        used.push('skip');
        clicked = true;
      }
    }
    if (!clicked) {
      await app.keyboard.press('Escape');
      used.push('escape');
    }
    await waitFor(async () => !(await wizardOpen(app)), app, 2_500);
  }
  if (await wizardOpen(app)) {
    throw new Error(
      `${tag}: Nextcloud First-run wizard (${NC_FIRSTRUN.root}) still blocks the page after ${used.join(', ')} on ${app.url()}. ` +
        `Fixture alternative: occ app:disable firstrunwizard.`,
    );
  }
  return used[used.length - 1] ?? 'none';
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

/* ------------------------------------------------------------------------- */
/* open_collab_doc / close_doc (nc_browse ⇄ nc_collab)                        */
/* ------------------------------------------------------------------------- */

/**
 * Viewer (nextcloud/viewer stable31 Viewer.vue): NcModal id="viewer", name = file
 * basename; @nextcloud/vue 8.23.1 NcModal header: .modal-header__name, close
 * button .header-close (aria-label "Close"). Markdown opens with the Text app
 * inside the Viewer. Kid placeholder doc heading: "Grade 5A collab notes".
 */
export const NC_VIEWER_SELECTORS = {
  viewer: '#viewer',
  name: '#viewer .modal-header__name',
  close: ['#viewer .header-close', '#viewer button[aria-label="Close"]'],
} as const;

/** Heading Kid ships in Collab/Grade5A-collab-notes.md (proves real content rendered). */
export const NC_COLLAB_DOC_MARKER = NC.collab.heading;
/** Nextcloud Text markers (Kid CONTENT.live.json collab.selectors; nextcloud/text stable31). */
const TEXT = NC.collab.selectors;

/** True when the Files URL marks a file as opened (?openfile, not "false"). */
export function ncOpenFileQuery(url: string): boolean {
  try {
    const q = new URL(url).searchParams;
    return q.has('openfile') && (q.get('openfile') ?? '').toLowerCase() !== 'false';
  } catch {
    return false;
  }
}

const viewerOpen = async (app: Page): Promise<boolean> =>
  app.locator(NC_VIEWER_SELECTORS.viewer).first().isVisible().catch(() => false);

/**
 * open_collab_doc (nc_browse → nc_collab): Files → class root → Collab → click
 * Grade5A-collab-notes.md. Success = Viewer open titled with the file name, the
 * Nextcloud Text editor (Kid Prefer A; Collabora = Prefer B) mounted, and the
 * doc heading rendered. Read-only is fine here (keep_editing proves writes).
 */
export const runOpenCollabDoc = async (app: Page): Promise<string> => {
  const tag = 'idea#166 open_collab_doc';
  const doc = NC.collabDoc;
  await ensureNextcloudFiles(app, tag, null);
  if (await viewerOpen(app)) {
    throw new Error(`${tag}: a Viewer is already open (not nc_browse) on ${app.url()}.`);
  }
  await ncOpenClassRoot(app, tag);
  const dir = await ncOpenFolder(app, tag, NC.folders.collab);
  const link = app.locator(ncRowLinkSelector(doc)).first();
  if (!(await waitFor(async () => (await link.count().catch(() => 0)) > 0, app, SETTLE_MS))) {
    throw new Error(`${tag}: "${doc}" not listed in ${dir} (rows: ${await rowNames(app)}).`);
  }
  await link.click({ timeout: 8_000 });
  if (!(await waitFor(() => viewerOpen(app), app, SETTLE_MS))) {
    throw new Error(
      `${tag}: clicking "${doc}" did not open the Nextcloud Viewer (${NC_VIEWER_SELECTORS.viewer}); ` +
        `Text/Viewer app disabled or file downloaded instead (${app.url()}).`,
    );
  }
  let name = '';
  const titled = await waitFor(
    async () => (name = ((await app.locator(NC_VIEWER_SELECTORS.name).first().innerText().catch(() => '')) ?? '').trim()) === doc,
    app,
    SETTLE_MS,
  );
  if (!titled) throw new Error(`${tag}: Viewer opened "${name || '(no title)'}", not "${doc}".`);
  const editor = app.locator(`${NC_VIEWER_SELECTORS.viewer} ${TEXT.editor}`).first();
  if (!(await waitFor(async () => editor.isVisible().catch(() => false), app, SETTLE_MS))) {
    throw new Error(
      `${tag}: "${doc}" opened in the Viewer but not in Nextcloud Text (${TEXT.editor} missing); ` +
        `Kid Prefer A editor is nextcloud-text (Text app disabled?).`,
    );
  }
  const content = await waitFor(
    async () => ((await editor.innerText().catch(() => '')) ?? '').includes(NC_COLLAB_DOC_MARKER),
    app,
    SETTLE_MS,
  );
  if (!content) {
    throw new Error(`${tag}: Text editor for "${doc}" never rendered the doc heading "${NC_COLLAB_DOC_MARKER}" (empty/failed load).`);
  }
  return dir;
};

export const open_collab_doc: IntentFn = async ({ page }) => {
  await runOpenCollabDoc(ncAppPage(page, 'idea#166 open_collab_doc'));
};

/** close_doc (nc_collab → nc_browse): Viewer Close → Files list of the doc's folder. */
export const runCloseDoc = async (app: Page): Promise<string> => {
  const tag = 'idea#166 close_doc';
  await ensureNextcloudFiles(app, tag, null);
  if (!(await viewerOpen(app))) {
    throw new Error(`${tag}: not in nc_collab: no Nextcloud Viewer open (${app.url()}). Run open_collab_doc first.`);
  }
  const dir = ncFilesDir(app.url());
  let close: string | null = null;
  for (const s of NC_VIEWER_SELECTORS.close) {
    if (await app.locator(s).first().isVisible().catch(() => false)) {
      close = s;
      break;
    }
  }
  if (!close) throw new Error(`${tag}: Viewer has no Close button (${NC_VIEWER_SELECTORS.close.join(', ')}).`);
  await app.locator(close).first().click({ timeout: 8_000 });
  if (!(await waitFor(async () => !(await viewerOpen(app)), app, SETTLE_MS))) {
    throw new Error(`${tag}: clicked Close but the Viewer is still open (${app.url()}).`);
  }
  const browse = await waitFor(
    async () =>
      ncFilesDir(app.url()) === dir &&
      !ncOpenFileQuery(app.url()) &&
      (await app.locator(NC_SELECTORS.breadcrumbs).count().catch(() => 0)) > 0,
    app,
    SETTLE_MS,
  );
  if (!browse) {
    throw new Error(`${tag}: Viewer closed but Files is not browsing ${dir} without openfile (${app.url()}).`);
  }
  return dir!;
};

export const close_doc: IntentFn = async ({ page }) => {
  await runCloseDoc(ncAppPage(page, 'idea#166 close_doc'));
};

/* ------------------------------------------------------------------------- */
/* keep_editing (nc_collab dwell, Nextcloud Text)                             */
/* ------------------------------------------------------------------------- */

const TEXT_PUSH = /\/apps\/text\/(public\/)?session\/\d+\/push(\?|$)/;

/** The line keep_editing appends (unique per run so the proof can't match old text). */
export const keepEditingLine = (now: Date = new Date()): string => `keep_editing ${now.toISOString()}`;

/**
 * keep_editing: type a new line at the end of Grade5A-collab-notes.md in
 * Nextcloud Text. Loud-fail when Text is read-only (Kid collab apply pending).
 * Proof = the line is in the editor AND Text pushed the steps to the server
 * (POST /apps/text/session/<id>/push 2xx). Stays in nc_collab.
 */
export const runKeepEditing = async (app: Page, now: Date = new Date()): Promise<string> => {
  const tag = 'idea#166 keep_editing';
  await ensureNextcloudFiles(app, tag, null);
  if (!(await viewerOpen(app))) {
    throw new Error(`${tag}: not in nc_collab: no Nextcloud Viewer open (${app.url()}). Run open_collab_doc first.`);
  }
  const name = ((await app.locator(NC_VIEWER_SELECTORS.name).first().innerText().catch(() => '')) ?? '').trim();
  if (name !== NC.collab.fileName) {
    throw new Error(`${tag}: Viewer shows "${name || '(no title)'}", not "${NC.collab.fileName}".`);
  }
  const scope = NC_VIEWER_SELECTORS.viewer;
  if (!(await app.locator(`${scope} ${TEXT.editor}`).first().isVisible().catch(() => false))) {
    throw new Error(`${tag}: "${name}" is not open in Nextcloud Text (${TEXT.editor} missing).`);
  }
  if (await app.locator(`${scope} ${TEXT.readonlyBarMustBeAbsent}`).first().isVisible().catch(() => false)) {
    throw new Error(
      `${tag}: Nextcloud Text opened "${name}" read-only (${TEXT.readonlyBarMustBeAbsent} visible). ` +
        `Kid collab apply pending (CONTENT.live.json collabProvisioned=false): ` +
        `post-dock-restore-running.sh --mode sidecar --apps nextcloud.`,
    );
  }
  const content = app.locator(`${scope} ${TEXT.content}`).first();
  if (!(await waitFor(async () => content.isVisible().catch(() => false), app, SETTLE_MS))) {
    throw new Error(`${tag}: no editable Text content (${TEXT.content}) for "${name}".`);
  }
  if (!(await app.locator(`${scope} ${TEXT.menubarWhenEditable}`).first().isVisible().catch(() => false))) {
    throw new Error(`${tag}: Text menubar (${TEXT.menubarWhenEditable}) missing: editor not in edit mode.`);
  }
  const line = keepEditingLine(now);
  const pushed = app
    .waitForResponse((r) => TEXT_PUSH.test(r.url()) && r.request().method() === 'POST', { timeout: SETTLE_MS })
    .catch(() => null);
  await content.click({ timeout: 8_000 });
  await app.keyboard.press('Control+End');
  await app.keyboard.press('Enter');
  await app.keyboard.type(line, { delay: 20 });
  if (!(await waitFor(async () => ((await content.innerText().catch(() => '')) ?? '').includes(line), app, 8_000))) {
    throw new Error(`${tag}: typed "${line}" but it does not appear in the Text editor.`);
  }
  const resp = await pushed;
  if (!resp) throw new Error(`${tag}: Text never pushed the edit to Nextcloud within ${SETTLE_MS}ms (no session push).`);
  if (resp.status() >= 400) {
    throw new Error(`${tag}: Text session push rejected (HTTP ${resp.status()}); edit not saved by Nextcloud.`);
  }
  return line;
};

export const keep_editing: IntentFn = async ({ page }) => {
  await runKeepEditing(ncAppPage(page, 'idea#166 keep_editing'));
};

/* ------------------------------------------------------------------------- */
/* File Drop trio: open_file_drop / after_upload / leave_file_drop            */
/* ------------------------------------------------------------------------- */

/**
 * NC 31 public file-drop page (apps/files_sharing FilesViewFileDropEmptyContent.vue,
 * upstream cypress public-share/view_file-drop.cy.ts):
 *   [data-cy-files-sharing-file-drop] "Upload files to <folder>." + UploadPicker;
 *   uploads PUT /public.php/dav/files/<token>/<name>; no file rows are listed.
 */
export const NC_DROP_SELECTORS = {
  drop: '[data-cy-files-sharing-file-drop]',
  fileInput: '[data-cy-files-sharing-file-drop] input[type="file"]',
} as const;

/** Kid fileRequest.url path on the Nextcloud tab origin (hostname, not IP); DURATION_NC_FILE_REQUEST_URL wins. */
export function resolveFileRequestUrl(ncTabUrl: string, env: NodeJS.ProcessEnv = process.env): string {
  const full = env.DURATION_NC_FILE_REQUEST_URL?.trim();
  if (full) return full;
  const path = new URL(NC.fileRequest.url).pathname;
  return `${new URL(ncTabUrl).origin}${path}`;
}

/** True for a public share page URL /s/<token> (index.php optional). */
export function isPublicShareUrl(url: string, token?: string): boolean {
  try {
    const m = /\/s\/([^/?#]+)/.exec(new URL(url).pathname);
    return !!m && (!token || m[1] === token);
  } catch {
    return false;
  }
}

const dropTag = (name: string) => `idea#166 ${name}`;

/** Newest open file-drop tab (/s/<token>), or loud-fail (not nc_drop). */
export const ncDropPage = (page: Page, tag: string): Page => {
  const pages = page.context().pages();
  for (let i = pages.length - 1; i >= 0; i--) {
    try {
      if (isPublicShareUrl(pages[i]!.url())) return pages[i]!;
    } catch {
      /* closed */
    }
  }
  throw new Error(`${tag}: not in nc_drop: no Nextcloud file request tab (/s/<token>) open. Run open_file_drop first.`);
};

/** Assert the upload-only file-drop UI for the Drop Zone. */
export const ncAssertDropPage = async (drop: Page, tag: string): Promise<void> => {
  const ui = drop.locator(NC_DROP_SELECTORS.drop).first();
  if (!(await waitFor(async () => ui.isVisible().catch(() => false), drop, SETTLE_MS))) {
    const body = ((await drop.locator('body').first().innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ').slice(0, 160);
    throw new Error(
      `${tag}: ${drop.url()} is not a Nextcloud File drop page (${NC_DROP_SELECTORS.drop} missing; page: "${body}"). ` +
        `Kid fileRequest not applied on this host, or token differs (set DURATION_NC_FILE_REQUEST_URL from hosts.<host>.fileRequestUrl).`,
    );
  }
  const text = ((await ui.innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ');
  const pageText = ((await drop.locator('body').first().innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ');
  if (/directory is unavailable/i.test(pageText)) {
    throw new Error(`${tag}: File drop says "This directory is unavailable" (share broken; Kid fileRequest).`);
  }
  if (!text.includes(`Upload files to ${NC.fileRequest.uiFolder}`)) {
    throw new Error(
      `${tag}: File drop page is not for "${NC.fileRequest.path}" (want "Upload files to ${NC.fileRequest.uiFolder}."; got "${text.slice(0, 120)}").`,
    );
  }
  if ((await drop.locator(NC_SELECTORS.anyRow).count().catch(() => 0)) > 0) {
    throw new Error(`${tag}: File drop page lists files (${await rowNames(drop)}); share is not upload-only.`);
  }
};

/**
 * open_file_drop (nc_browse → nc_drop, learner): from the signed-in learner Files
 * tab, open Kid's Drop Zone file request link (CONTENT.live.json fileRequest.url)
 * in a new tab, the way a link from the teacher opens. Success = upload-only
 * File drop UI ("Upload files to inbox." for /Drop Zone/inbox).
 */
export const runOpenFileDrop = async (app: Page): Promise<Page> => {
  const tag = dropTag('open_file_drop');
  await ensureNextcloudFiles(app, tag, null);
  const uid = await ncSignedInUser(app);
  if (uid !== NC.auth.learner.username) {
    throw new Error(`${tag}: learner Intent; Nextcloud is signed in as ${uid ?? '(unknown)'}. Run open_nextcloud_as_learner first.`);
  }
  const url = resolveFileRequestUrl(app.url());
  const drop = await app.context().newPage();
  const resp = await drop.goto(url, { waitUntil: 'domcontentloaded', timeout: SETTLE_MS }).catch((e: unknown) => {
    throw new Error(`${tag}: file request ${url} unreachable (${e instanceof Error ? e.message : String(e)}).`);
  });
  if (resp && resp.status() >= 400) {
    throw new Error(
      `${tag}: file request ${url} returned HTTP ${resp.status()} (404 = old/wrong token; 400 = raw IP not in NC trusted_domains, use hostname).`,
    );
  }
  await ncAssertDropPage(drop, tag);
  return drop;
};

export const open_file_drop: IntentFn = async ({ page }) => {
  await runOpenFileDrop(ncAppPage(page, dropTag('open_file_drop')));
};

/** Name + bytes for one walker upload (unique, so a re-walk never collides). */
export const dropUploadFile = (now: Date = new Date()) => ({
  name: `drop-${now.toISOString().replace(/[:.]/g, '-')}.txt`,
  mimeType: 'text/plain',
  buffer: Buffer.from(`duration-tests after_upload ${now.toISOString()}\n`),
});

/**
 * after_upload (nc_drop → nc_browse): upload one file through the File drop
 * Upload button (file chooser), proven by the public DAV PUT 2xx, then close the
 * drop tab and return to the signed-in Files tab.
 */
export const runAfterUpload = async (page: Page, now: Date = new Date()): Promise<string> => {
  const tag = dropTag('after_upload');
  const drop = ncDropPage(page, tag);
  await ncAssertDropPage(drop, tag);
  const file = dropUploadFile(now);
  const put = drop
    .waitForResponse(
      (r) => r.request().method() === 'PUT' && /\/public\.php\/dav\/files\//.test(r.url()) && r.url().includes(encodeURIComponent(file.name)),
      { timeout: SETTLE_MS },
    )
    .catch(() => null);

  const ui = drop.locator(NC_DROP_SELECTORS.drop).first();
  const upload = ui.getByRole('button', { name: 'Upload' }).first();
  let chosen = false;
  if (await upload.isVisible().catch(() => false)) {
    const chooser = drop.waitForEvent('filechooser', { timeout: 8_000 }).catch(() => null);
    await upload.click({ timeout: 8_000 });
    const item = drop.getByRole('menuitem', { name: 'Upload files' }).first();
    if (await waitFor(async () => item.isVisible().catch(() => false), drop, 3_000)) {
      await item.click({ timeout: 8_000 });
    }
    const fc = await chooser;
    if (fc) {
      await fc.setFiles(file);
      chosen = true;
    }
  }
  if (!chosen) {
    // UploadPicker's own <input type=file> (same element the chooser drives).
    const input = drop.locator(NC_DROP_SELECTORS.fileInput).first();
    if ((await input.count().catch(() => 0)) === 0) {
      throw new Error(`${tag}: File drop page has no Upload button / file input (${drop.url()}).`);
    }
    await input.setInputFiles(file);
  }
  const resp = await put;
  if (!resp) throw new Error(`${tag}: no upload request for ${file.name} within ${SETTLE_MS}ms.`);
  if (resp.status() >= 400) {
    throw new Error(`${tag}: Nextcloud rejected the upload of ${file.name} (HTTP ${resp.status()}).`);
  }

  await drop.close();
  const files = ncAppPage(page, tag);
  await files.bringToFront().catch(() => {});
  await ensureNextcloudFiles(files, tag, null);
  return file.name;
};

export const after_upload: IntentFn = async ({ page }) => {
  await runAfterUpload(page);
};

/** leave_file_drop (nc_drop → console_learner): close Nextcloud tabs, prove the Console overview. */
export const leave_file_drop: IntentFn = async ({ page }) => {
  const tag = dropTag('leave_file_drop');
  const drop = ncDropPage(page, tag);
  if (drop === page) throw new Error(`${tag}: file request opened in the Console tab; cannot leave without closing the Console.`);
  await leaveAppToConsole(page);
  if (!drop.isClosed()) throw new Error(`${tag}: file request tab still open after leaving to the Console (${drop.url()}).`);
};
