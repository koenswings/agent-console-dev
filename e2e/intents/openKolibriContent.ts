/**
 * Phase 5 Kolibri content Intents (idea#166): open_video / open_exercise.
 *
 * Kid @0bca699 CONTENT.seeded.json pins contentId/nodeId. Console opens the
 * Running instance (window.open tab); adapters then target id-keyed selectors
 * or hrefs containing the UUID on the App page. Live channel import is still
 * pending — adapters throw a clear blocker if the resource is not in the DOM.
 *
 * Deferred (pure in-App lesson chrome; school-day samples but unreachable
 * without a Running imported player): keep_watching, next_resource, exit_lesson.
 */
import type { Page } from '@playwright/test';
import type { IntentFn } from './types';
import { DURATION_FIXTURES } from './fixtures';
import { openInstanceFromOverview } from './openApp';

const APP_URL_RE = /kolibri|18080|\/learn|\/coach|\/facility/i;

/** Prefer an already-open Kolibri tab; else the Console page. */
const resolveAppPage = (consolePage: Page): Page => {
  const pages = consolePage.context().pages();
  for (let i = pages.length - 1; i >= 0; i--) {
    const p = pages[i]!;
    try {
      if (APP_URL_RE.test(p.url())) return p;
    } catch {
      /* page may be closed */
    }
  }
  return consolePage;
};

/** Open Kolibri instance from Console if no App tab is present yet. */
const ensureKolibriAppPage = async (
  consolePage: Page,
  instanceId: string,
): Promise<Page> => {
  let app = resolveAppPage(consolePage);
  if (APP_URL_RE.test(app.url())) return app;
  const popup = await openInstanceFromOverview(consolePage, instanceId);
  if (popup) return popup;
  app = resolveAppPage(consolePage);
  return app;
};

/**
 * Click a Kolibri resource by pinned contentId / nodeId.
 * Tries data-content-id, data-node-id, data-testid, and href containing UUID;
 * then hash-navigates to /learn/#/topics/c/<nodeId> when already on App origin.
 */
const openContentByIds = async (
  app: Page,
  opts: { contentId: string; nodeId: string; action: string; logicalId: string },
): Promise<void> => {
  const { contentId, nodeId, action, logicalId } = opts;
  const candidates = [
    `[data-content-id="${contentId}"]`,
    `[data-node-id="${nodeId}"]`,
    `[data-testid="content-${contentId}"]`,
    `[data-testid="node-${nodeId}"]`,
    `a[href*="${contentId}"]`,
    `a[href*="${nodeId}"]`,
    `[href*="${contentId}"]`,
    `[href*="${nodeId}"]`,
  ];

  for (const selector of candidates) {
    const loc = app.locator(selector).first();
    if ((await loc.count()) > 0) {
      await loc.click({ timeout: 8_000 });
      return;
    }
  }

  // Thin hash nav when we already landed on a Kolibri origin (Running + imported).
  let origin: string | null = null;
  try {
    const url = app.url();
    if (url && url !== 'about:blank' && APP_URL_RE.test(url)) {
      origin = new URL(url).origin;
    }
  } catch {
    origin = null;
  }

  if (origin) {
    const target = `${origin}/learn/#/topics/c/${nodeId}`;
    await app.goto(target, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    // Confirm something content-scoped appeared, or URL retained the node id
    const still = app.url();
    if (still.includes(nodeId) || still.includes(contentId)) return;
    const after = app.locator(
      `[data-content-id="${contentId}"], [data-node-id="${nodeId}"], a[href*="${nodeId}"]`,
    ).first();
    if ((await after.count()) > 0) return;
  }

  throw new Error(
    `idea#166 ${action}: resource ${logicalId} (contentId=${contentId}, nodeId=${nodeId}) ` +
      `not found via data-content-id / data-node-id / href / learn hash nav. ` +
      `Blocker: Kid live channel import still pending (CONTENT.seeded.json ` +
      `liveImportStatus=pending). Needs Running kolibri-grade5a-001 with Grade 5A channel.`,
  );
};

const runOpenContent = async (
  page: Page,
  instanceId: string | undefined,
  resource: { logicalId: string; contentId: string; nodeId: string },
  action: 'open_video' | 'open_exercise',
): Promise<void> => {
  const id = instanceId ?? DURATION_FIXTURES.kolibri.instanceId;
  const app = await ensureKolibriAppPage(page, id);
  await openContentByIds(app, {
    contentId: resource.contentId,
    nodeId: resource.nodeId,
    action,
    logicalId: resource.logicalId,
  });
};

/** Open pinned Grade 5A video (Kid CONTENT.seeded.json → open_video). */
export const open_video: IntentFn = async ({ page, instanceId }) => {
  await runOpenContent(page, instanceId, DURATION_FIXTURES.kolibri.video, 'open_video');
};

/** Open pinned Grade 5A exercise (Kid CONTENT.seeded.json → open_exercise). */
export const open_exercise: IntentFn = async ({ page, instanceId }) => {
  await runOpenContent(page, instanceId, DURATION_FIXTURES.kolibri.exercise, 'open_exercise');
};
