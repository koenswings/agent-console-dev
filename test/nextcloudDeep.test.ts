import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Page } from '@playwright/test';
import {
  ensureNextcloudFiles,
  isNcLoginUrl,
  isNextcloudTabUrl,
  ncFilesDir,
  ncLogout,
  ncPasswordCandidates,
  ncSignedInUser,
  runBrowseFolders,
  runShareToClass,
  runDoneSharing,
  runOpenCollabDoc,
  runCloseDoc,
  ncOpenFileQuery,
  runKeepEditing,
  keepEditingLine,
  keepEditingBudget,
  NC_KEEP_EDITING_BUDGET_MS,
  NC_KEEP_EDITING_REOPENS,
  isGroupShareEntryText,
  ncGroupShareTitle,
  ncOcsFailure,
  ncQuickShareSelected,
  clickUntil,
  ncAttempts,
  NcFatal,
  ncOpenSharingSidebar,
  NC_CLICK_RETRIES,
  NC_RESULT_POLL_MS,
} from '../e2e/intents/nextcloudDeep';
import { DURATION_FIXTURES } from '../e2e/intents/fixtures';

const NC = DURATION_FIXTURES.nextcloud;
const ORIGIN = 'http://idea01:18280';
const filesUrl = (dir: string) =>
  dir === '/' ? `${ORIGIN}/apps/files/files` : `${ORIGIN}/apps/files/files/42?dir=${encodeURIComponent(dir)}`;

describe('Nextcloud URL helpers', () => {
  it('ncFilesDir reads the decoded dir query on /apps/files only', () => {
    expect(ncFilesDir(`${ORIGIN}/apps/files/`)).toBe('/');
    expect(ncFilesDir(`${ORIGIN}/apps/files/files?dir=/`)).toBe('/');
    expect(ncFilesDir(filesUrl('/Grade 5A Files/Class Materials'))).toBe('/Grade 5A Files/Class Materials');
    expect(ncFilesDir(`${ORIGIN}/apps/files/files/7?dir=/Drop%20Zone/`)).toBe('/Drop Zone');
    expect(ncFilesDir(`${ORIGIN}/apps/dashboard/`)).toBeNull();
    expect(ncFilesDir(`${ORIGIN}/login`)).toBeNull();
  });

  it('isNcLoginUrl / isNextcloudTabUrl', () => {
    expect(isNcLoginUrl(`${ORIGIN}/login?redirect_url=/apps/files`)).toBe(true);
    expect(isNcLoginUrl(filesUrl('/'))).toBe(false);
    expect(isNextcloudTabUrl(filesUrl('/'))).toBe(true);
    expect(isNextcloudTabUrl(`${ORIGIN}/login`)).toBe(true);
    expect(isNextcloudTabUrl('http://idea01:18080/en/learn/#/home')).toBe(false);
    expect(isNextcloudTabUrl('http://idea01:18080/en/device/#/content')).toBe(false); // cover-all r9 leftover
    expect(isNextcloudTabUrl('http://idea01:8080/')).toBe(false);
  });

  it('ncPasswordCandidates: Kid live password first, legacy username once', () => {
    expect(ncPasswordCandidates(NC.auth.teacher)).toEqual(['TeacherGrade5A!', 'teacher']);
    expect(ncPasswordCandidates({ username: 'x', password: 'x' })).toEqual(['x']);
  });
});

/** Fake Nextcloud tab: login page + Files folders keyed by dir. */
function fakeNextcloud(opts: {
  start: 'login' | 'files' | 'dashboard';
  accept?: string[];
  tree: Record<string, string[]>;
  uid?: string;
  /** Header Files link renders this long after landing signed in (race repro). */
  navDelayMs?: number;
  /** First-run wizard: intro (Escape only), slides (Close button), stuck (never closes). */
  wizard?: 'intro' | 'slides' | 'stuck';
  /** Wizard opens this long after sign-in (late modal). */
  wizardDelayMs?: number;
  /** Wizard pops up exactly when the Files link is first clicked (late modal race). */
  wizardOnFirstClick?: boolean;
  /** Login form fields (user/password/submit) mount this long after /login is up (r25 race). */
  loginFormDelayMs?: number;
  /** Login form fields never mount until the page is reloaded once. */
  loginFormNeedsReload?: boolean;
  /** The first N folder-row clicks are swallowed (slow Files list, click lands before handlers). */
  dropRowClicks?: number;
}) {
  let url = opts.start === 'login' ? `${ORIGIN}/login` : opts.start === 'files' ? filesUrl('/') : `${ORIGIN}/apps/dashboard/`;
  const fields: Record<string, string> = {};
  const clicks: string[] = [];
  const submitted: string[] = [];
  let uid: string | null = opts.uid ?? null;
  let menuOpen = false;
  let signedInAt = opts.start === 'login' ? Number.POSITIVE_INFINITY : Date.now();
  let wizardDismissed = false;
  let wizardArmed = !opts.wizardOnFirstClick;
  const wizardKeys: string[] = [];
  let loginAt = Date.now();
  let reloads = 0;
  let rowDrops = opts.dropRowClicks ?? 0;
  const loginFieldsUp = () =>
    (!opts.loginFormNeedsReload || reloads > 0) && Date.now() - loginAt >= (opts.loginFormDelayMs ?? 0);
  const wizardUp = () =>
    !!opts.wizard && wizardArmed && !wizardDismissed && !isNcLoginUrl(url) && Date.now() - signedInAt >= (opts.wizardDelayMs ?? 0);
  const dir = () => ncFilesDir(url);
  const rowName = (sel: string) => /data-cy-files-list-row-name="([^"]+)"/.exec(sel)?.[1];
  const menuSels = new Set([
    '#user-menu button',
    'nav#user-menu button',
    '#header-menu-user-menu',
    'button[aria-label="Settings menu"]',
    'button[aria-label="User menu"]',
    '[data-user-menu]',
  ]);
  const logoutSels = new Set(['a[href*="logout"]', '#user-menu a[href*="logout"]', 'li#logout a', '[data-id="logout"] a']);
  const present = (sel: string): boolean => {
    const onLogin = isNcLoginUrl(url);
    if (sel === '#firstrunwizard') return wizardUp();
    if (sel === '#firstrunwizard button[aria-label="Close"]') return wizardUp() && opts.wizard !== 'intro';
    if (sel === '#firstrunwizard .header-close') return false;
    if (sel === '[data-login-form]') return onLogin;
    if (sel === 'input#password' || sel === 'input#user' || sel === '[data-login-form-submit]') return onLogin && loginFieldsUp();
    if (sel === '[data-cy-files-content-breadcrumbs]') return dir() !== null;
    if (sel.startsWith('[data-cy-files-content-breadcrumbs] a')) return dir() !== null;
    if (sel === 'nav.app-menu a[href$="/apps/files/"]') return !onLogin && Date.now() - signedInAt >= (opts.navDelayMs ?? 0);
    if (menuSels.has(sel)) return !onLogin;
    if (logoutSels.has(sel)) return !onLogin && menuOpen;
    if (sel === 'head') return !onLogin;
    const name = rowName(sel);
    if (name && dir() !== null) return (opts.tree[dir()!] ?? []).includes(name);
    return false;
  };
  const page = {
    url: () => url,
    async waitForTimeout(ms: number) {
      vi.setSystemTime(Date.now() + ms);
    },
    async reload() {
      reloads++;
      loginAt = Date.now();
    },
    keyboard: {
      async press(k: string) {
        wizardKeys.push(k);
        if (k === 'Escape' && wizardUp() && opts.wizard !== 'stuck') wizardDismissed = true;
      },
    },
    locator(sel: string) {
      const first = {
        async count() {
          return present(sel) ? 1 : 0;
        },
        async fill(v: string) {
          fields[sel] = v;
        },
        async getAttribute(name: string) {
          return sel === 'head' && name === 'data-user' ? uid : null;
        },
        async isVisible() {
          return present(sel);
        },
        async isEnabled() {
          return present(sel);
        },
        async click() {
          if (!present(sel)) throw new Error(`not present: ${sel}`);
          if (!wizardArmed && sel === 'nav.app-menu a[href$="/apps/files/"]') wizardArmed = true;
          if (wizardUp() && !sel.startsWith('#firstrunwizard') && !menuSels.has(sel) && !logoutSels.has(sel)) {
            throw new Error('locator.click: Timeout 5000ms exceeded.\n  - div#firstrunwizard subtree intercepts pointer events');
          }
          clicks.push(sel);
          if (menuSels.has(sel)) {
            menuOpen = true;
            return;
          }
          if (logoutSels.has(sel)) {
            url = `${ORIGIN}/login`;
            uid = null;
            menuOpen = false;
            signedInAt = Number.POSITIVE_INFINITY;
            return;
          }
          if (sel === '#firstrunwizard button[aria-label="Close"]') {
            if (opts.wizard !== 'stuck') wizardDismissed = true;
            return;
          }
          if (sel === '[data-login-form-submit]') {
            const pw = fields['input#password'] ?? '';
            submitted.push(pw);
            if ((opts.accept ?? []).includes(pw)) {
              url = `${ORIGIN}/apps/dashboard/`;
              signedInAt = Date.now();
              uid = fields['input#user'] ?? uid;
              menuOpen = false;
            }
            return;
          }
          if (sel === 'nav.app-menu a[href$="/apps/files/"]') url = filesUrl('/');
          else if (sel.startsWith('[data-cy-files-content-breadcrumbs] a')) url = filesUrl('/');
          else {
            const name = rowName(sel);
            if (name && rowDrops > 0) rowDrops--;
            else if (name) url = filesUrl(`${dir() === '/' ? '' : dir()}/${name}`);
          }
        },
      };
      return {
        first: () => first,
        count: first.count,
        async evaluateAll() {
          return dir() !== null ? (opts.tree[dir()!] ?? []) : [];
        },
      };
    },
  };
  return {
    page: page as unknown as Page,
    clicks,
    submitted,
    wizardKeys,
    wizardGone: () => wizardDismissed,
    getUid: () => uid,
    reloads: () => reloads,
  };
}

describe('ensureNextcloudFiles (verified sign-in)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T14:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('signs in with the Kid live password, then opens Files from the header', async () => {
    const { page, submitted } = fakeNextcloud({ start: 'login', accept: ['TeacherGrade5A!'], tree: { '/': ['Grade 5A Files'] } });
    await ensureNextcloudFiles(page, 't', NC.auth.teacher);
    expect(submitted).toEqual(['TeacherGrade5A!']);
    expect(ncFilesDir(page.url())).toBe('/');
  });

  it('race: waits for the dashboard header Files link after leaving /login (Axle 2da863c-r1)', async () => {
    const { page, clicks } = fakeNextcloud({
      start: 'login',
      accept: ['TeacherGrade5A!'],
      tree: { '/': ['Class Materials'] },
      navDelayMs: 1_500,
    });
    await ensureNextcloudFiles(page, 'idea#166 open_nextcloud_as_teacher', NC.auth.teacher);
    expect(clicks).toContain('nav.app-menu a[href$="/apps/files/"]');
    expect(ncFilesDir(page.url())).toBe('/');
  });

  it('race: same wait for an existing session landing on the dashboard (learner path)', async () => {
    const { page } = fakeNextcloud({
      start: 'dashboard',
      tree: { '/': [] },
      navDelayMs: 3_000,
      uid: NC.auth.learner.username,
    });
    await ensureNextcloudFiles(page, 'idea#166 open_nextcloud_as_learner', NC.auth.learner);
    expect(ncFilesDir(page.url())).toBe('/');
    expect(await ncSignedInUser(page)).toBe(NC.auth.learner.username);
  });

  it('loud-fails with page state when the Files link never renders within SETTLE_MS', async () => {
    const { page } = fakeNextcloud({ start: 'login', accept: ['TeacherGrade5A!'], tree: {}, navDelayMs: 60_000 });
    await expect(ensureNextcloudFiles(page, 'idea#166 open_nextcloud_as_teacher', NC.auth.teacher)).rejects.toThrow(
      /signed in but no Files app link in the Nextcloud header within 20000ms on http:\/\/idea01:18280\/apps\/dashboard\/ \(title=.*header links: .*tried nav\.app-menu/,
    );
  });

  it('First-run wizard (slides): clicks its Close button before the Files link (Axle 198eb69-r1)', async () => {
    const f = fakeNextcloud({ start: 'login', accept: ['TeacherGrade5A!'], tree: { '/': [] }, wizard: 'slides' });
    await ensureNextcloudFiles(f.page, 'idea#166 open_nextcloud_as_teacher', NC.auth.teacher);
    expect(f.clicks.indexOf('#firstrunwizard button[aria-label="Close"]')).toBeGreaterThanOrEqual(0);
    expect(f.clicks.indexOf('#firstrunwizard button[aria-label="Close"]')).toBeLessThan(
      f.clicks.indexOf('nav.app-menu a[href$="/apps/files/"]'),
    );
    expect(f.wizardKeys).toEqual([]);
    expect(f.wizardGone()).toBe(true);
    expect(ncFilesDir(f.page.url())).toBe('/');
  });

  it('First-run wizard (intro video, no button): Escape closes it, learner path too', async () => {
    const f = fakeNextcloud({
      start: 'dashboard',
      tree: { '/': [] },
      wizard: 'intro',
      uid: NC.auth.learner.username,
    });
    await ensureNextcloudFiles(f.page, 'idea#166 open_nextcloud_as_learner', NC.auth.learner);
    expect(f.wizardKeys).toEqual(['Escape']);
    expect(ncFilesDir(f.page.url())).toBe('/');
  });

  it('First-run wizard opening late intercepts the Files click: dismiss and retry', async () => {
    const f = fakeNextcloud({ start: 'login', accept: ['TeacherGrade5A!'], tree: { '/': [] }, wizard: 'slides', wizardOnFirstClick: true });
    await ensureNextcloudFiles(f.page, 't', NC.auth.teacher);
    expect(f.wizardGone()).toBe(true);
    // first Files click was intercepted (not recorded), then Close, then the Files click landed
    expect(f.clicks.filter((c) => c.startsWith('#firstrunwizard') || c.startsWith('nav.app-menu'))).toEqual([
      '#firstrunwizard button[aria-label="Close"]',
      'nav.app-menu a[href$="/apps/files/"]',
    ]);
    expect(ncFilesDir(f.page.url())).toBe('/');
  });

  it('loud-fails when the First-run wizard cannot be dismissed', async () => {
    const f = fakeNextcloud({ start: 'login', accept: ['TeacherGrade5A!'], tree: { '/': [] }, wizard: 'stuck' });
    await expect(ensureNextcloudFiles(f.page, 'idea#166 open_nextcloud_as_teacher', NC.auth.teacher)).rejects.toThrow(
      /First-run wizard \(#firstrunwizard\) still blocks the page after close, close, close, close/,
    );
    expect(f.clicks).not.toContain('nav.app-menu a[href$="/apps/files/"]');
  });

  it('r25 FAIL@27: waits for late login form fields before filling (learner path, no reload)', async () => {
    const f = fakeNextcloud({ start: 'login', accept: [NC.auth.learner.password], tree: { '/': [] }, loginFormDelayMs: 6_000 });
    await ensureNextcloudFiles(f.page, 'idea#166 open_nextcloud_as_learner', NC.auth.learner);
    expect(f.submitted).toEqual([NC.auth.learner.password]);
    expect(f.reloads()).toBe(0);
    expect(ncFilesDir(f.page.url())).toBe('/');
  });

  it('r25 FAIL@27: login form still missing after the wait → reload once, then signs in', async () => {
    const f = fakeNextcloud({ start: 'login', accept: ['TeacherGrade5A!'], tree: { '/': [] }, loginFormNeedsReload: true });
    await ensureNextcloudFiles(f.page, 'idea#166 open_nextcloud_as_teacher', NC.auth.teacher);
    expect(f.reloads()).toBe(1);
    expect(f.submitted).toEqual(['TeacherGrade5A!']);
    expect(ncFilesDir(f.page.url())).toBe('/');
  });

  it('r25 FAIL@27: loud-fails "login form incomplete" only after wait + one reload + wait', async () => {
    const f = fakeNextcloud({ start: 'login', accept: [], tree: {}, loginFormDelayMs: Number.POSITIVE_INFINITY });
    const t0 = Date.now();
    await expect(ensureNextcloudFiles(f.page, 'idea#166 open_nextcloud_as_learner', NC.auth.learner)).rejects.toThrow(
      /open_nextcloud_as_learner: Nextcloud login form incomplete on http:\/\/idea01:18280\/login \(user=false password=false submit=false\)/,
    );
    expect(f.reloads()).toBe(1);
    expect(f.submitted).toEqual([]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(40_000);
  });

  it('falls back once to the legacy password=username', async () => {
    const { page, submitted } = fakeNextcloud({ start: 'login', accept: ['teacher'], tree: { '/': [] } });
    await ensureNextcloudFiles(page, 't', NC.auth.teacher);
    expect(submitted).toEqual(['TeacherGrade5A!', 'teacher']);
  });

  it('loud-fails when Nextcloud refuses both passwords', async () => {
    const { page } = fakeNextcloud({ start: 'login', accept: [], tree: {} });
    await expect(ensureNextcloudFiles(page, 'idea#166 open_nextcloud_as_teacher', NC.auth.teacher)).rejects.toThrow(
      /refused teacher \(tried configured, legacy=username\).*DURATION_NC_TEACHER_PASSWORD/,
    );
  });

  it('deep Intents (no creds) loud-fail on the login page instead of guessing a role', async () => {
    const { page, submitted } = fakeNextcloud({ start: 'login', accept: ['TeacherGrade5A!'], tree: {} });
    await expect(ensureNextcloudFiles(page, 'idea#166 browse_folders', null)).rejects.toThrow(/not signed in/);
    expect(submitted).toEqual([]);
  });

  it('cover-all-aeef795-r12: teacher session + learner creds → logout, sign in as learner, Files uid matches', async () => {
    const f = fakeNextcloud({
      start: 'files',
      uid: NC.auth.teacher.username,
      accept: ['Student01Grade5A!'],
      tree: { '/': [] },
    });
    await ensureNextcloudFiles(f.page, 'idea#166 open_nextcloud_as_learner', NC.auth.learner);
    expect(f.clicks).toContain('#user-menu button');
    expect(f.clicks).toContain('a[href*="logout"]');
    expect(f.submitted).toEqual(['Student01Grade5A!']);
    expect(ncFilesDir(f.page.url())).toBe('/');
    expect(await ncSignedInUser(f.page)).toBe(NC.auth.learner.username);
  });

  it('already signed in as learner + learner creds → no logout', async () => {
    const f = fakeNextcloud({
      start: 'files',
      uid: NC.auth.learner.username,
      tree: { '/': [] },
    });
    await ensureNextcloudFiles(f.page, 'idea#166 open_nextcloud_as_learner', NC.auth.learner);
    expect(f.clicks.filter((c) => c.includes('logout') || c.includes('user-menu'))).toEqual([]);
    expect(f.submitted).toEqual([]);
    expect(await ncSignedInUser(f.page)).toBe(NC.auth.learner.username);
  });

  it('already signed in as teacher + teacher creds → no logout', async () => {
    const f = fakeNextcloud({
      start: 'files',
      uid: NC.auth.teacher.username,
      tree: { '/': [] },
    });
    await ensureNextcloudFiles(f.page, 'idea#166 open_nextcloud_as_teacher', NC.auth.teacher);
    expect(f.clicks.filter((c) => c.includes('logout') || c.includes('user-menu'))).toEqual([]);
    expect(f.submitted).toEqual([]);
    expect(await ncSignedInUser(f.page)).toBe(NC.auth.teacher.username);
  });

  it('deep Intents (null creds) leave a leftover teacher session alone (no logout)', async () => {
    const f = fakeNextcloud({ start: 'files', uid: NC.auth.teacher.username, tree: { '/': ['Class Materials'] } });
    // browse path uses null creds; role gates stay in share/file-drop
    await ensureNextcloudFiles(f.page, 'idea#166 browse_folders', null);
    expect(f.clicks.filter((c) => c.includes('logout'))).toEqual([]);
    expect(await ncSignedInUser(f.page)).toBe(NC.auth.teacher.username);
  });
});

describe('ncLogout', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T14:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('opens the user menu and lands on /login', async () => {
    const f = fakeNextcloud({ start: 'files', uid: 'teacher', tree: { '/': [] } });
    await ncLogout(f.page, 't');
    expect(isNcLoginUrl(f.page.url())).toBe(true);
    expect(f.clicks).toEqual(['#user-menu button', 'a[href*="logout"]']);
    expect(await ncSignedInUser(f.page)).toBeNull();
  });
});

describe('runBrowseFolders', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T14:10:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  const classFolders = ['Class Materials', 'Drop Zone', 'Collab'];

  it('opens each class folder inside the Files Disk mount folder, proven by dir', async () => {
    const { page } = fakeNextcloud({
      start: 'files',
      tree: { '/': ['Grade 5A Files', 'Documents'], '/Grade 5A Files': classFolders },
    });
    const visited = await runBrowseFolders(page);
    expect(visited).toEqual([
      '/Grade 5A Files/Class Materials',
      '/Grade 5A Files/Drop Zone',
      '/Grade 5A Files/Collab',
    ]);
    expect(ncFilesDir(page.url())).toBe('/Grade 5A Files');
  });

  it('works when the class folders sit at the Files root', async () => {
    const { page } = fakeNextcloud({ start: 'files', tree: { '/': classFolders } });
    expect(await runBrowseFolders(page)).toEqual(['/Class Materials', '/Drop Zone', '/Collab']);
  });

  it('loud-fails with the root listing when the class folders are absent', async () => {
    const { page } = fakeNextcloud({ start: 'files', tree: { '/': ['Documents', 'Photos'] } });
    await expect(runBrowseFolders(page)).rejects.toThrow(
      /neither "Class Materials" nor the Files Disk folder "Grade 5A Files".*rows: Documents, Photos/,
    );
  });

  it('loud-fails naming the missing folder', async () => {
    const { page } = fakeNextcloud({ start: 'files', tree: { '/': ['Class Materials', 'Collab'] } });
    await expect(runBrowseFolders(page)).rejects.toThrow(/folder "Drop Zone" not listed in \/ .*rows: Class Materials, Collab/);
  });
});

describe('share_to_class helpers (NC 31.0.1 sharing markup)', () => {
  it('group entry title matches SharingEntry.vue "<name> (group)", owner suffix allowed', () => {
    expect(ncGroupShareTitle('Grade 5A')).toBe('Grade 5A (group)');
    expect(isGroupShareEntryText(' Grade 5A (group)\n', 'Grade 5A')).toBe(true);
    expect(isGroupShareEntryText('Grade 5A (group) by admin', 'Grade 5A')).toBe(true);
    expect(isGroupShareEntryText('Grade 5AB (group)', 'Grade 5A')).toBe(false);
    expect(isGroupShareEntryText('Grade 5A', 'Grade 5A')).toBe(false);
  });

  it('reads the quick-share selection from aria-label or visible name', () => {
    expect(ncQuickShareSelected('Quick share options, the current selected is "View only"')).toBe('View only');
    expect(ncQuickShareSelected('Quick share options, the current selected is "Can edit"')).toBe('Can edit');
    expect(ncQuickShareSelected(' View only ')).toBe('View only');
    expect(ncQuickShareSelected('')).toBeNull();
  });

  it('ncOcsFailure surfaces HTTP / OCS errors, passes ok', () => {
    expect(ncOcsFailure(200, { ocs: { meta: { status: 'ok', statuscode: 200 } } })).toBeNull();
    expect(ncOcsFailure(403, { ocs: { meta: { status: 'failure', statuscode: 403, message: 'Sharing is not allowed' } } })).toBe(
      'HTTP 403 / OCS 403: Sharing is not allowed',
    );
    expect(ncOcsFailure(200, { ocs: { meta: { status: 'failure', statuscode: 404, message: 'Wrong path' } } })).toMatch(/OCS 404: Wrong path/);
    expect(ncOcsFailure(500, null)).toBe('HTTP 500');
  });
});

describe('runShareToClass guards', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T14:20:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('loud-fails on a learner session before touching the sharing UI', async () => {
    const { page, clicks } = fakeNextcloud({ start: 'files', uid: 'student01', tree: { '/': ['Class Materials'] } });
    await expect(runShareToClass(page)).rejects.toThrow(/needs the teacher session; Nextcloud is signed in as student01/);
    expect(clicks).toEqual([]);
  });

  it('loud-fails on the login page (no role guessing)', async () => {
    const { page } = fakeNextcloud({ start: 'login', accept: ['TeacherGrade5A!'], tree: {} });
    await expect(runShareToClass(page)).rejects.toThrow(/not signed in/);
  });
});

/** Fake NC tab in nc_share: Files dir + sidebar (Sharing tab / editor / close button). */
function fakeShareState(o: { uid?: string; sidebar?: boolean; tab?: boolean; editor?: boolean; stuck?: boolean; ignoreCloseClicks?: number }) {
  let ignore = o.ignoreCloseClicks ?? 0;
  const url = filesUrl('/Grade 5A Files');
  const s = { sidebar: o.sidebar ?? true, tab: o.tab ?? true, editor: o.editor ?? false };
  const clicks: string[] = [];
  const visible = (sel: string): boolean => {
    if (sel.endsWith('[data-cy-sidebar]') || sel.endsWith('#app-sidebar-vue')) return s.sidebar;
    if (!s.sidebar && sel.startsWith('[data-cy-sidebar] ')) return false;
    if (sel.endsWith('.sharingTabDetailsView')) return s.editor;
    if (sel.endsWith('.app-sidebar__close')) return s.sidebar;
    if (sel.endsWith('[aria-controls="tab-sharing"]')) return s.sidebar;
    if (sel === '[data-cy-files-content-breadcrumbs]') return true;
    return false;
  };
  const L = (sel: string): unknown => ({
    first: () => L(sel),
    locator: (sub: string) => L(`${sel} ${sub}`),
    count: async () => (visible(sel) ? 1 : 0),
    isVisible: async () => visible(sel),
    isEnabled: async () => visible(sel),
    getAttribute: async (name: string) => {
      if (sel === 'head' && name === 'data-user') return o.uid ?? 'teacher';
      if (sel.endsWith('[aria-controls="tab-sharing"]') && name === 'aria-selected') return s.tab ? 'true' : 'false';
      return null;
    },
    click: async () => {
      if (!visible(sel)) throw new Error(`not visible: ${sel}`);
      clicks.push(sel);
      if (sel.endsWith('.app-sidebar__close') && ignore > 0) ignore--;
      else if (sel.endsWith('.app-sidebar__close') && !o.stuck) s.sidebar = false;
    },
  });
  const page = {
    url: () => url,
    waitForTimeout: async (ms: number) => {
      vi.setSystemTime(Date.now() + ms);
    },
    locator: (sel: string) => L(sel),
  };
  return { page: page as unknown as Page, clicks, s };
}

describe('runDoneSharing (nc_share → nc_browse)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T14:30:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('closes the sharing sidebar and stays in the same Files folder', async () => {
    const { page, clicks, s } = fakeShareState({});
    expect(await runDoneSharing(page)).toBe('/Grade 5A Files');
    expect(s.sidebar).toBe(false);
    expect(clicks).toEqual(['[data-cy-sidebar] .app-sidebar__close']);
  });

  it('loud-fails when no sidebar is open (not nc_share)', async () => {
    const { page } = fakeShareState({ sidebar: false });
    await expect(runDoneSharing(page)).rejects.toThrow(/not in nc_share: no Files sidebar open.*share_to_class first/);
  });

  it('loud-fails when the sidebar is not on the Sharing tab', async () => {
    const { page } = fakeShareState({ tab: false });
    await expect(runDoneSharing(page)).rejects.toThrow(/not on the Sharing tab/);
  });

  it('loud-fails while the share editor is still open (unsaved)', async () => {
    const { page, clicks } = fakeShareState({ editor: true });
    await expect(runDoneSharing(page)).rejects.toThrow(/share editor still open/);
    expect(clicks).toEqual([]);
  });

  it('loud-fails on a learner session', async () => {
    const { page } = fakeShareState({ uid: 'student01' });
    await expect(runDoneSharing(page)).rejects.toThrow(/teacher state; Nextcloud is signed in as student01/);
  });

  it('loud-fails when Close sidebar does not close it', async () => {
    const { page } = fakeShareState({ stuck: true });
    await expect(runDoneSharing(page)).rejects.toThrow(/still open/);
  });
});

/** Fake NC Files + Viewer: folders keyed by dir, files open in #viewer. */
function fakeCollab(o: {
  tree: Record<string, string[]>;
  files: string[];
  start?: string;
  viewer?: 'opens' | 'downloads';
  title?: string;
  content?: string;
  stuckClose?: boolean;
  text?: boolean;
  readonly?: boolean;
  push?: number | null;
  echo?: boolean;
  /** The first N clicks on a file row are swallowed (Viewer not yet registered). */
  ignoreFileClicks?: number;
  /** Text stays non-editable until the doc was (re)opened this many times (file click or page reload). */
  editableAfterReopens?: number;
  /** Text never becomes editable (sync keeps failing, no Text UI to act on). */
  neverEditable?: boolean;
  /** Sync HTTP 409: Text collision notice + "Use the saved version" until clicked ('sticky' = never clears). */
  collision?: 'resolvable' | 'sticky';
  /** DocumentStatus "Document could not be loaded…" + Reconnect until Reconnect is clicked. */
  connectionIssue?: boolean;
}) {
  let ignoreFile = o.ignoreFileClicks ?? 0;
  /** Viewer opens so far (a doc that starts open counts once); reopens = opens - 1. */
  let opens = 0;
  let collisionOn = !!o.collision;
  let connectionOn = !!o.connectionIssue;
  const pushes: number[] = [];
  const waiters: { pred: (r: unknown) => boolean; res: (r: unknown) => void; rej: (e: Error) => void }[] = [];
  const pushResponse = (status: number) => {
    const at = Date.now();
    return {
      url: () => `${ORIGIN}/apps/text/session/77/push`,
      status: () => status,
      request: () => ({ method: () => 'POST', timing: () => ({ startTime: at }) }),
    };
  };
  /** Browser sends a Text push now; the first waiter whose predicate accepts it gets it. */
  const emitPush = (status: number) => {
    pushes.push(Date.now());
    const r = pushResponse(status);
    const i = waiters.findIndex((w) => w.pred(r));
    if (i >= 0) waiters.splice(i, 1)[0]!.res(r);
  };
  let url = o.start ?? filesUrl('/');
  let viewer = o.start ? ncOpenFileQuery(o.start) : false;
  if (viewer) opens = 1;
  const clicks: string[] = [];
  let typed = '';
  const keys: string[] = [];
  const text = o.text ?? true;
  const dir = () => ncFilesDir(url);
  const rowName = (sel: string) => /data-cy-files-list-row-name="([^"]+)"/.exec(sel)?.[1];
  const withQuery = (d: string, open: boolean) => `${filesUrl(d).split('?')[0]}?dir=${encodeURIComponent(d)}${open ? '&openfile=true' : ''}`;
  const editableNow = () =>
    text && !o.readonly && !o.neverEditable && !collisionOn && !connectionOn && opens - 1 >= (o.editableAfterReopens ?? 0);
  const present = (sel: string): boolean => {
    if (sel.startsWith('#viewer')) {
      if (!viewer) return false;
      if (sel.endsWith('[data-text-el="editor-container"]')) return text;
      if (sel.endsWith('[data-text-el="readonly-bar"]')) return text && !!o.readonly;
      if (sel.endsWith('.ProseMirror[contenteditable="true"]') || sel.endsWith('[data-text-el="menubar"]')) return editableNow();
      if (sel.endsWith('[data-text-el="editor-content-wrapper"] .ProseMirror')) return text;
      if (sel.endsWith('#resolve-conflicts') || sel.endsWith('[data-cy="resolveServerVersion"]')) return text && collisionOn;
      if (sel.endsWith('.document-status a.button')) return text && connectionOn;
      if (sel.endsWith('.document-status')) return text && (collisionOn || connectionOn);
      return sel === '#viewer' || sel.endsWith('.modal-header__name') || sel.endsWith('.header-close');
    }
    if (sel === '[data-cy-files-content-breadcrumbs]' || sel.startsWith('[data-cy-files-content-breadcrumbs] a')) return dir() !== null;
    const name = rowName(sel);
    if (name && dir() !== null) return (o.tree[dir()!] ?? []).includes(name);
    return false;
  };
  const L = (sel: string): unknown => ({
    first: () => L(sel),
    count: async () => (present(sel) ? 1 : 0),
    isVisible: async () => present(sel),
    isEnabled: async () => present(sel),
    getAttribute: async (n: string) => (sel === 'head' && n === 'data-user' ? 'student01' : null),
    innerText: async () => {
      if (!present(sel)) throw new Error('detached');
      if (sel.endsWith('.modal-header__name')) return o.title ?? 'Grade5A-collab-notes.md';
      if (sel.endsWith('.document-status a.button')) return 'Reconnect';
      if (sel.endsWith('.document-status')) {
        return collisionOn
          ? 'Document has been changed outside of the editor. The changes cannot be applied'
          : 'Document could not be loaded. Please check your internet connection. Reconnect';
      }
      const doc = (o.content ?? '# Grade 5A collab notes\nShared class notes') + typed;
      if (sel === '#viewer' || sel.endsWith('[data-text-el="editor-container"]') || sel.endsWith('.ProseMirror[contenteditable="true"]')) return doc;
      return '';
    },
    evaluateAll: async () => (dir() !== null ? (o.tree[dir()!] ?? []) : []),
    click: async () => {
      if (!present(sel)) throw new Error(`not present: ${sel}`);
      clicks.push(sel);
      if (sel.endsWith('[data-cy="resolveServerVersion"]')) {
        // Text: setContent(outsideChange) + forceSave → a push BEFORE the walker types.
        if (o.collision === 'resolvable') collisionOn = false;
        emitPush(200);
        return;
      }
      if (sel.endsWith('.document-status a.button')) {
        connectionOn = false;
        return;
      }
      if (sel.endsWith('.header-close')) {
        if (!o.stuckClose) {
          viewer = false;
          url = withQuery(dir()!, false);
        }
        return;
      }
      if (sel.startsWith('[data-cy-files-content-breadcrumbs] a')) {
        url = filesUrl('/');
        return;
      }
      const name = rowName(sel)!;
      if (o.files.includes(name)) {
        if (ignoreFile > 0) {
          ignoreFile--;
          return;
        }
        if ((o.viewer ?? 'opens') === 'opens') {
          if (!viewer) opens++;
          viewer = true;
          url = withQuery(dir()!, true);
        }
        return;
      }
      url = withQuery(`${dir() === '/' ? '' : dir()}/${name}`, false);
    },
  });
  const page = {
    url: () => url,
    waitForTimeout: async (ms: number) => {
      vi.setSystemTime(Date.now() + ms);
    },
    locator: (sel: string) => L(sel),
    /** ?openfile reopens the Viewer (a fresh Text session) on reload. */
    reload: async () => {
      viewer = ncOpenFileQuery(url);
      if (viewer) opens++;
    },
    keyboard: {
      press: async (k: string) => {
        keys.push(k);
      },
      type: async (s: string) => {
        if (o.echo ?? true) typed += `\n${s}`;
        if (typeof o.push === 'number') emitPush(o.push);
        // No push for this edit: every pending waiter times out.
        else waiters.splice(0).forEach((w) => w.rej(new Error('timeout')));
      },
    },
    waitForResponse: (pred: (r: unknown) => boolean) =>
      new Promise((res, rej) => {
        waiters.push({ pred, res, rej });
      }),
  };
  return {
    page: page as unknown as Page,
    clicks,
    keys,
    typed: () => typed,
    isViewerOpen: () => viewer,
    reopens: () => Math.max(0, opens - 1),
    pushes,
  };
}

describe('open_collab_doc / close_doc (Nextcloud Text in the Viewer)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T14:40:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  const tree = {
    '/': ['Grade 5A Files'],
    '/Grade 5A Files': ['Class Materials', 'Drop Zone', 'Collab'],
    '/Grade 5A Files/Collab': ['Grade5A-collab-notes.md'],
  };
  const files = ['Grade5A-collab-notes.md'];

  it('ncOpenFileQuery follows the Files openfile rule', () => {
    expect(ncOpenFileQuery(`${ORIGIN}/apps/files/files/9?dir=/Collab&openfile=true`)).toBe(true);
    expect(ncOpenFileQuery(`${ORIGIN}/apps/files/files/9?dir=/Collab&openfile`)).toBe(true);
    expect(ncOpenFileQuery(`${ORIGIN}/apps/files/files/9?dir=/Collab&openfile=false`)).toBe(false);
    expect(ncOpenFileQuery(`${ORIGIN}/apps/files/files/9?dir=/Collab`)).toBe(false);
  });

  it('opens Collab/Grade5A-collab-notes.md in the Viewer, then close_doc returns to Collab', async () => {
    const f = fakeCollab({ tree, files });
    expect(await runOpenCollabDoc(f.page)).toBe('/Grade 5A Files/Collab');
    expect(f.isViewerOpen()).toBe(true);
    expect(await runCloseDoc(f.page)).toBe('/Grade 5A Files/Collab');
    expect(f.isViewerOpen()).toBe(false);
    expect(ncOpenFileQuery(f.page.url())).toBe(false);
  });

  it('loud-fails when the file is downloaded instead of opening the Viewer', async () => {
    const f = fakeCollab({ tree, files, viewer: 'downloads' });
    await expect(runOpenCollabDoc(f.page)).rejects.toThrow(/did not open the Nextcloud Viewer/);
  });

  it('loud-fails when the Viewer shows another file or no doc content', async () => {
    await expect(runOpenCollabDoc(fakeCollab({ tree, files, title: 'welcome.txt' }).page)).rejects.toThrow(
      /Viewer opened "welcome.txt"/,
    );
    await expect(runOpenCollabDoc(fakeCollab({ tree, files, content: 'Loading…' }).page)).rejects.toThrow(
      /never rendered the doc heading/,
    );
    await expect(runOpenCollabDoc(fakeCollab({ tree, files, text: false }).page)).rejects.toThrow(
      /not in Nextcloud Text/,
    );
  });

  it('loud-fails naming the rows when the placeholder doc is missing', async () => {
    const f = fakeCollab({ tree: { ...tree, '/Grade 5A Files/Collab': ['old.md'] }, files });
    await expect(runOpenCollabDoc(f.page)).rejects.toThrow(/"Grade5A-collab-notes.md" not listed in \/Grade 5A Files\/Collab \(rows: old.md\)/);
  });

  it('close_doc loud-fails when no Viewer is open, or Close does not close it', async () => {
    await expect(runCloseDoc(fakeCollab({ tree, files }).page)).rejects.toThrow(/not in nc_collab/);
    const stuck = fakeCollab({ tree, files, stuckClose: true });
    await runOpenCollabDoc(stuck.page);
    await expect(runCloseDoc(stuck.page)).rejects.toThrow(/Viewer is still open/);
  });
});

describe('keep_editing (Nextcloud Text, Kid Prefer A)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T15:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  const tree = { '/': ['Collab'], '/Collab': ['Grade5A-collab-notes.md'] };
  const files = ['Grade5A-collab-notes.md'];
  const opened = (o: Partial<Parameters<typeof fakeCollab>[0]> = {}) =>
    fakeCollab({ tree, files, start: `${ORIGIN}/apps/files/files/9?dir=%2FCollab&openfile=true`, push: 200, ...o });
  const at = new Date('2026-10-05T15:00:00.000Z');

  it('appends a unique line at the end of the doc and requires the Text session push', async () => {
    const f = opened();
    expect(await runKeepEditing(f.page, at)).toBe('keep_editing 2026-10-05T15:00:00.000Z');
    expect(f.keys).toEqual(['Control+End', 'Enter']);
    expect(f.typed()).toContain(keepEditingLine(at));
  });

  it('loud-fails read-only (Kid collab apply pending) without typing', async () => {
    const f = opened({ readonly: true });
    await expect(runKeepEditing(f.page, at)).rejects.toThrow(/read-only .*collabProvisioned=false/);
    expect(f.keys).toEqual([]);
  });

  it('loud-fails when the edit is not pushed or is rejected', async () => {
    await expect(runKeepEditing(opened({ push: null }).page, at)).rejects.toThrow(/never pushed the edit/);
    await expect(runKeepEditing(opened({ push: 403 }).page, at)).rejects.toThrow(/push rejected \(HTTP 403\)/);
  });

  it('loud-fails when the typed line never shows in the editor', async () => {
    await expect(runKeepEditing(opened({ echo: false }).page, at)).rejects.toThrow(/does not appear in the Text editor/);
  });

  it('loud-fails outside nc_collab or on another file / non-Text viewer', async () => {
    await expect(runKeepEditing(fakeCollab({ tree, files, push: 200 }).page, at)).rejects.toThrow(/not in nc_collab/);
    await expect(runKeepEditing(opened({ title: 'welcome.txt' }).page, at)).rejects.toThrow(/Viewer shows "welcome.txt"/);
    await expect(runKeepEditing(opened({ text: false }).page, at)).rejects.toThrow(/not open in Nextcloud Text/);
  });
});

describe('keep_editing editable wait (r37 FAIL@82: Text sync 409, editor never editable)', () => {
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T08:11:42Z'));
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    log.mockRestore();
    vi.useRealTimers();
  });

  /** Full class tree so a reopen goes through the real Files UI (close_doc + open_collab_doc). */
  const tree = {
    '/': ['Grade 5A Files'],
    '/Grade 5A Files': ['Class Materials', 'Drop Zone', 'Collab'],
    '/Grade 5A Files/Collab': ['Grade5A-collab-notes.md'],
  };
  const files = ['Grade5A-collab-notes.md'];
  const opened = (o: Partial<Parameters<typeof fakeCollab>[0]> = {}) =>
    fakeCollab({
      tree,
      files,
      start: `${ORIGIN}/apps/files/files/9?dir=${encodeURIComponent('/Grade 5A Files/Collab')}&openfile=true`,
      push: 200,
      ...o,
    });
  const at = new Date('2026-10-06T08:11:42.000Z');
  const knobs = { budgetMs: NC_KEEP_EDITING_BUDGET_MS, reopens: NC_KEEP_EDITING_REOPENS };
  const recoveryEvents = () =>
    log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"event":"keep_editing_recovery"'));

  it('editable on the first try: no reopen, no recovery, types once and needs the push', async () => {
    const f = opened();
    const t0 = Date.now();
    expect(await runKeepEditing(f.page, at, knobs)).toBe('keep_editing 2026-10-06T08:11:42.000Z');
    expect(f.reopens()).toBe(0);
    expect(f.clicks.filter((c) => c.endsWith('.header-close'))).toEqual([]);
    expect(f.keys).toEqual(['Control+End', 'Enter']);
    expect(f.typed()).toBe(`\n${keepEditingLine(at)}`);
    expect(recoveryEvents()).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it('editable after one reopen: closes and reopens the doc via the Files UI, then types and needs the push', async () => {
    const f = opened({ editableAfterReopens: 1 });
    expect(await runKeepEditing(f.page, at, knobs)).toBe(keepEditingLine(at));
    expect(f.reopens()).toBe(1);
    // Real UI: Viewer Close, then the file row link in Collab.
    expect(f.clicks.filter((c) => c.endsWith('.header-close'))).toHaveLength(1);
    expect(f.clicks.filter((c) => c.includes('Grade5A-collab-notes.md'))).toHaveLength(1);
    expect(f.keys).toEqual(['Control+End', 'Enter']);
    const ev = recoveryEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatch(/reopened \\"Grade5A-collab-notes.md\\" via Files/);
  });

  it('page reload reopens the doc when the Viewer Close is stuck (fresh Text session via ?openfile)', async () => {
    const f = opened({ editableAfterReopens: 2, stuckClose: true });
    expect(await runKeepEditing(f.page, at, knobs)).toBe(keepEditingLine(at));
    expect(f.reopens()).toBeGreaterThanOrEqual(2);
    expect(recoveryEvents()[0]).toMatch(/page reload \(reopen via Files failed\)/);
    expect(f.keys).toEqual(['Control+End', 'Enter']);
  });

  it('reopen via Files that cannot find the doc FAILs loud with the reopen error, never types', async () => {
    // Tree without the class root: open_collab_doc cannot navigate back to the doc after close_doc.
    const f = fakeCollab({
      tree: { '/': ['Collab'], '/Collab': files },
      files,
      start: `${ORIGIN}/apps/files/files/9?dir=%2FCollab&openfile=true`,
      push: 200,
      editableAfterReopens: 1,
    });
    await expect(runKeepEditing(f.page, at, { budgetMs: 90_000, reopens: 1 })).rejects.toThrow(
      /1\/1 reopen\(s\); tried: reopen via Files failed\): Viewer closed and no reopen left\. Last state: viewer=closed.*url=http.*last error: reopen: idea#166 open_collab_doc: neither "Class Materials"/,
    );
    expect(f.keys).toEqual([]);
  });

  it('never editable: FAILs after the budget with the last observed state and URL, never types', async () => {
    const f = opened({ neverEditable: true });
    const t0 = Date.now();
    const err = await runKeepEditing(f.page, at, knobs).then(
      () => null,
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toMatch(/no editable Text content \(\[data-text-el="editor-content-wrapper"\] \.ProseMirror\[contenteditable="true"\]\) for "Grade5A-collab-notes.md"/);
    expect(err!.message).toMatch(/budget 90000ms; 2\/2 reopen\(s\)/);
    expect(err!.message).toMatch(/budget exhausted/);
    expect(err!.message).toMatch(/viewer=open; editor-container=visible; \.ProseMirror=read-only; menubar=missing/);
    expect(err!.message).toMatch(/url=http:\/\/idea01:18280\/apps\/files\/files\/\d+\?dir=.*Collab&openfile=true/);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(90_000);
    expect(Date.now() - t0).toBeLessThan(150_000);
    expect(f.reopens()).toBe(2);
    expect(f.keys).toEqual([]);
    expect(f.typed()).toBe('');
  });

  it('collision dialog dismissed by Text\'s "Use the saved version", then types and needs its own push', async () => {
    const f = opened({ collision: 'resolvable' });
    expect(await runKeepEditing(f.page, at, knobs)).toBe(keepEditingLine(at));
    expect(f.clicks).toContain('#viewer #resolve-conflicts [data-cy="resolveServerVersion"]');
    expect(f.reopens()).toBe(0);
    expect(f.pushes).toHaveLength(2); // resolve push + the edit push
    expect(recoveryEvents()[0]).toMatch(/collision → \\"Use the saved version\\"/);
  });

  it('the collision-resolve push does not count as proof of the edit', async () => {
    const f = opened({ collision: 'resolvable', push: null });
    await expect(runKeepEditing(f.page, at, knobs)).rejects.toThrow(/never pushed the edit/);
    expect(f.pushes).toHaveLength(1); // only the resolve push, sent before typing
  });

  it('a collision that never clears FAILs naming the dialog and the Text notice', async () => {
    const f = opened({ collision: 'sticky' });
    await expect(runKeepEditing(f.page, at, knobs)).rejects.toThrow(
      /tried: collision → "Use the saved version".*collision-dialog=visible.*document-status="Document has been changed outside of the editor/,
    );
    expect(f.keys).toEqual([]);
  });

  it('Reconnect notice dismissed by its Reconnect button, then types', async () => {
    const f = opened({ connectionIssue: true });
    expect(await runKeepEditing(f.page, at, knobs)).toBe(keepEditingLine(at));
    expect(f.clicks).toContain('#viewer .document-status a.button');
    expect(f.reopens()).toBe(0);
  });

  it('read-only (permission) stays an immediate loud-fail, no retries', async () => {
    const f = opened({ readonly: true });
    const t0 = Date.now();
    await expect(runKeepEditing(f.page, at, knobs)).rejects.toThrow(/read-only .*collabProvisioned=false/);
    expect(f.reopens()).toBe(0);
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it('keepEditingBudget: 90s / 2 reopens by default, env overrides, loud on garbage', () => {
    expect(keepEditingBudget({})).toEqual({ budgetMs: 90_000, reopens: 2 });
    expect(keepEditingBudget({ DURATION_KEEP_EDITING_BUDGET_MS: '120000', DURATION_KEEP_EDITING_REOPENS: '0' })).toEqual({
      budgetMs: 120_000,
      reopens: 0,
    });
    expect(() => keepEditingBudget({ DURATION_KEEP_EDITING_BUDGET_MS: 'soon' })).toThrow(/not a non-negative number/);
  });
});

/* ------------------------------------------------------------------------- */
/* clickUntil + call sites (r28 FAIL@22 share_to_class sidebar, sweep)         */
/* ------------------------------------------------------------------------- */

/** Minimal page for clickUntil: fake clock + reload counter. */
function fakeClock() {
  let reloads = 0;
  const page = {
    url: () => filesUrl('/'),
    waitForTimeout: async (ms: number) => {
      vi.setSystemTime(Date.now() + ms);
    },
    reload: async () => {
      reloads++;
    },
  };
  return { page: page as unknown as Page, reloads: () => reloads };
}

describe('clickUntil (visible+enabled → click ×3 backoff → poll → reload once → loud)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T00:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('succeeds on a later click retry, without reloading', async () => {
    const f = fakeClock();
    let clicks = 0;
    const r = await clickUntil(f.page, {
      ready: async () => true,
      click: async () => {
        clicks++;
      },
      done: async () => clicks >= 3,
    });
    expect(r).toEqual({ ok: true, clicks: 3, reloaded: false, lastError: null });
    expect(f.reloads()).toBe(0);
  });

  it('retries a click that throws (not actionable yet) and records the error', async () => {
    const f = fakeClock();
    let clicks = 0;
    let landed = false;
    const r = await clickUntil(f.page, {
      click: async () => {
        if (++clicks === 1) throw new Error('locator.click: Timeout 8000ms exceeded.\n  - element is not enabled');
        landed = true;
      },
      done: async () => landed,
    });
    expect(r.ok).toBe(true);
    expect(r.clicks).toBe(2);
    expect(r.lastError).toBe('locator.click: Timeout 8000ms exceeded.');
  });

  it('reloads once after 3 failed clicks, re-checks preconditions, then succeeds', async () => {
    const f = fakeClock();
    let clicks = 0;
    let afterReload = 0;
    const r = await clickUntil(f.page, {
      click: async () => {
        clicks++;
      },
      done: async () => f.reloads() > 0 && clicks > NC_CLICK_RETRIES,
      afterReload: async () => {
        afterReload++;
        return true;
      },
    });
    expect(r).toEqual({ ok: true, clicks: NC_CLICK_RETRIES + 1, reloaded: true, lastError: null });
    expect(f.reloads()).toBe(1);
    expect(afterReload).toBe(1);
  });

  it('gives up only after 3 clicks + 1 reload + 3 clicks; caller keeps its loud message + attempt info', async () => {
    const f = fakeClock();
    const t0 = Date.now();
    const r = await clickUntil(f.page, {
      click: async () => {
        throw new Error('boom');
      },
      done: async () => false,
    });
    expect(r).toEqual({ ok: false, clicks: 2 * NC_CLICK_RETRIES, reloaded: true, lastError: 'boom' });
    expect(f.reloads()).toBe(1);
    expect(ncAttempts(r)).toBe(' [6 click attempt(s), 1 page reload; last click error: boom]');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(2 * (1_000 + 2_000)); // backoff 1s + 2s per round
  });

  it('a result already true before the first click never soft-passes: it still clicks', async () => {
    const f = fakeClock();
    let clicks = 0;
    const r = await clickUntil(f.page, { click: async () => void clicks++, done: async () => true });
    expect(r.ok).toBe(true);
    expect(clicks).toBe(1);
  });

  it('reload: false → 3 clicks only; afterReload false → no second round; NcFatal is rethrown at once', async () => {
    const a = fakeClock();
    expect(await clickUntil(a.page, { click: async () => {}, done: async () => false, reload: false })).toMatchObject({
      ok: false,
      clicks: 3,
      reloaded: false,
    });
    expect(a.reloads()).toBe(0);

    const b = fakeClock();
    const rb = await clickUntil(b.page, { click: async () => {}, done: async () => false, afterReload: async () => false });
    expect(rb).toMatchObject({ ok: false, clicks: 3, reloaded: true });

    const c = fakeClock();
    let clicks = 0;
    await expect(
      clickUntil(c.page, {
        click: async () => {
          clicks++;
          throw new NcFatal('t: Nextcloud rejected the share (HTTP 403)');
        },
        done: async () => false,
      }),
    ).rejects.toThrow(/rejected the share \(HTTP 403\)/);
    expect(clicks).toBe(1);
    expect(c.reloads()).toBe(0);
  });
});

/** Fake Files list with "Class Materials" + sharing sidebar that opens late / only after reload / never. */
function fakeSidebar(o: { openAfterClicks?: number; openOnlyAfterReload?: boolean; never?: boolean }) {
  const name = 'Class Materials';
  const row = `tr[data-cy-files-list-row-name="${name}"]`;
  const inline = `${row} [data-cy-files-list-row-action="sharing-status"]`;
  let clicks = 0;
  let reloads = 0;
  let open = false;
  const visible = (sel: string): boolean => {
    if (sel === row || sel === inline) return true;
    if (sel === '[data-cy-sidebar]') return open;
    if (sel.startsWith('[data-cy-sidebar] ')) return open;
    return false;
  };
  const L = (sel: string): unknown => ({
    first: () => L(sel),
    last: () => L(sel),
    locator: (sub: string) => L(`${sel} ${sub}`),
    count: async () => (visible(sel) ? 1 : 0),
    isVisible: async () => visible(sel),
    isEnabled: async () => visible(sel),
    innerText: async () => (sel === '[data-cy-sidebar]' && open ? `${name}\nActivity Sharing` : ''),
    getAttribute: async (n: string) => (sel.endsWith('[aria-controls="tab-sharing"]') && n === 'aria-selected' ? 'true' : null),
    evaluateAll: async () => [name],
    click: async () => {
      if (!visible(sel)) throw new Error(`not visible: ${sel}`);
      if (sel !== inline) return;
      clicks++;
      if (o.never) return;
      if (o.openOnlyAfterReload ? reloads > 0 : clicks > (o.openAfterClicks ?? 0)) open = true;
    },
  });
  const page = {
    url: () => filesUrl('/'),
    waitForTimeout: async (ms: number) => {
      vi.setSystemTime(Date.now() + ms);
    },
    reload: async () => {
      reloads++;
      open = false;
    },
    locator: (sel: string) => L(sel),
  };
  return { page: page as unknown as Page, clicks: () => clicks, reloads: () => reloads };
}

describe('ncOpenSharingSidebar (r28 FAIL@22: share_to_class sidebar open)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T00:10:00Z'));
  });
  afterEach(() => vi.useRealTimers());
  const tag = 'idea#166 share_to_class';

  it('first Share click lost → retries the click and opens the sidebar on the Sharing tab', async () => {
    const f = fakeSidebar({ openAfterClicks: 1 });
    expect(await ncOpenSharingSidebar(f.page, tag, 'Class Materials')).toBe('[data-cy-sidebar]');
    expect(f.clicks()).toBe(2);
    expect(f.reloads()).toBe(0);
  });

  it('sidebar only opens after a reload → reloads Files once, waits for the row, clicks again', async () => {
    const f = fakeSidebar({ openOnlyAfterReload: true });
    expect(await ncOpenSharingSidebar(f.page, tag, 'Class Materials')).toBe('[data-cy-sidebar]');
    expect(f.clicks()).toBe(NC_CLICK_RETRIES + 1);
    expect(f.reloads()).toBe(1);
  });

  it('never opens → same loud r28 message + attempt info, only after 3 clicks + reload + 3 clicks', async () => {
    const f = fakeSidebar({ never: true });
    const t0 = Date.now();
    await expect(ncOpenSharingSidebar(f.page, tag, 'Class Materials')).rejects.toThrow(
      'idea#166 share_to_class: Files sidebar did not open for "Class Materials" (http://idea01:18280/apps/files/files). ' +
        '[6 click attempt(s), 1 page reload]',
    );
    expect(f.clicks()).toBe(6);
    expect(f.reloads()).toBe(1);
    // r28 gave up at 20.7s; now each round's first poll alone is NC_RESULT_POLL_MS.
    expect(Date.now() - t0).toBeGreaterThanOrEqual(2 * NC_RESULT_POLL_MS);
  });

  it('reload: false (caller already reloaded) → 3 clicks, no reload, then loud', async () => {
    const f = fakeSidebar({ never: true });
    await expect(ncOpenSharingSidebar(f.page, tag, 'Class Materials', { reload: false })).rejects.toThrow(
      /Files sidebar did not open for "Class Materials" .*\[3 click attempt\(s\), no reload\]/,
    );
    expect(f.reloads()).toBe(0);
  });
});

describe('sweep: other Nextcloud deep click sites retry', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T00:20:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('done_sharing: a lost "Close sidebar" click is retried', async () => {
    const { page, clicks, s } = fakeShareState({ ignoreCloseClicks: 1 });
    expect(await runDoneSharing(page)).toBe('/Grade 5A Files');
    expect(s.sidebar).toBe(false);
    expect(clicks).toEqual(['[data-cy-sidebar] .app-sidebar__close', '[data-cy-sidebar] .app-sidebar__close']);
  });

  it('done_sharing: stuck sidebar still loud-fails "still open", with attempt info', async () => {
    const { page, clicks } = fakeShareState({ stuck: true });
    await expect(runDoneSharing(page)).rejects.toThrow(/Files sidebar is still open .*\[6 click attempt\(s\), 1 page reload\]/);
    expect(clicks).toHaveLength(6);
  });

  it('browse_folders (ncOpenFolder): a swallowed row click is retried', async () => {
    const f = fakeNextcloud({ start: 'files', tree: { '/': ['Class Materials', 'Drop Zone', 'Collab'] }, dropRowClicks: 2 });
    expect(await runBrowseFolders(f.page)).toEqual(['/Class Materials', '/Drop Zone', '/Collab']);
    expect(f.reloads()).toBe(0);
  });

  it('open_collab_doc: Viewer opens on the second click on the doc', async () => {
    const tree = { '/': ['Class Materials', 'Collab'], '/Collab': ['Grade5A-collab-notes.md'] };
    const f = fakeCollab({ tree, files: ['Grade5A-collab-notes.md'], ignoreFileClicks: 1 });
    expect(await runOpenCollabDoc(f.page)).toBe('/Collab');
    expect(f.clicks.filter((c) => c.includes('Grade5A-collab-notes.md'))).toHaveLength(2);
  });

  it('open_collab_doc: Viewer never opens → original loud message + attempt info', async () => {
    const tree = { '/': ['Class Materials', 'Collab'], '/Collab': ['Grade5A-collab-notes.md'] };
    const f = fakeCollab({ tree, files: ['Grade5A-collab-notes.md'], viewer: 'downloads' });
    await expect(runOpenCollabDoc(f.page)).rejects.toThrow(
      /did not open the Nextcloud Viewer .*file downloaded instead .*\[6 click attempt\(s\), 1 page reload\]/,
    );
  });
});
