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
import { attemptAppLogin } from './appLogin';
import {
  APP_TAB_URL_RE,
  appKindForInstance,
  resolveSidecarUrl,
  type SidecarApp,
} from './sidecarUrls';

export { resolveSidecarUrl, sidecarPort, SIDECAR_DEFAULT_PORTS, APP_TAB_URL_RE } from './sidecarUrls';

/**
 * Prefer an already-open App tab matching Kolibri/Nextcloud sidecar URLs.
 */
export const resolveAppPage = (consolePage: Page): Page => {
  const pages = consolePage.context().pages();
  for (let i = pages.length - 1; i >= 0; i--) {
    const p = pages[i]!;
    try {
      if (APP_TAB_URL_RE.test(p.url())) return p;
    } catch {
      /* page may be closed */
    }
  }
  return consolePage;
};

/**
 * Path A: click open-instance-<id> when visible + enabled.
 * Returns the App popup Page, or the Console page if navigation stayed in-tab.
 * Returns null when the Open control is missing/disabled (caller tries Path B).
 */
export const tryOpenInstancePathA = async (
  page: Page,
  instanceId: string,
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
  return resolveAppPage(page);
};

/**
 * Path B: goto sidecar base URL (same host as Console, port from defaults/env).
 * Opens a new page in the Console context so Console UI stays available.
 * Throws loud if HTTP is unreachable.
 */
export const openInstancePathB = async (
  consolePage: Page,
  app: SidecarApp,
): Promise<Page> => {
  const base = resolveSidecarUrl(app, consolePage.url());
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
    if (msg.includes('idea#168 Path B:')) throw err;
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

/**
 * Open App for instance: Path A (Console Open) → else Path B (sidecar URL).
 * Fail loud if both fail.
 */
export const openAppInstance = async (
  page: Page,
  instanceId: string,
  app?: SidecarApp,
): Promise<Page> => {
  const kind = app ?? appKindForInstance(instanceId);

  // Already on an App tab?
  const existing = resolveAppPage(page);
  if (APP_TAB_URL_RE.test(existing.url())) return existing;

  // Path A — only attempt when overview (or op layout with Open) might show the control
  const pathA = await tryOpenInstancePathA(page, instanceId);
  if (pathA) {
    // Confirm we actually landed on an App URL; otherwise fall through to Path B
    const landed = resolveAppPage(page);
    if (pathA !== page && APP_TAB_URL_RE.test(pathA.url())) return pathA;
    if (APP_TAB_URL_RE.test(landed.url())) return landed;
  }

  // Path B — sidecar HTTP
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
  // Soft-wait for overview if present; don't hard-fail (Path B may still work)
  await page.locator(sel.consoleOverview).or(page.locator(sel.opOverview)).first()
    .waitFor({ state: 'visible', timeout: 8_000 })
    .catch(() => {});
  const pathA = await tryOpenInstancePathA(page, instanceId);
  if (pathA) return pathA;
  // Fall through to Path B so open_video / open_exercise keep working
  const kind = appKindForInstance(instanceId);
  return openInstancePathB(page, kind);
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

export const open_kolibri_as_teacher: IntentFn = async ({ page, instanceId }) => {
  const id = instanceId ?? DURATION_FIXTURES.kolibri.instanceId;
  await openAndLogin(page, id, 'kolibri', DURATION_FIXTURES.kolibri.auth.teacher);
  // Land on Coach classes (kolibri_manage entry) when App tab is Kolibri
  const app = resolveAppPage(page);
  try {
    const url = app.url();
    if (APP_TAB_URL_RE.test(url) && !/nextcloud|18280/i.test(url)) {
      const origin = new URL(url).origin;
      await app
        .goto(`${origin}/en/coach/#/classes`, { waitUntil: 'domcontentloaded', timeout: 15_000 })
        .catch(async () => {
          await app.goto(`${origin}/coach/#/classes`, {
            waitUntil: 'domcontentloaded',
            timeout: 15_000,
          });
        });
    }
  } catch {
    /* coaching Intents will re-nav / fail loud */
  }
};

export const open_kolibri_as_learner: IntentFn = async ({ page, instanceId }) => {
  await openAndLogin(
    page,
    instanceId ?? DURATION_FIXTURES.kolibri.instanceId,
    'kolibri',
    DURATION_FIXTURES.kolibri.auth.learner,
  );
};

export const open_nextcloud_as_teacher: IntentFn = async ({ page, instanceId }) => {
  await openAndLogin(
    page,
    instanceId ?? DURATION_FIXTURES.nextcloud.instanceId,
    'nextcloud',
    DURATION_FIXTURES.nextcloud.auth.teacher,
  );
};

export const open_nextcloud_as_learner: IntentFn = async ({ page, instanceId }) => {
  await openAndLogin(
    page,
    instanceId ?? DURATION_FIXTURES.nextcloud.instanceId,
    'nextcloud',
    DURATION_FIXTURES.nextcloud.auth.learner,
  );
};
