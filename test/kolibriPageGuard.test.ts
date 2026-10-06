// @vitest-environment node
/**
 * idea#168 r31: a Kolibri 5xx must fail open_kolibri_as_teacher (@2) and
 * create_class (@3) with the HTTP status, never pass as 'no login form' or
 * surface as 'Grade 5A not listed'. Pure classifier tests + real Chromium
 * against a local fake Kolibri (500 / login / signed-in / blank modes).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  classifyKolibriLanding,
  isServerErrorStatus,
  serverErrorFromBody,
  kolibriLandingMs,
} from '../e2e/intents/kolibriPageGuard';
import { open_kolibri_as_teacher } from '../e2e/intents/openApp';
import { create_class } from '../e2e/intents/kolibriCoaching';

describe('kolibriPageGuard — pure helpers', () => {
  it('isServerErrorStatus is 5xx only', () => {
    expect(isServerErrorStatus(500)).toBe(true);
    expect(isServerErrorStatus(503)).toBe(true);
    for (const s of [200, 302, 404, 499, 600, null, undefined]) expect(isServerErrorStatus(s)).toBe(false);
  });

  it('serverErrorFromBody reads the Django error page only', () => {
    expect(serverErrorFromBody('Server Error (500)')).toBe(500);
    expect(serverErrorFromBody('\n  Server Error (502)\n')).toBe(502);
    expect(serverErrorFromBody('Classes Grade 5A … Server Error (500) mentioned later')).toBeNull();
    expect(serverErrorFromBody('')).toBeNull();
  });

  const base = { status: 200 as number | null, url: 'http://idea01:18080/en/coach/#/classes', bodyText: '', hasLoginField: false };
  it('classifies 5xx (status or body) as server_error first', () => {
    expect(classifyKolibriLanding({ ...base, status: 500, hasLoginField: true })).toBe('server_error');
    expect(classifyKolibriLanding({ ...base, status: null, bodyText: 'Server Error (500)' })).toBe('server_error');
  });
  it('login form and signed-in views', () => {
    expect(classifyKolibriLanding({ ...base, url: 'http://idea01:18080/en/auth/#/signin', hasLoginField: true })).toBe('login_form');
    expect(classifyKolibriLanding({ ...base, bodyText: 'Coach  Classes  Grade 5A  3 learners' })).toBe('signed_in');
    expect(classifyKolibriLanding({ ...base, url: 'http://idea01:18080/en/facility/#/classes', bodyText: 'Facility Classes Users' })).toBe('signed_in');
  });
  it('auth prompt, blank body, or wrong page is still loading', () => {
    expect(classifyKolibriLanding({ ...base, bodyText: 'You must be signed in as a coach to view this page' })).toBe('loading');
    expect(classifyKolibriLanding({ ...base, bodyText: '   ' })).toBe('loading');
    expect(classifyKolibriLanding({ ...base, url: 'http://idea01:18080/en/auth/#/signin', bodyText: 'Classes' })).toBe('loading');
    expect(classifyKolibriLanding({ ...base, url: 'http://idea01:18080/en/learn/#/home', bodyText: 'Classes' })).toBe('loading');
  });
  it('kolibriLandingMs defaults to 15 s', () => {
    const prev = process.env.DURATION_KOLIBRI_LANDING_MS;
    delete process.env.DURATION_KOLIBRI_LANDING_MS;
    expect(kolibriLandingMs()).toBe(15_000);
    process.env.DURATION_KOLIBRI_LANDING_MS = '2500';
    expect(kolibriLandingMs()).toBe(2_500);
    if (prev === undefined) delete process.env.DURATION_KOLIBRI_LANDING_MS;
    else process.env.DURATION_KOLIBRI_LANDING_MS = prev;
  });
});

// ── Fake Kolibri ──────────────────────────────────────────────────────────────
type Mode = '500' | 'kolibri' | 'blank';
let mode: Mode = 'kolibri';
let server: http.Server;
let origin = '';

const html = (body: string) => `<!doctype html><html><body>${body}</body></html>`;
const LOGIN = html(`
  <h1>Sign in</h1>
  <input autocomplete="username" name="username" type="text">
  <button id="next" type="button">NEXT</button>
  <div id="pw" style="display:none">
    <input type="password" name="password">
    <button type="submit" id="go">SIGN IN</button>
  </div>
  <script>
    document.getElementById('next').onclick = () => { document.getElementById('pw').style.display = 'block' };
    document.getElementById('go').onclick = () => { document.cookie = 'kolibri=teacher; path=/'; location.href = '/en/coach/#/' };
  </script>`);
const COACH = html('<nav>Coach</nav><h1>Classes</h1><a href="#/a12df">Grade 5A</a><span>3 learners</span>');
const FACILITY = html('<nav>Facility</nav><h1>Classes</h1><table><tr><td>Grade 5A</td></tr></table><button>NEW CLASS</button>');

const handler: http.RequestListener = (req, res) => {
  const url = req.url ?? '/';
  const signedIn = /kolibri=teacher/.test(req.headers.cookie ?? '');
  if (mode === '500') {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end('<h1>Server Error (500)</h1>');
    return;
  }
  if (mode === 'blank') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html(''));
    return;
  }
  if (url.startsWith('/en/auth/')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(LOGIN);
    return;
  }
  if (url.startsWith('/en/coach/') || url.startsWith('/en/facility/')) {
    if (!signedIn) {
      res.writeHead(302, { Location: '/en/auth/' });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(url.startsWith('/en/coach/') ? COACH : FACILITY);
    return;
  }
  res.writeHead(302, { Location: '/en/auth/' });
  res.end();
};

let browser: Browser | null = null;
let launchError: unknown = null;
const prevEnv = { url: process.env.DURATION_KOLIBRI_URL, landing: process.env.DURATION_KOLIBRI_LANDING_MS, settle: process.env.DURATION_COACH_SETTLE_MS };

beforeAll(async () => {
  server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.DURATION_KOLIBRI_URL = origin;
  process.env.DURATION_KOLIBRI_LANDING_MS = '2000';
  process.env.DURATION_COACH_SETTLE_MS = '2000';
  try {
    browser = await chromium.launch();
  } catch (e) {
    launchError = e;
  }
}, 60_000);

afterAll(async () => {
  await browser?.close().catch(() => {});
  await new Promise<void>((r) => server.close(() => r()));
  for (const [k, v] of [['DURATION_KOLIBRI_URL', prevEnv.url], ['DURATION_KOLIBRI_LANDING_MS', prevEnv.landing], ['DURATION_COACH_SETTLE_MS', prevEnv.settle]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

let ctx: BrowserContext;
let consolePage: Page;
const openKolibriTab = async (path: string, signedIn = false): Promise<Page> => {
  if (signedIn) await ctx.addCookies([{ name: 'kolibri', value: 'teacher', url: origin }]);
  const tab = await ctx.newPage();
  await tab.goto(`${origin}${path}`).catch(() => null);
  return tab;
};

describe('Kolibri intents against a fake Kolibri (real Chromium)', () => {
  beforeEach(async (t) => {
    if (!browser) {
      t.skip(); // Chromium not installed here: pure tests above still cover the classifier
      return;
    }
    mode = 'kolibri';
    ctx = await browser.newContext();
    consolePage = await ctx.newPage(); // stands in for the Console tab (about:blank)
  });
  afterEach(async () => {
    await ctx?.close().catch(() => {});
  });

  it('reports why Chromium tests would be skipped', () => {
    expect(launchError).toBeNull();
  });

  it('@2 open_kolibri_as_teacher: Kolibri 500 fails loud with URL + status', async () => {
    mode = '500';
    await openKolibriTab('/en/auth/');
    await expect(open_kolibri_as_teacher({ page: consolePage } as never)).rejects.toThrow(
      new RegExp(`open_kolibri_as_teacher .*Kolibri returned HTTP 500 for ${origin.replace(/\./g, '\\.')}/en/`),
    );
  }, 30_000);

  it('@2 open_kolibri_as_teacher: normal two-step login lands signed in → pass', async () => {
    await openKolibriTab('/en/auth/');
    await expect(open_kolibri_as_teacher({ page: consolePage } as never)).resolves.toBeUndefined();
    const tab = ctx.pages().find((p) => p !== consolePage)!;
    expect(tab.url()).toMatch(/\/en\/coach\//);
  }, 30_000);

  it('@2 open_kolibri_as_teacher: already signed-in coach view → pass', async () => {
    await openKolibriTab('/en/coach/#/', true);
    await expect(open_kolibri_as_teacher({ page: consolePage } as never)).resolves.toBeUndefined();
  }, 30_000);

  it('@2 open_kolibri_as_teacher: neither login form nor signed-in view → fails loud', async () => {
    mode = 'blank';
    await openKolibriTab('/en/coach/#/');
    await expect(open_kolibri_as_teacher({ page: consolePage } as never)).rejects.toThrow(
      /open_kolibri_as_teacher: neither the Kolibri login form nor a signed-in coach\/facility view rendered within 2000ms .*\(HTTP (200|unknown), via (listener|none)\); body: \(empty body\)/,
    );
  }, 30_000);

  it('@3 create_class: Kolibri 500 on the classes page fails with the status, not "Grade 5A not listed"', async () => {
    // Like r31: the tab is on Coach (a different document), so the facility goto hits the server.
    await openKolibriTab('/en/coach/#/', true);
    mode = '500';
    const err = await create_class({ page: consolePage } as never).then(() => null, (e: Error) => e);
    expect(err?.message).toMatch(/create_class \(facility #\/classes\): Kolibri returned HTTP 500 for .*\/en\/facility\//);
    expect(err?.message).not.toMatch(/not listed/);
  }, 30_000);

  it('@3 create_class: tab already showing the Django 500 page (same-document goto) still reports HTTP 500', async () => {
    mode = '500';
    await openKolibriTab('/en/facility/#/');
    const err = await create_class({ page: consolePage } as never).then(() => null, (e: Error) => e);
    expect(err?.message).toMatch(/create_class \(facility #\/classes\): Kolibri returned HTTP 500 .*via (body|listener|goto)/);
  }, 30_000);

  it('@3 create_class: signed-in facility view with Grade 5A → pass', async () => {
    await openKolibriTab('/en/facility/#/', true);
    await expect(create_class({ page: consolePage } as never)).resolves.toBeUndefined();
  }, 30_000);
});
