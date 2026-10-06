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
import { appKindForUrl, openAppInstance, resolveAppPage } from './openApp';
import { leaveAppToConsole } from './operatorDeepActions';

const NC = DURATION_FIXTURES.nextcloud;
const SETTLE_MS = 20_000;
/** Kid 2026-10-05 Drop Zone public TTFB ~25s. */
const FILE_DROP_GOTO_MS = 60_000;

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

/**
 * Nextcloud 31 AccountMenu (core AccountMenu.vue / layout.user.php #user-menu):
 * open the Settings/user menu, then the logout entry (settingsNavEntries id=logout).
 */
export const NC_LOGOUT = {
  menu: [
    '#user-menu button',
    'nav#user-menu button',
    '#header-menu-user-menu',
    'button[aria-label="Settings menu"]',
    'button[aria-label="User menu"]',
    '[data-user-menu]',
  ],
  logout: [
    'a[href*="logout"]',
    '#user-menu a[href*="logout"]',
    'li#logout a',
    '[data-id="logout"] a',
  ],
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

const firstVisible = async (app: Page, selectors: readonly string[]): Promise<string | null> => {
  for (const s of selectors) {
    if (await app.locator(s).first().isVisible().catch(() => false)) return s;
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

/* ------------------------------------------------------------------------- */
/* clickUntil: wait actionable → click (3× backoff) → poll result → reload once */
/* ------------------------------------------------------------------------- */

/**
 * Retry knobs (r28 FAIL@22 share_to_class: one click + one 20s poll for the sidebar gave
 * up after 20.7s, while r26 passed the same step in ~34s). Same pattern as 5aa6239 (Files
 * link: visible+enabled, 3 clicks with backoff) and 73c37d0 (poll, reload once, poll, loud).
 */
/** Click attempts per round; one round before and one after the single page reload. */
export const NC_CLICK_RETRIES = 3;
/** Backoff before retry n (n ≥ 1): n × 1s. */
export const NC_CLICK_BACKOFF_MS = 1_000;
/** First poll for the click's result in a round. */
export const NC_RESULT_POLL_MS = 30_000;
/** Poll for the result on retries (the round's first attempt already waited NC_RESULT_POLL_MS). */
export const NC_RETRY_POLL_MS = 10_000;
/** Visible+enabled wait on retries (the round's first attempt waits SETTLE_MS). */
export const NC_RETRY_READY_MS = 5_000;
/** Poll after a click that itself threw (not actionable): short, then retry. */
const NC_THREW_POLL_MS = 2_000;

/** Deterministic Nextcloud state (permission, server rejection), not a timing race: never retried. */
export class NcFatal extends Error {}

export type ClickUntilResult = { ok: boolean; clicks: number; reloaded: boolean; lastError: string | null };

const errLine = (e: unknown): string => (e instanceof Error ? e.message.split('\n')[0]! : String(e));

/** Attempt info appended to a loud-fail message after clickUntil gave up. */
export const ncAttempts = (r: ClickUntilResult): string =>
  ` [${r.clicks} click attempt(s), ${r.reloaded ? '1 page reload' : 'no reload'}` +
  `${r.lastError ? `; last click error: ${r.lastError}` : ''}]`;

/** Playwright visible AND enabled, never throws. */
export const ncActionable = async (loc: {
  isVisible: () => Promise<boolean>;
  isEnabled: () => Promise<boolean>;
}): Promise<boolean> => {
  try {
    return (await loc.isVisible()) && (await loc.isEnabled());
  } catch {
    return false;
  }
};

/**
 * Wait for the target to be actionable (`ready`, visible+enabled), `click`, poll `done`.
 * Not done → retry the click (up to NC_CLICK_RETRIES, n × 1s backoff). Still not done →
 * reload the page once (unless `reload: false`), re-establish preconditions with
 * `afterReload` (false = give up), and run the click/poll round once more. Returns the
 * outcome; the caller throws its own loud message (+ ncAttempts) when !ok. NcFatal from
 * `click` is rethrown at once. A result that is already true before the round's first
 * click never counts (no soft-pass by reload): only a late landing of a previous click does.
 */
export const clickUntil = async (
  app: Page,
  o: {
    click: () => Promise<unknown>;
    done: () => Promise<boolean>;
    ready?: () => Promise<boolean>;
    reload?: false | (() => Promise<unknown>);
    afterReload?: () => Promise<boolean>;
    retries?: number;
    readyMs?: number;
    pollMs?: number;
  },
): Promise<ClickUntilResult> => {
  const retries = o.retries ?? NC_CLICK_RETRIES;
  const r: ClickUntilResult = { ok: false, clicks: 0, reloaded: false, lastError: null };
  const rounds = o.reload === false ? 1 : 2;
  for (let round = 0; round < rounds; round++) {
    if (round === 1) {
      r.reloaded = true;
      if (typeof o.reload === 'function') await o.reload();
      else await app.reload?.({ waitUntil: 'domcontentloaded', timeout: SETTLE_MS }).catch(() => {});
      if (o.afterReload && !(await o.afterReload())) return r;
    }
    for (let attempt = 0; attempt < retries; attempt++) {
      if (attempt > 0) {
        await app.waitForTimeout(NC_CLICK_BACKOFF_MS * attempt);
        if (await o.done()) return { ...r, ok: true };
      }
      if (o.ready) await waitFor(o.ready, app, attempt === 0 ? (o.readyMs ?? SETTLE_MS) : NC_RETRY_READY_MS);
      r.clicks++;
      let threw = false;
      try {
        await o.click();
      } catch (e) {
        if (e instanceof NcFatal) throw e;
        threw = true;
        r.lastError = errLine(e);
      }
      const poll = threw ? NC_THREW_POLL_MS : attempt === 0 ? (o.pollMs ?? NC_RESULT_POLL_MS) : Math.min(o.pollMs ?? NC_RETRY_POLL_MS, NC_RETRY_POLL_MS);
      if (await waitFor(o.done, app, poll)) return { ...r, ok: true };
    }
  }
  return r;
};

/**
 * Prefer A logout via the real Nextcloud 31 user menu (AccountMenu), then wait for /login.
 * Loud-fail with page state if the menu or logout entry cannot be used.
 */
export const ncLogout = async (app: Page, tag: string): Promise<void> => {
  const onLogin = async () => isNcLoginUrl(app.url()) || (await firstPresent(app, NC_SELECTORS.loginForm)) !== null;
  if (await onLogin()) return;

  let logout = await firstVisible(app, NC_LOGOUT.logout);
  if (!logout) {
    let opened = false;
    const menu = (await firstVisible(app, NC_LOGOUT.menu)) ?? (await firstPresent(app, NC_LOGOUT.menu));
    if (menu) {
      await app.locator(menu).first().click({ timeout: 5_000 });
      opened = true;
    } else if (typeof app.getByRole === 'function') {
      const btn = app.getByRole('button', { name: /settings menu|user menu/i }).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 5_000 });
        opened = true;
      }
    }
    if (!opened) {
      throw new Error(
        `${tag}: cannot open Nextcloud user menu to log out on ${app.url()} ` +
          `(tried ${NC_LOGOUT.menu.join(' | ')}).`,
      );
    }
    const found = await waitFor(
      async () => (logout = await firstVisible(app, NC_LOGOUT.logout)) !== null,
      app,
      8_000,
    );
    if (!found || !logout) {
      if (typeof app.getByRole === 'function') {
        const item = app.getByRole('menuitem', { name: /log\s*out/i }).first();
        const link = app.getByRole('link', { name: /log\s*out/i }).first();
        if (await item.isVisible().catch(() => false)) {
          await item.click({ timeout: 5_000 });
          logout = '__role_menuitem__';
        } else if (await link.isVisible().catch(() => false)) {
          await link.click({ timeout: 5_000 });
          logout = '__role_link__';
        }
      }
      if (!logout) {
        throw new Error(
          `${tag}: Nextcloud user menu open but no Log out entry on ${app.url()} ` +
            `(tried ${NC_LOGOUT.logout.join(' | ')}).`,
        );
      }
    }
  }
  let tries = '';
  if (logout && !logout.startsWith('__role_')) {
    // No reload: it would not log out and would close the user menu.
    const entry = app.locator(logout).first();
    const r = await clickUntil(app, {
      ready: () => ncActionable(entry),
      click: () => entry.click({ timeout: 5_000 }),
      done: onLogin,
      reload: false,
      readyMs: 5_000,
      pollMs: SETTLE_MS,
    });
    tries = ncAttempts(r);
  }
  if (!(await waitFor(async () => onLogin(), app, logout && !logout.startsWith('__role_') ? 0 : SETTLE_MS))) {
    throw new Error(
      `${tag}: Nextcloud logout clicked but login page did not appear within ${SETTLE_MS}ms ` +
        `(still on ${app.url()}; uid=${(await ncSignedInUser(app)) ?? 'none'}).${tries}`,
    );
  }
};

/**
 * Make sure the tab is Nextcloud Files, signed in as `creds` when provided.
 * With `creds`: if already signed in as a different uid, log out first, then sign in
 * (configured password, then legacy password=username once). After Files settle,
 * assert head[data-user] === creds.username (cover-all-aeef795-r12: leftover teacher
 * session must not soft-pass open_nextcloud_as_learner).
 * Without creds, a login form is a loud-fail (deep Intents must not guess the role);
 * an existing session is left as-is (share/file-drop keep their own role gates).
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

  if (creds && !(await onLogin())) {
    const uid = await ncSignedInUser(app);
    if (uid && uid !== creds.username) {
      await ncLogout(app, tag);
    }
  }

  if (await onLogin()) {
    if (!creds) {
      throw new Error(
        `${tag}: Nextcloud shows its login page (${app.url()}); not signed in. ` +
          `Run open_nextcloud_as_teacher / open_nextcloud_as_learner first.`,
      );
    }
    const tried: string[] = [];
    // r25 FAIL@27: /login can be up before the Vue login form mounts; one count() saw
    // user/password/submit all missing. Poll up to SETTLE_MS, reload the page once, poll
    // again, and only then loud-fail.
    let reloaded = false;
    for (const pw of ncPasswordCandidates(creds)) {
      let user: string | null = null;
      let pass: string | null = null;
      let submit: string | null = null;
      const formReady = async () => {
        user = await firstPresent(app, NC_SELECTORS.loginUser);
        pass = await firstPresent(app, NC_SELECTORS.loginPassword);
        submit = await firstPresent(app, NC_SELECTORS.loginSubmit);
        return !!(user && pass && submit);
      };
      if (!(await waitFor(formReady, app, SETTLE_MS)) && !reloaded) {
        reloaded = true;
        await app.reload?.({ waitUntil: 'domcontentloaded', timeout: SETTLE_MS }).catch(() => {});
        await waitFor(formReady, app, SETTLE_MS);
      }
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
      // r24 FAIL@21: a slow dashboard can expose the link before it is actionable, and the
      // old loop bailed after one 5s click when no wizard was open. Wait visible+enabled,
      // then retry the click with short backoff regardless of wizard state.
      const link = app.locator(nav).first();
      let lastErr: unknown = null;
      let done = false;
      for (let attempt = 0; attempt < 3 && !done; attempt++) {
        if (attempt > 0) await app.waitForTimeout(1_000 * attempt);
        await ncDismissFirstRunWizard(app, tag);
        if (ncFilesDir(app.url()) !== null) {
          done = true;
          break;
        }
        await waitFor(
          async () =>
            ncFilesDir(app.url()) !== null ||
            ((await link.isVisible().catch(() => false)) && (await link.isEnabled().catch(() => false))),
          app,
          attempt === 0 ? SETTLE_MS : 5_000,
        );
        if (ncFilesDir(app.url()) !== null) {
          done = true;
          break;
        }
        try {
          await link.click({ timeout: 5_000 });
          done = true;
        } catch (e) {
          lastErr = e;
          if (ncFilesDir(app.url()) !== null) done = true;
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

  if (creds) {
    const uid = await ncSignedInUser(app);
    if (uid !== creds.username) {
      throw new Error(
        `${tag}: Nextcloud Files settled but signed-in uid is ${uid ? JSON.stringify(uid) : '(none)'}, ` +
          `want ${JSON.stringify(creds.username)} on ${app.url()}.`,
      );
    }
  }
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
  let crumb: string | null = null;
  const crumbUp = async () => (crumb = await firstPresent(app, NC_SELECTORS.breadcrumbRoot)) !== null;
  if (!(await waitFor(crumbUp, app, SETTLE_MS))) throw new Error(`${tag}: no root breadcrumb on ${app.url()}.`);
  const r = await clickUntil(app, {
    ready: () => ncActionable(app.locator(crumb!).first()),
    click: () => app.locator(crumb!).first().click({ timeout: 8_000 }),
    done: async () => ncFilesDir(app.url()) === '/',
    afterReload: () => waitFor(crumbUp, app, SETTLE_MS),
    pollMs: SETTLE_MS,
  });
  if (!r.ok) {
    throw new Error(`${tag}: root breadcrumb did not return Files to / (${app.url()}).${ncAttempts(r)}`);
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
  const row = app.locator(link).first();
  const r = await clickUntil(app, {
    ready: () => ncActionable(row),
    click: () => row.click({ timeout: 8_000 }),
    done: async () => ncFilesDir(app.url()) === want,
    afterReload: () => waitFor(async () => (await app.locator(link).count().catch(() => 0)) > 0, app, SETTLE_MS),
    pollMs: SETTLE_MS,
  });
  if (!r.ok) {
    throw new Error(
      `${tag}: clicked "${name}" but Files dir is ${ncFilesDir(app.url())} (want ${want}; ${app.url()}).${ncAttempts(r)}`,
    );
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

/** True for a Nextcloud tab URL (sidecar :18280, /apps/…, /s/<token>, NC login), never Kolibri/Kiwix. */
export function isNextcloudTabUrl(url: string): boolean {
  return !!url && appKindForUrl(url) === 'nextcloud';
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
  const fallback = resolveAppPage(page, 'nextcloud');
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
  // Never wait 20s for a login form on a non-Nextcloud tab (leftover Kolibri, Console).
  if (app === page || !isNextcloudTabUrl(app.url())) {
    throw new Error(
      `${tag}: opened tab is not Nextcloud (${app === page ? 'Console tab' : app.url()}); ` +
        `tabs: ${page.context().pages().map((p) => p.url() || 'about:blank').join(', ')}.`,
    );
  }
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

/**
 * Open the Files sidebar on the Sharing tab for a row (inline Share icon, else Actions → Details).
 * r28 FAIL@22: one click + one SETTLE_MS poll gave up at 20.7s ("Files sidebar did not open").
 * Now: row visible → share/actions control visible+enabled → click → poll the sidebar (for this
 * row) NC_RESULT_POLL_MS; retry the click 3× with backoff; reload Files once, wait for the row,
 * retry again; only then loud-fail. `reload: false` when the caller already reloaded.
 */
export const ncOpenSharingSidebar = async (
  app: Page,
  tag: string,
  name: string,
  opts: { reload?: boolean } = {},
): Promise<string> => {
  const allowReload = opts.reload !== false;
  const row = app.locator(ncRowSelector(name)).first();
  const rowUp = async () => (await row.count().catch(() => 0)) > 0 && (await row.isVisible().catch(() => false));
  if (!(await waitFor(rowUp, app, SETTLE_MS))) {
    throw new Error(`${tag}: "${name}" not listed in ${ncFilesDir(app.url())} (rows: ${await rowNames(app)}).`);
  }
  const inline = row.locator(NC_SHARE_SELECTORS.rowShareAction).first();
  const menu = row.locator(NC_SHARE_SELECTORS.rowActionsButton).first();
  const details = app.locator(`${NC_SHARE_SELECTORS.menuDetails} button, button${NC_SHARE_SELECTORS.menuDetails}`).last();
  const openClick = async () => {
    if (await ncActionable(inline)) {
      await inline.click({ timeout: 8_000 });
      return;
    }
    if ((await menu.count().catch(() => 0)) === 0) {
      throw new Error(`${tag}: "${name}" row has neither a Share action nor an Actions menu (${app.url()}).`);
    }
    // A retry may find the menu still open from the previous attempt: don't toggle it shut.
    if (!(await details.isVisible().catch(() => false))) await menu.click({ timeout: 8_000 });
    if (!(await waitFor(async () => details.isVisible().catch(() => false), app, 8_000))) {
      throw new Error(`${tag}: Actions menu for "${name}" has no "Details" entry (${app.url()}).`);
    }
    await details.click({ timeout: 8_000 });
  };
  let sidebar: string | null = null;
  const sidebarText = async () =>
    sidebar ? ((await app.locator(sidebar).first().innerText().catch(() => '')) ?? '') : '';
  // Done = a sidebar is visible AND it is this row's (a leftover sidebar for another file is not).
  const openForName = async () =>
    (sidebar = await firstVisible(app, NC_SHARE_SELECTORS.sidebar)) !== null && (await sidebarText()).includes(name);
  const open = (reload: boolean) =>
    clickUntil(app, {
      ready: async () => (await ncActionable(inline)) || (await ncActionable(menu)),
      click: openClick,
      done: openForName,
      reload: reload ? undefined : false,
      afterReload: () => waitFor(rowUp, app, SETTLE_MS),
    });
  const r = await open(allowReload);
  if (!r.ok) {
    if (sidebar !== null || (await firstVisible(app, NC_SHARE_SELECTORS.sidebar)) !== null) {
      throw new Error(`${tag}: sidebar opened but is not for "${name}" (${app.url()}).${ncAttempts(r)}`);
    }
    throw new Error(`${tag}: Files sidebar did not open for "${name}" (${app.url()}).${ncAttempts(r)}`);
  }
  const side = () => app.locator(sidebar!).first();
  const tab = () => side().locator(NC_SHARE_SELECTORS.sharingTab).first();
  if (!(await waitFor(async () => (await tab().count().catch(() => 0)) > 0, app, 8_000))) {
    throw new Error(`${tag}: sidebar for "${name}" has no Sharing tab (files_sharing disabled?) (${app.url()}).`);
  }
  const ready = async () =>
    (await side().locator(NC_SHARE_SELECTORS.search).count().catch(() => 0)) > 0 ||
    (await side().locator(NC_SHARE_SELECTORS.entry).count().catch(() => 0)) > 0;
  if ((await tab().getAttribute('aria-selected').catch(() => null)) === 'true' && (await waitFor(ready, app, SETTLE_MS))) {
    return sidebar!;
  }
  // Clicking an already-selected tab is harmless; after a reload, re-open the sidebar (no 2nd reload).
  const t = await clickUntil(app, {
    ready: () => ncActionable(tab()),
    click: () => tab().click({ timeout: 8_000 }),
    done: ready,
    reload: allowReload ? undefined : false,
    afterReload: async () => (await waitFor(rowUp, app, SETTLE_MS)) && (await open(false)).ok,
    pollMs: SETTLE_MS,
  });
  if (!t.ok) throw new Error(`${tag}: Sharing tab for "${name}" did not render (${app.url()}).${ncAttempts(t)}`);
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
  try {
    return await shareInSidebar(app, tag, sidebar, uid);
  } catch (e) {
    if (e instanceof NcFatal) throw e;
    // Editor stage still failing after its click retries: reload Files once and redo the
    // share from the sidebar (a share that did get created is then picked up as 'updated').
    await app.reload?.({ waitUntil: 'domcontentloaded', timeout: SETTLE_MS }).catch(() => {});
    try {
      await ensureNextcloudFiles(app, tag, null);
      await ncOpenClassRoot(app, tag);
      const again = await ncOpenSharingSidebar(app, tag, folder, { reload: false });
      return await shareInSidebar(app, tag, again, uid);
    } catch (e2) {
      if (e2 instanceof NcFatal) throw e2;
      throw new Error(`${errLine(e2)} [share editor redone once after a page reload; first pass: ${errLine(e)}]`);
    }
  }
};

/** share_to_class editor stage, sidebar already open on the Sharing tab. Click steps retry (no reload here). */
const shareInSidebar = async (app: Page, tag: string, sidebar: string, uid: string): Promise<'created' | 'updated'> => {
  const group = NC.group;
  const folder = NC.folders.materials;
  const side = app.locator(sidebar).first();
  const details = side.locator(NC_SHARE_SELECTORS.details).first();
  const editorOpen = async () => details.isVisible().catch(() => false);

  const existing = await groupEntry(app, sidebar, group);
  let mode: 'created' | 'updated';
  let tries: ClickUntilResult;
  if (existing) {
    mode = 'updated';
    const btn = existing.locator(NC_SHARE_SELECTORS.entryDetails).first();
    if ((await btn.count().catch(() => 0)) === 0) {
      throw new Error(`${tag}: existing "${ncGroupShareTitle(group)}" share on "${folder}" is not editable by ${uid}.`);
    }
    tries = await clickUntil(app, {
      ready: () => ncActionable(btn),
      click: () => btn.click({ timeout: 8_000 }),
      done: editorOpen,
      reload: false,
      pollMs: SETTLE_MS,
    });
  } else {
    mode = 'created';
    const search = side.locator(NC_SHARE_SELECTORS.search).first();
    if ((await search.count().catch(() => 0)) === 0) {
      throw new Error(`${tag}: no sharee search on "${folder}" (shares: ${await entryTitles(app, sidebar)}).`);
    }
    if (await search.isDisabled().catch(() => false)) {
      throw new NcFatal(
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
    tries = await clickUntil(app, {
      ready: () => ncActionable(option),
      click: () => option.click({ timeout: 8_000 }),
      done: editorOpen,
      reload: false,
      pollMs: SETTLE_MS,
    });
  }

  if (!tries.ok) {
    throw new Error(`${tag}: share details editor did not open for "${group}" (${mode}).${ncAttempts(tries)}`);
  }
  const h1 = ((await side.locator(NC_SHARE_SELECTORS.detailsTitle).first().innerText().catch(() => '')) ?? '').trim();
  if (mode === 'created' && h1 !== 'Share with group') {
    throw new NcFatal(`${tag}: picked a non-group sharee for "${group}" (editor title "${h1}").`);
  }
  const ro = side.locator(NC_SHARE_SELECTORS.readOnly).first();
  if (!(await waitFor(async () => (await ro.count().catch(() => 0)) > 0, app, 8_000))) {
    throw new Error(`${tag}: share editor has no "View only" option (${NC_SHARE_SELECTORS.readOnly}).`);
  }
  const radio = ro.locator('input[type="radio"]').first();
  const roTries = await clickUntil(app, {
    ready: () => ncActionable(ro),
    click: () => ro.click({ timeout: 8_000 }),
    done: async () => radio.isChecked().catch(() => false),
    reload: false,
    pollMs: 5_000,
  });
  if (!roTries.ok) {
    throw new Error(`${tag}: clicked "View only" but the permission radio is not checked.${ncAttempts(roTries)}`);
  }

  // Save: re-click only when the click itself failed (not actionable). A click that went
  // through is never repeated, so a slow POST cannot turn into a duplicate share request.
  const save = side.locator(NC_SHARE_SELECTORS.save).first();
  let saved: Promise<Awaited<ReturnType<Page['waitForResponse']>> | null> = Promise.resolve(null);
  let clicked = false;
  const saveTries = await clickUntil(app, {
    ready: () => ncActionable(save),
    click: async () => {
      saved = app
        .waitForResponse((r) => SHARE_API.test(r.url()) && ['POST', 'PUT'].includes(r.request().method()), { timeout: SETTLE_MS })
        .catch(() => null);
      await save.click({ timeout: 8_000 });
      clicked = true;
    },
    done: async () => clicked,
    reload: false,
    readyMs: 8_000,
  });
  const resp = saveTries.ok ? await saved : null;
  if (resp) {
    const failure = ncOcsFailure(resp.status(), await resp.json().catch(() => null));
    if (failure) throw new NcFatal(`${tag}: Nextcloud rejected the ${mode === 'created' ? 'new' : 'updated'} share of "${folder}" with "${group}" (${failure}).`);
  } else if (mode === 'created') {
    throw new Error(`${tag}: Save sent no share request to Nextcloud within ${SETTLE_MS}ms.${saveTries.ok ? '' : ncAttempts(saveTries)}`);
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
  const closeUp = async () => {
    close = null;
    for (const s of NC_SHARE_SELECTORS.sidebarClose) {
      if (await ncActionable(side.locator(s).first())) {
        close = s;
        break;
      }
    }
    return close !== null;
  };
  if (!(await waitFor(closeUp, app, 8_000))) {
    throw new Error(`${tag}: sharing sidebar has no "Close sidebar" button (${app.url()}).`);
  }
  const sidebarGone = async () => (await firstVisible(app, NC_SHARE_SELECTORS.sidebar)) === null;
  // After the one reload, only continue if the sidebar is open again (no soft-pass: a reload
  // that drops the sidebar is not "Close sidebar" working).
  const r = await clickUntil(app, {
    ready: closeUp,
    click: async () => {
      if (!close && !(await closeUp())) throw new Error('no "Close sidebar" button');
      await side.locator(close!).first().click({ timeout: 8_000 });
    },
    done: sidebarGone,
    afterReload: async () =>
      (await waitFor(async () => (await firstVisible(app, NC_SHARE_SELECTORS.sidebar)) !== null, app, SETTLE_MS)) &&
      (await waitFor(closeUp, app, 8_000)),
    pollMs: SETTLE_MS,
  });
  if (!r.ok) {
    throw new Error(`${tag}: clicked "Close sidebar" but the Files sidebar is still open (${app.url()}).${ncAttempts(r)}`);
  }
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
  const opened = await clickUntil(app, {
    ready: () => ncActionable(link),
    click: () => link.click({ timeout: 8_000 }),
    done: () => viewerOpen(app),
    afterReload: () => waitFor(async () => (await link.count().catch(() => 0)) > 0, app, SETTLE_MS),
    pollMs: SETTLE_MS,
  });
  if (!opened.ok) {
    throw new Error(
      `${tag}: clicking "${doc}" did not open the Nextcloud Viewer (${NC_VIEWER_SELECTORS.viewer}); ` +
        `Text/Viewer app disabled or file downloaded instead (${app.url()}).${ncAttempts(opened)}`,
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
  const closeUp = async () => {
    close = null;
    for (const s of NC_VIEWER_SELECTORS.close) {
      if (await ncActionable(app.locator(s).first())) {
        close = s;
        break;
      }
    }
    return close !== null;
  };
  if (!(await waitFor(closeUp, app, 8_000))) {
    throw new Error(`${tag}: Viewer has no Close button (${NC_VIEWER_SELECTORS.close.join(', ')}).`);
  }
  // ?openfile reopens the Viewer on reload; continue only if it did (no soft-pass by reload).
  const r = await clickUntil(app, {
    ready: closeUp,
    click: async () => {
      if (!close && !(await closeUp())) throw new Error('no Viewer Close button');
      await app.locator(close!).first().click({ timeout: 8_000 });
    },
    done: async () => !(await viewerOpen(app)),
    afterReload: async () => (await waitFor(() => viewerOpen(app), app, SETTLE_MS)) && (await waitFor(closeUp, app, 8_000)),
    pollMs: SETTLE_MS,
  });
  if (!r.ok) {
    throw new Error(`${tag}: clicked Close but the Viewer is still open (${app.url()}).${ncAttempts(r)}`);
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
 * Nextcloud Text 31.0.1 states that leave the doc rendered but NOT editable (r37 FAIL@82):
 *   - DocumentStatus.vue `.document-status` NcNoteCard: "Document has been changed outside of
 *     the editor. The changes cannot be applied" (sync HTTP 409 SAVE_COLLISSION), "Document
 *     could not be loaded. Please check your internet connection." + Reconnect, "Document idle
 *     for … minutes" + Reconnect, a 412 load error + Reload, "… locked by {user}".
 *   - CollisionResolveDialog.vue `#resolve-conflicts`: NcButton data-cy="resolveThisVersion"
 *     ("Use current version") / data-cy="resolveServerVersion" ("Use the saved version").
 *   - Editor.vue onError/onChange: `$editor.setEditable(false)` while syncError or
 *     hasConnectionIssue; the MenuBar renders only when `contentLoaded && !syncError`.
 *   - SkeletonLoading.vue `.placeholder-main-text` while the session has not loaded.
 */
export const NC_TEXT_STATE_SELECTORS = {
  proseMirror: '[data-text-el="editor-content-wrapper"] .ProseMirror',
  status: '.document-status',
  statusButton: '.document-status a.button',
  collision: '#resolve-conflicts',
  useSavedVersion: '#resolve-conflicts [data-cy="resolveServerVersion"]',
  skeleton: '.placeholder-main-text',
} as const;

/** Total time keep_editing may spend getting an editable Text editor (env DURATION_KEEP_EDITING_BUDGET_MS). */
export const NC_KEEP_EDITING_BUDGET_MS = 90_000;
/** Close + reopen of the doc through the Files UI within that budget (env DURATION_KEEP_EDITING_REOPENS). */
export const NC_KEEP_EDITING_REOPENS = 2;
/** Each blocking-UI click (Reconnect / Use the saved version / Reload) is tried at most this often. */
export const NC_KEEP_EDITING_UI_FIXES = 3;

const envInt = (name: string, dflt: number, env: NodeJS.ProcessEnv = process.env): number => {
  const raw = env[name];
  if (raw === undefined || raw === '') return dflt;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name}=${JSON.stringify(raw)} is not a non-negative number.`);
  return Math.floor(n);
};

/** keep_editing editable-wait knobs from the environment (loud on garbage). */
export function keepEditingBudget(env: NodeJS.ProcessEnv = process.env): { budgetMs: number; reopens: number } {
  return {
    budgetMs: envInt('DURATION_KEEP_EDITING_BUDGET_MS', NC_KEEP_EDITING_BUDGET_MS, env),
    reopens: envInt('DURATION_KEEP_EDITING_REOPENS', NC_KEEP_EDITING_REOPENS, env),
  };
}

/** What the Viewer's Text editor shows right now (never throws). */
export type NcTextState = {
  url: string;
  viewer: boolean;
  container: boolean;
  /** `.ProseMirror` inside the content wrapper: contenteditable="true", present but not editable, or absent. */
  proseMirror: 'editable' | 'read-only' | 'missing';
  menubar: boolean;
  readonlyBar: boolean;
  skeleton: boolean;
  /** Text of the DocumentStatus notes ('' when none). */
  status: string;
  /** Label of the DocumentStatus action link (Reconnect / Reload), if any. */
  statusButton: string | null;
  collision: boolean;
};

export const ncTextState = async (app: Page): Promise<NcTextState> => {
  const v = NC_VIEWER_SELECTORS.viewer;
  const S = NC_TEXT_STATE_SELECTORS;
  const vis = (sel: string) => app.locator(`${v} ${sel}`).first().isVisible().catch(() => false);
  const txt = async (sel: string) =>
    ((await app.locator(`${v} ${sel}`).first().innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
  const viewer = await viewerOpen(app);
  const editable = await vis(TEXT.content);
  const anyPm = editable || (await vis(S.proseMirror));
  const statusButton = (await vis(S.statusButton)) ? (await txt(S.statusButton)) || '(unlabelled)' : null;
  return {
    url: app.url(),
    viewer,
    container: await vis(TEXT.editor),
    proseMirror: editable ? 'editable' : anyPm ? 'read-only' : 'missing',
    menubar: await vis(TEXT.menubarWhenEditable),
    readonlyBar: await vis(TEXT.readonlyBarMustBeAbsent),
    skeleton: await vis(S.skeleton),
    status: (await vis(S.status)) ? (await txt(S.status)).slice(0, 200) : '',
    statusButton,
    collision: await vis(S.collision),
  };
};

/** One-line diagnostic for a loud-fail. */
export const describeNcTextState = (s: NcTextState): string =>
  [
    `viewer=${s.viewer ? 'open' : 'closed'}`,
    `editor-container=${s.container ? 'visible' : 'missing'}`,
    `.ProseMirror=${s.proseMirror}`,
    `menubar=${s.menubar ? 'visible' : 'missing'}`,
    s.readonlyBar ? 'readonly-bar=visible' : null,
    s.skeleton ? 'loading-skeleton=visible' : null,
    s.collision ? 'collision-dialog=visible (Use current version / Use the saved version)' : null,
    s.status ? `document-status="${s.status}"` : null,
    s.statusButton ? `status-button="${s.statusButton}"` : null,
    `url=${s.url}`,
  ]
    .filter(Boolean)
    .join('; ');

/** Editable for real: contenteditable ProseMirror + MenuBar (no syncError) and no blocking note. */
const textEditable = (s: NcTextState): boolean =>
  s.viewer && s.proseMirror === 'editable' && s.menubar && !s.readonlyBar && !s.collision && s.statusButton === null;

const isLockNote = (status: string): boolean => /locked by/i.test(status);
const isIdleNote = (status: string): boolean => /idle for/i.test(status);

/**
 * Wait (bounded) until Nextcloud Text has the collab doc editable, clearing blocking Text UI
 * through its own buttons and reopening the doc through the Files UI when it stays stuck.
 * Returns the recovery actions taken ([] when it was editable straight away). Loud-fails
 * with the last observed state. Never types, never fakes editability.
 */
export const ncAwaitEditableText = async (
  app: Page,
  tag: string,
  name: string,
  knobs: { budgetMs: number; reopens: number } = keepEditingBudget(),
): Promise<string[]> => {
  const started = Date.now();
  const deadline = started + knobs.budgetMs;
  // Time to wait for a stuck editor before the next reopen (each attempt gets a fair share).
  const attemptMs = Math.max(10_000, Math.floor(knobs.budgetMs / (knobs.reopens + 1)));
  const actions: string[] = [];
  const fixes = { reconnect: 0, saved: 0, reload: 0 };
  let reopens = 0;
  let attemptStart = started;
  let last = await ncTextState(app);
  let lastError: string | null = null;

  const fail = (why: string): never => {
    throw new Error(
      `${tag}: no editable Text content (${TEXT.content}) for "${name}" after ${Date.now() - started}ms ` +
        `(budget ${knobs.budgetMs}ms; ${reopens}/${knobs.reopens} reopen(s)` +
        `${actions.length ? `; tried: ${actions.join(' → ')}` : ''}): ${why}. ` +
        `Last state: ${describeNcTextState(last)}${lastError ? `; last error: ${lastError}` : ''}.`,
    );
  };

  const clickFix = async (sel: string, what: string, key: keyof typeof fixes): Promise<boolean> => {
    if (fixes[key] >= NC_KEEP_EDITING_UI_FIXES) return false;
    fixes[key]++;
    const loc = app.locator(`${NC_VIEWER_SELECTORS.viewer} ${sel}`).first();
    try {
      if (!(await ncActionable(loc))) return false;
      await loc.click({ timeout: 8_000 });
      actions.push(what);
      return true;
    } catch (e) {
      lastError = `${what}: ${errLine(e)}`;
      return false;
    }
  };

  const reopen = async (): Promise<void> => {
    reopens++;
    attemptStart = Date.now();
    try {
      await runCloseDoc(app);
      await runOpenCollabDoc(app);
      actions.push(`reopened "${name}" via Files (close + click)`);
    } catch (e) {
      lastError = `reopen: ${errLine(e)}`;
      if (ncOpenFileQuery(app.url())) {
        // Viewer Close not cooperating: a page reload reopens an ?openfile doc (fresh Text session).
        await app.reload?.({ waitUntil: 'domcontentloaded', timeout: SETTLE_MS }).catch(() => {});
        await waitFor(() => viewerOpen(app), app, SETTLE_MS);
        actions.push('page reload (reopen via Files failed)');
      } else {
        actions.push('reopen via Files failed');
      }
    }
  };

  for (;;) {
    last = await ncTextState(app);
    if (textEditable(last)) return actions;
    if (last.readonlyBar && !isLockNote(last.status) && !isIdleNote(last.status)) {
      // Permission read-only (not a lock/idle): deterministic, never retried.
      throw new Error(
        `${tag}: Nextcloud Text opened "${name}" read-only (${TEXT.readonlyBarMustBeAbsent} visible). ` +
          `Kid collab apply pending (CONTENT.live.json collabProvisioned=false): ` +
          `post-dock-restore-running.sh --mode sidecar --apps nextcloud. State: ${describeNcTextState(last)}.`,
      );
    }
    if (Date.now() >= deadline) fail('budget exhausted');

    let acted = false;
    if (last.collision) {
      // Sync HTTP 409: the file changed outside Text. The walker has typed nothing yet, so the
      // file on disk is the version to keep: Text's own "Use the saved version" button.
      acted = await clickFix(NC_TEXT_STATE_SELECTORS.useSavedVersion, 'collision → "Use the saved version"', 'saved');
    } else if (last.statusButton && /reconnect/i.test(last.statusButton)) {
      acted = await clickFix(NC_TEXT_STATE_SELECTORS.statusButton, `"${last.statusButton}" (${last.status.slice(0, 60)})`, 'reconnect');
    } else if (last.statusButton && /reload/i.test(last.statusButton)) {
      acted = await clickFix(NC_TEXT_STATE_SELECTORS.statusButton, `"${last.statusButton}" (load error)`, 'reload');
      if (acted) await waitFor(() => viewerOpen(app), app, SETTLE_MS);
    } else if (!last.viewer) {
      if (reopens >= knobs.reopens) fail('Viewer closed and no reopen left');
      await reopen();
      continue;
    }
    if (acted) {
      // Give Text one sync round to clear syncError / reconnect before judging again.
      await waitFor(async () => textEditable(await ncTextState(app)), app, Math.min(10_000, Math.max(0, deadline - Date.now())));
      continue;
    }
    if (Date.now() - attemptStart >= attemptMs) {
      if (reopens < knobs.reopens) {
        await reopen();
        continue;
      }
    }
    await app.waitForTimeout(500);
  }
};

/**
 * keep_editing: type a new line at the end of Grade5A-collab-notes.md in
 * Nextcloud Text. Loud-fail when Text is read-only (Kid collab apply pending).
 * r37 FAIL@82: every Text sync answered HTTP 409 (file touched outside Text), so the
 * editor stayed non-editable behind the collision notice; ncAwaitEditableText now clears
 * such Text UI by its own buttons / reopens the doc within a bounded budget, else fails
 * loud with the last observed state.
 * Proof = the line is in the editor AND Text pushed the steps to the server
 * (POST /apps/text/session/<id>/push 2xx, sent after typing began). Stays in nc_collab.
 */
export const runKeepEditing = async (
  app: Page,
  now: Date = new Date(),
  knobs: { budgetMs: number; reopens: number } = keepEditingBudget(),
): Promise<string> => {
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
  const vis = (sel: string) => async () => app.locator(`${scope} ${sel}`).first().isVisible().catch(() => false);
  if (!(await waitFor(vis(TEXT.editor), app, SETTLE_MS))) {
    throw new Error(`${tag}: "${name}" is not open in Nextcloud Text (${TEXT.editor} missing).`);
  }
  const recovered = await ncAwaitEditableText(app, tag, name, knobs);
  if (recovered.length) {
    // Visible in the walk log: the step passed only after real Text/Files UI recovery.
    console.log(JSON.stringify({ event: 'keep_editing_recovery', file: name, actions: recovered }));
  }
  const content = app.locator(`${scope} ${TEXT.content}`).first();
  const line = keepEditingLine(now);
  // Only a push the browser sent after typing began proves this edit (a collision
  // resolution or reconnect also pushes; those must not count).
  let typingAt: number | null = null;
  const pushed = app
    .waitForResponse(
      (r) =>
        TEXT_PUSH.test(r.url()) &&
        r.request().method() === 'POST' &&
        typingAt !== null &&
        r.request().timing().startTime >= typingAt,
      { timeout: SETTLE_MS },
    )
    .catch(() => null);
  // Focus click: retried only while the click itself fails; typing is never repeated (no
  // duplicate lines). A reload (?openfile reopens the doc) only if all clicks failed.
  let focused = false;
  const focus = await clickUntil(app, {
    ready: () => ncActionable(content),
    click: async () => {
      await content.click({ timeout: 8_000 });
      focused = true;
    },
    done: async () => focused,
    afterReload: async () => (await waitFor(() => viewerOpen(app), app, SETTLE_MS)) && (await waitFor(vis(TEXT.content), app, SETTLE_MS)),
    readyMs: 8_000,
  });
  if (!focus.ok) throw new Error(`${tag}: could not click into the Text editor for "${name}".${ncAttempts(focus)}`);
  typingAt = Date.now();
  await app.keyboard.press('Control+End');
  await app.keyboard.press('Enter');
  await app.keyboard.type(line, { delay: 20 });
  if (!(await waitFor(async () => ((await content.innerText().catch(() => '')) ?? '').includes(line), app, 8_000))) {
    throw new Error(
      `${tag}: typed "${line}" but it does not appear in the Text editor. State: ${describeNcTextState(await ncTextState(app))}.`,
    );
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
  const uiUp = async () => ui.isVisible().catch(() => false);
  // Public share page can be up before the Vue File drop view mounts: poll, reload once, poll.
  let reloaded = false;
  if (!(await waitFor(uiUp, drop, SETTLE_MS)) && typeof drop.reload === 'function') {
    reloaded = true;
    await drop.reload({ waitUntil: 'domcontentloaded', timeout: FILE_DROP_GOTO_MS }).catch(() => {});
    await waitFor(uiUp, drop, SETTLE_MS);
  }
  if (!(await uiUp())) {
    const body = ((await drop.locator('body').first().innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ').slice(0, 160);
    throw new Error(
      `${tag}: ${drop.url()} is not a Nextcloud File drop page (${NC_DROP_SELECTORS.drop} missing; page: "${body}"). ` +
        `Kid fileRequest not applied on this host, or token differs (set DURATION_NC_FILE_REQUEST_URL from hosts.<host>.fileRequestUrl).` +
        (reloaded ? ' [polled, reloaded once, polled again]' : ''),
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
  // Navigation error (timeout / reset) → one more goto; HTTP 4xx stays a loud-fail below.
  const go = () => drop.goto(url, { waitUntil: 'domcontentloaded', timeout: FILE_DROP_GOTO_MS });
  const resp = await go()
    .catch(async () => {
      await drop.waitForTimeout(NC_CLICK_BACKOFF_MS);
      return go();
    })
    .catch((e: unknown) => {
      throw new Error(`${tag}: file request ${url} unreachable (${e instanceof Error ? e.message : String(e)}) [2 goto attempts].`);
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
  // Armed right before the files are set (the PUT cannot start earlier), so click retries
  // never eat into the upload wait.
  let put: Promise<Awaited<ReturnType<Page['waitForResponse']>> | null> = Promise.resolve(null);
  const armPut = () => {
    put = drop
      .waitForResponse(
        (r) => r.request().method() === 'PUT' && /\/public\.php\/dav\/files\//.test(r.url()) && r.url().includes(encodeURIComponent(file.name)),
        { timeout: SETTLE_MS },
      )
      .catch(() => null);
  };

  const ui = drop.locator(NC_DROP_SELECTORS.drop).first();
  const upload = ui.getByRole('button', { name: 'Upload' }).first();
  let chosen = false;
  if (await waitFor(() => ncActionable(upload), drop, 5_000)) {
    // Upload → (menu "Upload files") → file chooser, retried 3× while no chooser opens; a reload
    // of the public drop page is safe (nothing uploaded until a file is chosen).
    const r = await clickUntil(drop, {
      ready: () => ncActionable(upload),
      click: async () => {
        const chooser = drop.waitForEvent('filechooser', { timeout: 8_000 }).catch(() => null);
        await upload.click({ timeout: 8_000 });
        const item = drop.getByRole('menuitem', { name: 'Upload files' }).first();
        if (await waitFor(async () => item.isVisible().catch(() => false), drop, 3_000)) {
          await item.click({ timeout: 8_000 });
        }
        const fc = await chooser;
        if (fc) {
          armPut();
          await fc.setFiles(file);
          chosen = true;
        }
      },
      done: async () => chosen,
      afterReload: () => waitFor(() => ncActionable(upload), drop, SETTLE_MS),
      readyMs: 5_000,
      pollMs: 1_000,
    });
    chosen = r.ok;
  }
  if (!chosen) {
    // UploadPicker's own <input type=file> (same element the chooser drives).
    const input = drop.locator(NC_DROP_SELECTORS.fileInput).first();
    if (!(await waitFor(async () => (await input.count().catch(() => 0)) > 0, drop, 5_000))) {
      throw new Error(`${tag}: File drop page has no Upload button / file input (${drop.url()}).`);
    }
    armPut();
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
