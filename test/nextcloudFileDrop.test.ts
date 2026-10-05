import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Page } from '@playwright/test';
import {
  dropUploadFile,
  isPublicShareUrl,
  ncAssertDropPage,
  ncDropPage,
  resolveFileRequestUrl,
  runAfterUpload,
  runOpenFileDrop,
} from '../e2e/intents/nextcloudDeep';
import { DURATION_FIXTURES } from '../e2e/intents/fixtures';

const NC = DURATION_FIXTURES.nextcloud;
const ORIGIN = 'http://idea01:18280';
const DROP_URL = `${ORIGIN}/s/grade5adropzone`;

type DropOpts = {
  url?: string;
  ui?: boolean;
  uiText?: string;
  body?: string;
  rows?: string[];
  putStatus?: number | null;
  chooser?: boolean;
};

/** Fake Playwright page for the public File drop view. */
function fakeDrop(o: DropOpts = {}) {
  const state = { closed: false, uploaded: [] as string[], clicks: [] as string[], url: o.url ?? DROP_URL };
  const uiText = o.uiText ?? 'File drop Upload files to inbox. Upload';
  const L = (sel: string): unknown => ({
    first: () => L(sel),
    count: async () => (sel.includes('data-cy-files-list-row') ? (o.rows ?? []).length : (o.ui ?? true) ? 1 : 0),
    isVisible: async () => (sel.startsWith('role:') ? (o.chooser ?? true) : (o.ui ?? true)),
    innerText: async () => (sel === 'body' ? (o.body ?? uiText) : uiText),
    evaluateAll: async () => o.rows ?? [],
    getByRole: (role: string, opt: { name: string }) => L(`role:${role}:${opt.name}`),
    click: async () => {
      state.clicks.push(sel);
    },
    setInputFiles: async (f: { name: string }) => {
      state.uploaded.push(`input:${f.name}`);
    },
  });
  let pending: ((f: { name: string }) => void) | null = null;
  const page = {
    url: () => state.url,
    isClosed: () => state.closed,
    close: async () => {
      state.closed = true;
    },
    waitForTimeout: async (ms: number) => {
      vi.setSystemTime(Date.now() + ms);
    },
    locator: (sel: string) => L(sel),
    getByRole: (role: string, opt: { name: string }) => L(`role:${role}:${opt.name}`),
    waitForEvent: async () => {
      if (!(o.chooser ?? true)) throw new Error('timeout');
      return {
        setFiles: async (f: { name: string }) => {
          state.uploaded.push(`chooser:${f.name}`);
          pending?.(f);
        },
      };
    },
    waitForResponse: async () => {
      if (o.putStatus === null) throw new Error('timeout');
      return {
        status: () => o.putStatus ?? 201,
        url: () => `${ORIGIN}/public.php/dav/files/grade5adropzone/x.txt`,
        request: () => ({ method: () => 'PUT' }),
      };
    },
  };
  return { page: page as unknown as Page, state };
}

/** Signed-in Files tab stub (enough for ensureNextcloudFiles + head data-user). */
function fakeFiles(uid: string) {
  const url = `${ORIGIN}/apps/files/files`;
  const L = (sel: string): unknown => ({
    first: () => L(sel),
    count: async () => (sel === '[data-cy-files-content-breadcrumbs]' ? 1 : 0),
    getAttribute: async (n: string) => (sel === 'head' && n === 'data-user' ? uid : null),
  });
  return {
    url: () => url,
    isClosed: () => false,
    bringToFront: async () => {},
    waitForTimeout: async (ms: number) => {
      vi.setSystemTime(Date.now() + ms);
    },
    locator: (sel: string) => L(sel),
  };
}

function withContext(pages: Record<string, unknown>[], newPage?: () => Page) {
  const ctx = {
    pages: () => pages.filter((p) => !(p as { isClosed: () => boolean }).isClosed()),
    newPage: async () => {
      const p = newPage!();
      pages.push(p as unknown as Record<string, unknown>);
      return p;
    },
  };
  for (const p of pages) p.context = () => ctx;
  return ctx;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-05T13:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('File Drop fixture + URL (Kid App#11 @2d9a052)', () => {
  it('pins the upload-safe token on /Drop Zone/inbox', () => {
    expect(NC.fileRequest.token).toBe('grade5adropzone');
    expect(NC.fileRequest.token).toMatch(/^[A-Za-z0-9]+$/);
    expect(NC.fileRequest.url).toBe('http://idea01:18280/s/grade5adropzone');
    expect(NC.fileRequest.path).toBe('/Drop Zone/inbox');
  });

  it('resolveFileRequestUrl keeps the Nextcloud tab hostname; env override wins', () => {
    expect(resolveFileRequestUrl(`${ORIGIN}/apps/files/files`, {})).toBe(DROP_URL);
    expect(resolveFileRequestUrl('http://idea03:18280/apps/files/', {})).toBe('http://idea03:18280/s/grade5adropzone');
    expect(resolveFileRequestUrl(`${ORIGIN}/apps/files/`, { DURATION_NC_FILE_REQUEST_URL: 'http://idea01:18280/s/abc123' })).toBe(
      'http://idea01:18280/s/abc123',
    );
  });

  it('isPublicShareUrl', () => {
    expect(isPublicShareUrl(DROP_URL, 'grade5adropzone')).toBe(true);
    expect(isPublicShareUrl(`${ORIGIN}/index.php/s/grade5adropzone`)).toBe(true);
    expect(isPublicShareUrl(DROP_URL, 'grade5a')).toBe(false);
    expect(isPublicShareUrl(`${ORIGIN}/apps/files/`)).toBe(false);
  });
});

describe('ncAssertDropPage (upload-only "Upload files to inbox.")', () => {
  it('accepts the live File drop UI', async () => {
    await expect(ncAssertDropPage(fakeDrop().page, 't')).resolves.toBeUndefined();
  });
  it('loud-fails on "This directory is unavailable" (old mount-root share)', async () => {
    const { page } = fakeDrop({ body: 'File drop Upload files to inbox. This directory is unavailable' });
    await expect(ncAssertDropPage(page, 't')).rejects.toThrow(/This directory is unavailable/);
  });
  it('loud-fails on the wrong folder, listed files, or no File drop UI', async () => {
    await expect(ncAssertDropPage(fakeDrop({ uiText: 'File drop Upload files to Drop Zone.' }).page, 't')).rejects.toThrow(
      /want "Upload files to inbox\."/,
    );
    await expect(ncAssertDropPage(fakeDrop({ rows: ['secret.txt'] }).page, 't')).rejects.toThrow(/lists files \(secret.txt\)/);
    await expect(ncAssertDropPage(fakeDrop({ ui: false, body: 'Share not found' }).page, 't')).rejects.toThrow(
      /not a Nextcloud File drop page.*Share not found/,
    );
  });
});

describe('open_file_drop / after_upload / leave_file_drop', () => {
  it('open_file_drop: learner Files tab → new tab on the Kid file request', async () => {
    const files = fakeFiles('student01');
    const drop = fakeDrop();
    let visited = '';
    (drop.page as unknown as { goto: (u: string) => Promise<unknown> }).goto = async (u: string) => {
      visited = u;
      return { status: () => 200 };
    };
    withContext([files], () => drop.page);
    const opened = await runOpenFileDrop(files as unknown as Page);
    expect(opened).toBe(drop.page);
    expect(visited).toBe(DROP_URL);
  });

  it('open_file_drop loud-fails on a teacher session and on HTTP 404 (old token)', async () => {
    const teacher = fakeFiles('teacher');
    withContext([teacher], () => fakeDrop().page);
    await expect(runOpenFileDrop(teacher as unknown as Page)).rejects.toThrow(/learner Intent; Nextcloud is signed in as teacher/);

    const files = fakeFiles('student01');
    const drop = fakeDrop();
    (drop.page as unknown as { goto: () => Promise<unknown> }).goto = async () => ({ status: () => 404 });
    withContext([files], () => drop.page);
    await expect(runOpenFileDrop(files as unknown as Page)).rejects.toThrow(/HTTP 404 \(404 = old\/wrong token/);
  });

  it('after_upload: Upload → file chooser → PUT 201 → drop tab closed, back on signed-in Files', async () => {
    const consolePage = { url: () => 'http://idea01:8080/', isClosed: () => false };
    const files = fakeFiles('student01');
    const drop = fakeDrop();
    withContext([consolePage, files, drop.page as unknown as Record<string, unknown>]);
    const name = await runAfterUpload(consolePage as unknown as Page, new Date('2026-10-05T13:00:00.000Z'));
    expect(name).toBe(dropUploadFile(new Date('2026-10-05T13:00:00.000Z')).name);
    expect(drop.state.uploaded).toEqual([`chooser:${name}`]);
    expect(drop.state.closed).toBe(true);
  });

  it('after_upload loud-fails when Nextcloud rejects or never receives the upload', async () => {
    for (const [putStatus, re] of [
      [403, /rejected the upload .*HTTP 403/],
      [null, /no upload request/],
    ] as const) {
      const consolePage = { url: () => 'http://idea01:8080/', isClosed: () => false };
      const drop = fakeDrop({ putStatus });
      withContext([consolePage, fakeFiles('student01'), drop.page as unknown as Record<string, unknown>]);
      await expect(runAfterUpload(consolePage as unknown as Page)).rejects.toThrow(re);
      expect(drop.state.closed).toBe(false);
    }
  });

  it('nc_drop precondition: no /s/<token> tab = loud-fail', () => {
    const consolePage = { url: () => 'http://idea01:8080/', isClosed: () => false };
    withContext([consolePage, fakeFiles('student01')]);
    expect(() => ncDropPage(consolePage as unknown as Page, 'idea#166 leave_file_drop')).toThrow(/not in nc_drop/);
  });
});
