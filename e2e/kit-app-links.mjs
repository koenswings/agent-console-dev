#!/usr/bin/env node
/**
 * e2e/kit-app-links.mjs — live check of App Open links on a kit LAN (PR #162).
 *
 * Self-contained: Node 18+ and the `playwright` package from this repo's
 * node_modules (plus a Chromium: `pnpm exec playwright install chromium`, or
 * CHROMIUM_PATH=/usr/bin/chromium). No CDN, no test runner, no Pi access.
 *
 *   CONSOLE_URL=http://kind-panda.local \
 *   CONSOLE_USER=<operator> CONSOLE_PASSWORD=<password> \
 *   node e2e/kit-app-links.mjs
 *
 * Two passes against the live Console:
 *   desktop  1280×800, not signed in → AppBrowser card grid (what learners see)
 *   mobile   Pixel 7 profile (412×915, touch) AND signed in as operator →
 *            MobileLayout / MobileAppList. MobileAppList is only rendered for
 *            an operator (isOperator()) with window.innerWidth <= 600 (App.tsx);
 *            UA, touch, route and settings play no part. Signed out, every
 *            width gets the card grid — hence the credentials.
 *
 * For every Running instance it checks:
 *   - Open href present (not disabled) with an explicit numeric port;
 *   - host: page host for the Engine serving the page (engineId from
 *     /api/store-url, or name match, or page IP == lanAddress); otherwise the
 *     Engine's lanAddress IP when published, else <hostname>.local;
 *   - the card shows "on <engine name>";
 *   - GET href → 2xx/3xx; any Location keeps the same port.
 * Prints a PASS/FAIL table; exit 1 on any FAIL, 2 on a setup error.
 *
 * Env: CONSOLE_URL (required), CONSOLE_USER / CONSOLE_PASSWORD (mobile pass),
 * SKIP_MOBILE=1, SKIP_DESKTOP=1, CHROMIUM_PATH, SYNC_TIMEOUT_MS (default 60000),
 * HEADED=1, DEMO=1 (mock store; self-test of the script only).
 */
import { chromium, devices } from 'playwright';

const env = process.env;
const CONSOLE_URL = (env.CONSOLE_URL || '').replace(/\/+$/, '');
const SYNC_TIMEOUT = Number(env.SYNC_TIMEOUT_MS || 60_000);
const FETCH_TIMEOUT = 10_000;
const DEMO = env.DEMO === '1';
const USER = env.CONSOLE_USER || (DEMO ? 'admin' : '');
const PASSWORD = env.CONSOLE_PASSWORD || (DEMO ? 'admin911!' : '');

if (!CONSOLE_URL) {
  process.stderr.write('CONSOLE_URL is required, e.g. CONSOLE_URL=http://kind-panda.local\n');
  process.exit(2);
}

const pageHost = new URL(CONSOLE_URL).hostname.replace(/^\[|\]$/g, '').toLowerCase();
const isIp = (h) => /^[\d.]+$/.test(h) || h.includes(':');
const shortName = (h) => String(h).toLowerCase().split('.')[0];
const bareName = (h) => String(h ?? '').trim().replace(/\.local\.?$/i, '');
const out = (s = '') => process.stdout.write(`${s}\n`);

/** Engine id the page host reports on /api/store-url (null if not published). */
async function servingEngineId() {
  try {
    const r = await fetch(`${CONSOLE_URL}/api/store-url`, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j?.engineId === 'string' && j.engineId ? j.engineId : null;
  } catch {
    return null;
  }
}

/** Host the Console should use for an app on this Engine (mirrors appUrl.ts, written independently). */
function expectedHost(card, servingId) {
  const lan = (card.engineLan || '').trim();
  const serving =
    (servingId && card.engineId === servingId) ||
    (!isIp(pageHost) && card.engineHostname && shortName(card.engineHostname) === shortName(pageHost)) ||
    (isIp(pageHost) && lan && lan.toLowerCase() === pageHost);
  if (serving) return { host: pageHost, why: 'serving Engine → page host' };
  if (lan && isIp(lan)) return { host: lan.toLowerCase(), why: 'other Engine → lanAddress' };
  return { host: `${bareName(card.engineHostname).toLowerCase()}.local`, why: 'other Engine, no lanAddress → .local' };
}

/** GET the href without following redirects: 2xx/3xx, Location keeps the port. */
async function probe(href) {
  const want = new URL(href);
  try {
    const r = await fetch(href, { redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    const loc = r.headers.get('location');
    let locNote = '';
    let locOk = true;
    if (loc) {
      const to = new URL(loc, href);
      const port = to.port || (to.protocol === 'https:' ? '443' : '80');
      locOk = port === want.port;
      locNote = ` → ${to.host}${to.pathname}`;
      if (!locOk) locNote += ` (port ${want.port} lost)`;
    }
    const statusOk = r.status >= 200 && r.status < 400;
    return { ok: statusOk && locOk, status: String(r.status), note: locNote };
  } catch (e) {
    return { ok: false, status: 'ERR', note: ` ${e?.cause?.code || e?.name || e}` };
  }
}

async function login(page) {
  await page.locator('[data-testid="account-btn"]').click();
  await page.locator('.account-screen').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('input[autocomplete="username"]').fill(USER);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.locator('button.btn--primary[type="submit"]').click();
  await page.locator('.account-screen__username').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('[data-testid="account-btn"]').click();
}

/** Cards of Running instances in the current view, with their Engine data and Open href. */
async function collect(page, view) {
  return page.evaluate((v) => {
    const sel = v === 'mobile' ? '.mobile-app-card' : '.app-card';
    return [...document.querySelectorAll(sel)].map((el) => {
      const id = el.getAttribute('data-instance-id') || '';
      const open = v === 'mobile'
        ? el.querySelector(`[data-testid="mobile-open-instance-${id}"]`)
        : el.querySelector(`[data-testid="open-instance-${id}"]`);
      const label = v === 'mobile'
        ? el.querySelector(`[data-testid="mobile-app-engine-${id}"]`)
        : el.querySelector(`[data-testid="app-engine-${id}"]`);
      const running = v === 'mobile'
        ? el.getAttribute('data-status') === 'Running'
        : !el.classList.contains('app-card--unavailable');
      const name = v === 'mobile'
        ? el.querySelector('.mobile-app-card__name')?.firstChild?.textContent
        : el.querySelector('.app-card__title')?.textContent;
      return {
        id,
        name: (name || id).trim(),
        running,
        engineId: el.getAttribute('data-engine-id') || '',
        engineHostname: el.getAttribute('data-engine-hostname') || '',
        engineLan: el.getAttribute('data-engine-lan') || '',
        href: open ? (open.getAttribute('href') || open.getAttribute('data-href') || '') : '',
        disabled: open ? open.hasAttribute('disabled') : true,
        label: label ? label.textContent.trim() : '',
      };
    }).filter((c) => c.running);
  }, view);
}

/** Wait until the store synced and Running cards carry their Engine. */
async function waitForCards(page, view) {
  const sel = view === 'mobile' ? '.mobile-app-card[data-engine-id]' : '.app-card[data-engine-id]';
  await page.locator(sel).first().waitFor({ state: 'attached', timeout: SYNC_TIMEOUT });
  await page.waitForTimeout(1500); // let the remaining cards render
}

async function runPass(browser, view, servingId, rows, problems) {
  const ctxOpts = view === 'mobile'
    ? { ...devices['Pixel 7'] }
    : { viewport: { width: 1280, height: 800 } };
  const context = await browser.newContext(ctxOpts);
  if (DEMO) await context.addInitScript(() => localStorage.setItem('demoMode', 'true'));
  const page = await context.newPage();
  try {
    await page.goto(`${CONSOLE_URL}/`, { waitUntil: 'domcontentloaded' });
    if (view === 'mobile') {
      if (!USER || !PASSWORD) {
        problems.push('mobile: CONSOLE_USER / CONSOLE_PASSWORD not set — MobileAppList is operator-only, cannot reach it');
        return;
      }
      await page.locator('[data-testid="account-btn"]').waitFor({ state: 'visible', timeout: SYNC_TIMEOUT });
      await login(page);
      await page.locator('.mobile-layout').waitFor({ state: 'visible', timeout: 15_000 });
      const width = await page.evaluate(() => window.innerWidth);
      if (width > 600) problems.push(`mobile: innerWidth ${width} > 600, MobileAppList breakpoint not met`);
      if (await page.locator('.main-layout').count()) problems.push('mobile: desktop .main-layout rendered');
    } else {
      await page.locator('[data-testid="console-overview"]').waitFor({ state: 'visible', timeout: SYNC_TIMEOUT });
    }
    await waitForCards(page, view);
    const cards = await collect(page, view);
    if (cards.length === 0) problems.push(`${view}: no Running instances found`);
    for (const c of cards) {
      const exp = expectedHost(c, servingId);
      const notes = [];
      let ok = true;
      const m = /^https?:\/\/(\[[^\]]+\]|[^/:]+):(\d+)(\/|$)/i.exec(c.href);
      const host = m ? m[1].replace(/^\[|\]$/g, '').toLowerCase() : '';
      if (!c.href || c.disabled) { ok = false; notes.push('Open disabled / no href'); }
      else if (!m || !(Number(m[2]) > 0)) { ok = false; notes.push('no numeric port'); }
      else if (host !== exp.host) {
        ok = false;
        notes.push(`host ${host} ≠ expected ${exp.host} (${exp.why})`);
      }
      const wantLabel = `on ${bareName(c.engineHostname)}`;
      if (!c.engineHostname || c.label !== wantLabel) { ok = false; notes.push(`label "${c.label}" ≠ "${wantLabel}"`); }
      let status = '-';
      if (m) {
        const p = await probe(c.href);
        status = p.status;
        if (!p.ok) ok = false;
        if (p.note) notes.push(p.note.trim());
      }
      rows.push({ result: ok ? 'PASS' : 'FAIL', view, app: c.name, engine: bareName(c.engineHostname) || '?', href: c.href || '-', status, notes: notes.join('; ') });
    }
  } catch (e) {
    problems.push(`${view}: ${e?.message?.split('\n')[0] || e}`);
  } finally {
    await context.close();
  }
}

function printTable(rows) {
  const cols = ['result', 'view', 'app', 'engine', 'href', 'status', 'notes'];
  const w = Object.fromEntries(cols.map((k) => [k, Math.max(k.length, ...rows.map((r) => String(r[k]).length))]));
  const line = (r) => cols.map((k) => String(r[k]).padEnd(w[k])).join('  ');
  out(line(Object.fromEntries(cols.map((k) => [k, k.toUpperCase()]))));
  out(cols.map((k) => '-'.repeat(w[k])).join('  '));
  for (const r of rows) out(line(r));
}

const servingId = await servingEngineId();
out(`Console ${CONSOLE_URL}  page host ${pageHost}  serving engineId ${servingId ?? '(not published)'}`);
if (!servingId && isIp(pageHost)) {
  out('WARN: page opened by IP and /api/store-url has no engineId — the serving Engine is only recognised via lanAddress.');
}

const browser = await chromium.launch({
  headless: env.HEADED !== '1',
  ...(env.CHROMIUM_PATH ? { executablePath: env.CHROMIUM_PATH } : {}),
});
const rows = [];
const problems = [];
try {
  if (env.SKIP_DESKTOP !== '1') await runPass(browser, 'desktop', servingId, rows, problems);
  if (env.SKIP_MOBILE !== '1') await runPass(browser, 'mobile', servingId, rows, problems);
} finally {
  await browser.close();
}

out();
printTable(rows);
out();
for (const p of problems) out(`FAIL ${p}`);
const failed = rows.filter((r) => r.result === 'FAIL').length + problems.length;
out(`${rows.length - rows.filter((r) => r.result === 'FAIL').length}/${rows.length} links PASS, ${problems.length} pass-level problem(s) → ${failed ? 'FAIL' : 'PASS'}`);
process.exit(failed ? 1 : 0);
