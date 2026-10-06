/**
 * Phase 3+ classroom Intents: open Kolibri / Nextcloud (idea#166/#168).
 *
 * Path A — click `open-instance-<id>` when Console shows a Running card.
 * Path B — navigate sidecar HTTP URL (Kid post-dock-restore-running.sh) when
 *          the overview card / Open button is missing (sidecar ≠ Console Running
 *          until Axle Path A startInstances lands).
 *
 * After either path: teacher/learner login via appLogin.ts (Kid auth).
 */
import type { Page } from '@playwright/test';
import type { IntentFn } from './types';
import { sel } from './selectors';
import { DURATION_FIXTURES } from './fixtures';
import {
  resolveStartInstanceId,
  runStartInstance,
  isInstanceAlreadyRunning,
} from './operatorActions';
import { attemptAppLogin } from './appLogin';
import {
  assertKolibriPageOk,
  trackMainDocuments,
  waitKolibriTeacherLanding,
} from './kolibriPageGuard';
import {
  APP_TAB_URL_RE,
  appKindForInstance,
  appKindForUrl,
  resolveSidecarUrl,
  sidecarReadyTimeoutMs,
  isSidecarHttpReadyStatus,
  type SidecarApp,
} from './sidecarUrls';

export {
  appKindForUrl,
  resolveSidecarUrl,
  sidecarPort,
  SIDECAR_DEFAULT_PORTS,
  APP_TAB_URL_RE,
  sidecarReadyTimeoutMs,
  isSidecarHttpReadyStatus,
} from './sidecarUrls';

/**
 * Prefer an already-open App tab (newest first). With `kind`, only a tab of that
 * App counts: a leftover Kolibri tab is never returned for Nextcloud (r9).
 */
export const resolveAppPage = (consolePage: Page, kind?: SidecarApp): Page => {
  const pages = consolePage.context().pages();
  for (let i = pages.length - 1; i >= 0; i--) {
    const p = pages[i]!;
    try {
      if (p.isClosed?.()) continue;
      const url = p.url();
      if (kind ? p !== consolePage && appKindForUrl(url) === kind : APP_TAB_URL_RE.test(url)) return p;
    } catch {
      /* page may be closed */
    }
  }
  return consolePage;
};

/** True when `p` is a tab of App `kind` (never the Console tab). */
export const isAppTabOfKind = (p: Page, consolePage: Page, kind: SidecarApp): boolean => {
  try {
    return p !== consolePage && appKindForUrl(p.url()) === kind;
  } catch {
    return false;
  }
};

/**
 * Path A: click open-instance-<id> when visible + enabled.
 * Returns the App popup Page, or the Console page if navigation stayed in-tab.
 * Returns null when the Open control is missing/disabled (caller tries Path B).
 */
export const tryOpenInstancePathA = async (
  page: Page,
  instanceId: string,
  kind?: SidecarApp,
): Promise<Page | null> => {
  const openBtn = page.locator(sel.openInstance(instanceId));
  const count = await openBtn.count();
  if (!count) return null;
  const visible = await openBtn.isVisible().catch(() => false);
  if (!visible) return null;
  const disabled = await openBtn.isDisabled().catch(() => false);
  // <a> tags often report not disabled; also check aria-disabled
  const ariaDisabled = (await openBtn.getAttribute('aria-disabled')) === 'true';
  if (disabled || ariaDisabled) return null;

  const popupPromise = page.context().waitForEvent('page', { timeout: 8_000 }).catch(() => null);
  await openBtn.click();
  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    return popup;
  }
  // Same-tab navigation or link handled without popup
  return resolveAppPage(page, kind);
};

/**
 * Poll sidecar until HTTP 2xx/3xx (Prefer A r19: Automerge Running ≠ sidecar up).
 * Loud-fail on timeout — never soft-pass ERR_CONNECTION_REFUSED.
 */
export async function waitForSidecarHttpReady(
  consolePage: Page,
  app: SidecarApp,
): Promise<string> {
  const base = resolveSidecarUrl(app, consolePage.url());
  const budget = sidecarReadyTimeoutMs();
  const deadline = Date.now() + budget;
  let last = 'no-attempt';
  while (Date.now() < deadline) {
    try {
      const resp = await consolePage.request.get(base, {
        timeout: 5_000,
        maxRedirects: 0,
        failOnStatusCode: false,
      });
      const status = resp.status();
      if (isSidecarHttpReadyStatus(status)) return base;
      last = `HTTP ${status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await consolePage.waitForTimeout(1_000);
  }
  throw new Error(
    `idea#168 sidecar not ready: ${base} within ${budget}ms (last=${last}). ` +
      `Automerge Running ≠ docker/sidecar up (r19). ` +
      `Set DURATION_SIDECAR_READY_MS / DURATION_${app.toUpperCase()}_URL|PORT. ` +
      `No soft-pass connection refused.`,
  );
}

/**
 * Prefer A r22: require consecutive successful sidecar polls so delayed SIGTERM
 * after restore/move does not race a single lucky 2xx.
 */
export async function waitForSidecarStable(
  consolePage: Page,
  app: SidecarApp,
  opts: { consecutive?: number; intervalMs?: number; budgetMs?: number } = {},
): Promise<string> {
  const need = opts.consecutive ?? 3;
  const intervalMs = opts.intervalMs ?? 1_500;
  const budget = opts.budgetMs ?? sidecarReadyTimeoutMs();
  const base = resolveSidecarUrl(app, consolePage.url());
  const deadline = Date.now() + Math.max(budget, need * intervalMs);
  let streak = 0;
  let last = 'no-attempt';
  while (Date.now() < deadline) {
    try {
      const resp = await consolePage.request.get(base, {
        timeout: 5_000,
        maxRedirects: 0,
        failOnStatusCode: false,
      });
      const status = resp.status();
      if (isSidecarHttpReadyStatus(status)) {
        streak += 1;
        last = `HTTP ${status} streak=${streak}/${need}`;
        if (streak >= need) return base;
      } else {
        streak = 0;
        last = `HTTP ${status}`;
      }
    } catch (err) {
      streak = 0;
      last = err instanceof Error ? err.message : String(err);
    }
    await consolePage.waitForTimeout(intervalMs);
  }
  throw new Error(
    `idea#168 sidecar not stable: ${base} need ${need} consecutive ready polls ` +
      `within ${budget}ms (last=${last}). Delayed SIGTERM after restore/move (r22). No soft-pass.`,
  );
}

/**
 * Path B: wait sidecar HTTP ready → goto base URL.
 * Opens a new page in the Console context so Console UI stays available.
 */
export const openInstancePathB = async (
  consolePage: Page,
  app: SidecarApp,
): Promise<Page> => {
  const base = await waitForSidecarHttpReady(consolePage, app);
  const appPage = await consolePage.context().newPage();
  try {
    const resp = await appPage.goto(base, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    if (resp && resp.status() >= 400) {
      await appPage.close().catch(() => {});
      throw new Error(
        `idea#168 Path B: sidecar ${base} returned HTTP ${resp.status()}. ` +
          `Run Kid post-dock-restore-running.sh --mode sidecar on this host ` +
          `(Kolibri :18080/:18081, Nextcloud :18280).`,
      );
    }
  } catch (err) {
    await appPage.close().catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('idea#168 Path B:') || msg.includes('idea#168 sidecar not ready')) throw err;
    throw new Error(
      `idea#168 Path B: sidecar ${base} unreachable (${msg}). ` +
        `Neither Console open-instance card (Path A) nor sidecar HTTP (Path B) available. ` +
        `Override with DURATION_${app.toUpperCase()}_URL or DURATION_${app.toUpperCase()}_PORT. ` +
        `Script: cd /home/pi/idea/agents/agent-app-dev && ` +
        `bash tests/duration-tests/scripts/post-dock-restore-running.sh --mode sidecar`,
    );
  }
  return appPage;
};

const collectCandidateIds = async (page: Page, preferred: string): Promise<string[]> => {
  const candidates = [preferred];
  for (const prefix of ['open-instance-', 'start-instance-'] as const) {
    const loc = page.locator(`[data-testid^="${prefix}"][data-testid*="grade5a"]`);
    if (!(await loc.count())) continue;
    const tid = await loc.first().getAttribute('data-testid');
    const gid = tid?.replace(new RegExp(`^${prefix}`), '') ?? '';
    if (gid && !candidates.includes(gid)) candidates.push(gid);
  }
  return candidates;
};

/**
 * Prefer A r19: UI Running ≠ sidecar up.
 * start (no-op if Running) → if Open missing while Running, force-restart →
 * wait Open and/or sidecar HTTP. Returns resolved instance id.
 */
export async function ensureInstanceRunningForOpen(
  page: Page,
  instanceId?: string,
  app?: SidecarApp,
): Promise<string> {
  const preferred = resolveStartInstanceId(instanceId);
  const kind = app ?? appKindForInstance(preferred);
  await page
    .locator(sel.opOverview)
    .or(page.locator(sel.networkTree))
    .or(page.locator(sel.consoleOverview))
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => {});

  let id = await runStartInstance(page, preferred);
  let candidates = await collectCandidateIds(page, id);

  const openVisible = async (cid: string) =>
    page.locator(sel.openInstance(cid)).isVisible().catch(() => false);

  // Short wait for Open after start/no-op
  const earlyDeadline = Date.now() + 8_000;
  while (Date.now() < earlyDeadline) {
    for (const cid of candidates) {
      if (await openVisible(cid)) return cid;
    }
    await page.waitForTimeout(400);
  }

  // Ghost Running: UI Running / Start disabled but Open gone → force restart
  const anyRunningNoOpen = async (): Promise<string | null> => {
    for (const cid of candidates) {
      if (await openVisible(cid)) return null;
      if (await isInstanceAlreadyRunning(page, cid)) return cid;
    }
    return null;
  };

  const ghost = await anyRunningNoOpen();
  if (ghost) {
    id = await runStartInstance(page, ghost, { forceRestart: true });
    candidates = await collectCandidateIds(page, id);
  } else if (!(await openVisible(id))) {
    // Stopped / no Open — start already attempted; try start again if Start enabled
    id = await runStartInstance(page, preferred);
    candidates = await collectCandidateIds(page, id);
  }

  const budget = sidecarReadyTimeoutMs();
  const deadline = Date.now() + budget;
  let sidecarOk = false;
  while (Date.now() < deadline) {
    for (const cid of candidates) {
      if (await openVisible(cid)) return cid;
    }
    // Sidecar up → Path B-safe even if Open still painting
    try {
      const base = resolveSidecarUrl(kind, page.url());
      const resp = await page.request.get(base, {
        timeout: 3_000,
        maxRedirects: 0,
        failOnStatusCode: false,
      });
      if (isSidecarHttpReadyStatus(resp.status())) {
        sidecarOk = true;
        // Prefer returning id that looks Running
        for (const cid of candidates) {
          if (await isInstanceAlreadyRunning(page, cid)) return cid;
        }
        return id;
      }
    } catch {
      /* keep polling */
    }
    await page.waitForTimeout(1_000);
  }

  const visibleOpen: string[] = [];
  const opens = page.locator('[data-testid^="open-instance-"]');
  const n = await opens.count();
  for (let i = 0; i < n; i++) {
    const tid = await opens.nth(i).getAttribute('data-testid');
    if (tid) visibleOpen.push(tid.replace(/^open-instance-/, ''));
  }
  throw new Error(
    `idea#168 open_app: Open unavailable and sidecar not ready within ${budget}ms ` +
      `(preferred=${preferred}, id=${id}, sidecarOk=${sidecarOk}, ` +
      `visible open-instance=[${visibleOpen.join(', ')}]). ` +
      `r19: Automerge Running ≠ sidecar — force-restart + DURATION_SIDECAR_READY_MS. No soft-pass.`,
  );
}

const hasConsoleStartControl = async (
  page: Page,
  preferred: string,
): Promise<boolean> => {
  if (await page.locator(sel.startInstance(preferred)).isVisible().catch(() => false)) {
    return true;
  }
  if (
    await page
      .locator('[data-testid^="start-instance-"][data-testid*="grade5a"]')
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    return true;
  }
  return false;
};

/**
 * Open App for instance: Path A / Path B.
 * Prefer A r19: Automerge Running ≠ sidecar — force-restart if Open missing;
 * poll sidecar HTTP before Path B (DURATION_SIDECAR_READY_MS).
 * Path A only when Open visible. Classroom Path B still waits sidecar ready.
 */
export const openAppInstance = async (
  page: Page,
  instanceId: string,
  app?: SidecarApp,
): Promise<Page> => {
  const preferred = resolveStartInstanceId(instanceId);
  const kind = app ?? appKindForInstance(preferred);

  // Already on a tab of THIS App? (kind-aware: a leftover Kolibri tab after a
  // mid-walk Kolibri segment is not Nextcloud; cover-all-8c8fe30-r9 FAIL@21.)
  const existing = resolveAppPage(page, kind);
  if (isAppTabOfKind(existing, page, kind)) return existing;

  const pick = (opened: Page | null): Page | null => {
    if (!opened) return null;
    if (isAppTabOfKind(opened, page, kind)) return opened;
    const landed = resolveAppPage(page, kind);
    return isAppTabOfKind(landed, page, kind) ? landed : null;
  };

  // Path A only when Open visible
  const earlyA = pick(await tryOpenInstancePathA(page, preferred, kind));
  if (earlyA) return earlyA;

  if (await hasConsoleStartControl(page, preferred)) {
    const id = await ensureInstanceRunningForOpen(page, preferred, kind);
    const pathA = pick(await tryOpenInstancePathA(page, id, kind));
    if (pathA) return pathA;
    // Open still missing — Path B only after sidecar HTTP ready
    return openInstancePathB(page, kind);
  }

  // Classroom / no Start control — Path B waits sidecar ready
  const pathA = pick(await tryOpenInstancePathA(page, preferred, kind));
  if (pathA) return pathA;
  return openInstancePathB(page, kind);
};

/**
 * @deprecated Prefer openAppInstance (Path A+B). Kept for callers that only want Path A.
 * Throws if Open button missing (no Path B).
 */
export const openInstanceFromOverview = async (
  page: Page,
  instanceId: string,
): Promise<Page | null> => {
  // Prefer A: ensure Running then Path A/B (same as openAppInstance)
  return openAppInstance(page, instanceId);
};

const openAndLogin = async (
  page: Page,
  instanceId: string,
  app: SidecarApp,
  creds: { username: string; password: string },
): Promise<void> => {
  const appPage = await openAppInstance(page, instanceId, app);
  await attemptAppLogin(appPage, creds).catch(() => 'no_form');
};

/**
 * open_kolibri_as_teacher — open the Kolibri tab, sign in as the fixture teacher,
 * land on Coach classes. r31: fails loud (URL + HTTP status) on any Kolibri 5xx
 * main document, and when neither the login form nor a signed-in coach/facility
 * view renders (a missing login form is no longer a silent pass).
 */
export const open_kolibri_as_teacher: IntentFn = async ({ page, instanceId }) => {
  const id = instanceId ?? DURATION_FIXTURES.kolibri.instanceId;
  // Context-level listener first, so the App popup's first document status is recorded.
  trackMainDocuments(page);
  const app = await openAppInstance(page, id, 'kolibri');
  trackMainDocuments(app);
  await assertKolibriPageOk(app, 'open_kolibri_as_teacher (app tab)');
  await attemptAppLogin(app, DURATION_FIXTURES.kolibri.auth.teacher).catch(() => 'no_form');
  await assertKolibriPageOk(app, 'open_kolibri_as_teacher (after sign-in)');

  // Land on Coach classes (kolibri_manage entry) when App tab is Kolibri
  let response: Awaited<ReturnType<Page['goto']>> = null;
  try {
    const url = app.url();
    if (APP_TAB_URL_RE.test(url) && !/nextcloud|18280/i.test(url)) {
      const origin = new URL(url).origin;
      response = await app
        .goto(`${origin}/en/coach/#/classes`, { waitUntil: 'domcontentloaded', timeout: 15_000 })
        .catch(async () =>
          app.goto(`${origin}/coach/#/classes`, {
            waitUntil: 'domcontentloaded',
            timeout: 15_000,
          }),
        );
    }
  } catch {
    /* nav error: the landing wait below fails loud with URL + status */
  }
  await assertKolibriPageOk(app, 'open_kolibri_as_teacher (coach classes)', response);
  await waitKolibriTeacherLanding(app, 'open_kolibri_as_teacher');
};

export const open_kolibri_as_learner: IntentFn = async ({ page, instanceId }) => {
  await openAndLogin(
    page,
    instanceId ?? DURATION_FIXTURES.kolibri.instanceId,
    'kolibri',
    DURATION_FIXTURES.kolibri.auth.learner,
  );
};

/** @deprecated Registry uses nextcloudDeep.open_nextcloud_as_teacher (verified sign-in). */
export const open_nextcloud_as_teacher: IntentFn = async ({ page, instanceId }) => {
  await openAndLogin(
    page,
    instanceId ?? DURATION_FIXTURES.nextcloud.instanceId,
    'nextcloud',
    DURATION_FIXTURES.nextcloud.auth.teacher,
  );
};

/** @deprecated Registry uses nextcloudDeep.open_nextcloud_as_learner (verified sign-in). */
export const open_nextcloud_as_learner: IntentFn = async ({ page, instanceId }) => {
  await openAndLogin(
    page,
    instanceId ?? DURATION_FIXTURES.nextcloud.instanceId,
    'nextcloud',
    DURATION_FIXTURES.nextcloud.auth.learner,
  );
};
