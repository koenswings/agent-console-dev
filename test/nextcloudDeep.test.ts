import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Page } from '@playwright/test';
import {
  ensureNextcloudFiles,
  isNcLoginUrl,
  isNextcloudTabUrl,
  ncFilesDir,
  ncPasswordCandidates,
  runBrowseFolders,
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
function fakeNextcloud(opts: { start: 'login' | 'files' | 'dashboard'; accept?: string[]; tree: Record<string, string[]> }) {
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
