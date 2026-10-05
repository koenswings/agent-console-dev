import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Page } from '@playwright/test';
import {
  ensureNextcloudFiles,
  isNcLoginUrl,
  isNextcloudTabUrl,
  ncFilesDir,
  ncPasswordCandidates,
  runBrowseFolders,
  runShareToClass,
  runDoneSharing,
  runOpenCollabDoc,
  runCloseDoc,
  ncOpenFileQuery,
  isGroupShareEntryText,
  ncGroupShareTitle,
  ncOcsFailure,
  ncQuickShareSelected,
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
    expect(isNextcloudTabUrl('http://idea01:8080/')).toBe(false);
  });

  it('ncPasswordCandidates: Kid live password first, legacy username once', () => {
    expect(ncPasswordCandidates(NC.auth.teacher)).toEqual(['TeacherGrade5A!', 'teacher']);
    expect(ncPasswordCandidates({ username: 'x', password: 'x' })).toEqual(['x']);
  });
});

/** Fake Nextcloud tab: login page + Files folders keyed by dir. */
function fakeNextcloud(opts: { start: 'login' | 'files' | 'dashboard'; accept?: string[]; tree: Record<string, string[]>; uid?: string }) {
  let url = opts.start === 'login' ? `${ORIGIN}/login` : opts.start === 'files' ? filesUrl('/') : `${ORIGIN}/apps/dashboard/`;
  const fields: Record<string, string> = {};
  const clicks: string[] = [];
  const submitted: string[] = [];
  const dir = () => ncFilesDir(url);
  const rowName = (sel: string) => /data-cy-files-list-row-name="([^"]+)"/.exec(sel)?.[1];
  const present = (sel: string): boolean => {
    const onLogin = isNcLoginUrl(url);
    if (sel === '[data-login-form]' || sel === 'input#password') return onLogin;
    if (sel === 'input#user' || sel === '[data-login-form-submit]') return onLogin;
    if (sel === '[data-cy-files-content-breadcrumbs]') return dir() !== null;
    if (sel.startsWith('[data-cy-files-content-breadcrumbs] a')) return dir() !== null;
    if (sel === 'nav.app-menu a[href$="/apps/files/"]') return !onLogin;
    const name = rowName(sel);
    if (name && dir() !== null) return (opts.tree[dir()!] ?? []).includes(name);
    return false;
  };
  const page = {
    url: () => url,
    async waitForTimeout(ms: number) {
      vi.setSystemTime(Date.now() + ms);
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
          return sel === 'head' && name === 'data-user' ? (opts.uid ?? null) : null;
        },
        async click() {
          if (!present(sel)) throw new Error(`not present: ${sel}`);
          clicks.push(sel);
          if (sel === '[data-login-form-submit]') {
            const pw = fields['input#password'] ?? '';
            submitted.push(pw);
            if ((opts.accept ?? []).includes(pw)) url = `${ORIGIN}/apps/dashboard/`;
            return;
          }
          if (sel === 'nav.app-menu a[href$="/apps/files/"]') url = filesUrl('/');
          else if (sel.startsWith('[data-cy-files-content-breadcrumbs] a')) url = filesUrl('/');
          else {
            const name = rowName(sel);
            if (name) url = filesUrl(`${dir() === '/' ? '' : dir()}/${name}`);
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
  return { page: page as unknown as Page, clicks, submitted };
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
function fakeShareState(o: { uid?: string; sidebar?: boolean; tab?: boolean; editor?: boolean; stuck?: boolean }) {
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
    getAttribute: async (name: string) => {
      if (sel === 'head' && name === 'data-user') return o.uid ?? 'teacher';
      if (sel.endsWith('[aria-controls="tab-sharing"]') && name === 'aria-selected') return s.tab ? 'true' : 'false';
      return null;
    },
    click: async () => {
      if (!visible(sel)) throw new Error(`not visible: ${sel}`);
      clicks.push(sel);
      if (sel.endsWith('.app-sidebar__close') && !o.stuck) s.sidebar = false;
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
}) {
  let url = o.start ?? filesUrl('/');
  let viewer = o.start ? ncOpenFileQuery(o.start) : false;
  const clicks: string[] = [];
  const dir = () => ncFilesDir(url);
  const rowName = (sel: string) => /data-cy-files-list-row-name="([^"]+)"/.exec(sel)?.[1];
  const withQuery = (d: string, open: boolean) => `${filesUrl(d).split('?')[0]}?dir=${encodeURIComponent(d)}${open ? '&openfile=true' : ''}`;
  const present = (sel: string): boolean => {
    if (sel.startsWith('#viewer')) {
      if (!viewer) return false;
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
    getAttribute: async (n: string) => (sel === 'head' && n === 'data-user' ? 'student01' : null),
    innerText: async () => {
      if (!present(sel)) throw new Error('detached');
      if (sel.endsWith('.modal-header__name')) return o.title ?? 'Grade5A-collab-notes.md';
      if (sel === '#viewer') return o.content ?? '# Grade 5A collab notes (placeholder)\nDuration-tests';
      return '';
    },
    evaluateAll: async () => (dir() !== null ? (o.tree[dir()!] ?? []) : []),
    click: async () => {
      if (!present(sel)) throw new Error(`not present: ${sel}`);
      clicks.push(sel);
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
        if ((o.viewer ?? 'opens') === 'opens') {
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
  };
  return { page: page as unknown as Page, clicks, isViewerOpen: () => viewer };
}

describe('open_collab_doc / close_doc (Kid placeholder .md in the Viewer)', () => {
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
