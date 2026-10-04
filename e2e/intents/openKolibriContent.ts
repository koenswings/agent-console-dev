/**
 * Phase 5 Kolibri content Intents (idea#166): open_video / open_exercise.
 *
 * Content/node IDs from Kid CONTENT.seeded.json; live API verified in
 * CONTENT.live.json @2313112 (idea01). Matchers accept dashed + undashed
 * forms (Kolibri API uses 32-hex without dashes). Tries lesson-scoped Learn
 * URLs using fixtures.live.lesson when available.
 *
 * keep_watching is registered: stay on the pinned video open_video just opened
 * (URL contains content id). No lesson-chrome testids in the Kolibri image.
 * Still unregistered (need Kid App testids): next_resource, exit_lesson,
 * finish_exercise, next_video.
 */
import type { Page } from '@playwright/test';
import type { IntentFn } from './types';
import { DURATION_FIXTURES, uuidForms } from './fixtures';
import { openAppInstance, APP_TAB_URL_RE } from './openApp';

const APP_URL_RE = APP_TAB_URL_RE;

/** Open Kolibri via Path A (Console Open) or Path B (sidecar URL) if needed. */
const ensureKolibriAppPage = async (
  consolePage: Page,
  instanceId: string,
): Promise<Page> => {
  return openAppInstance(consolePage, instanceId, 'kolibri');
};

/** All id spellings to try in selectors / URLs (dashed + Morango raw). */
const idSpellings = (...ids: string[]): string[] => {
  const out = new Set<string>();
  for (const id of ids) {
    if (!id) continue;
    const { dashed, raw } = uuidForms(id);
    out.add(id);
    out.add(dashed);
    out.add(raw);
  }
  return [...out];
};

/**
 * True when the Kolibri page URL is the pinned video (dashed or raw content id).
 * Empty URL and any other content id (including the exercise pin) fail.
 * A <video> element is not sufficient by itself. A lesson-id-only URL is not success.
 */
export function urlHasPinnedVideo(
  url: string,
  contentId: string,
  contentIdRaw: string,
): boolean {
  if (!url || !url.trim()) return false;
  return url.includes(contentId) || url.includes(contentIdRaw);
}

const CONTENT_URL_WAIT_MS = 15_000;

/**
 * open_video / open_exercise succeed only when the URL contains the content id
 * (same bar as keep_watching / urlHasPinnedVideo). A lesson id alone is not success.
 */
export function contentUrlHasPinnedId(
  url: string,
  contentId: string,
  contentIdRaw: string,
): boolean {
  return urlHasPinnedVideo(url, contentId, contentIdRaw);
}

async function waitForContentIdInUrl(
  app: Page,
  contentId: string,
  contentIdRaw: string,
): Promise<boolean> {
  const deadline = Date.now() + CONTENT_URL_WAIT_MS;
  while (Date.now() < deadline) {
    if (urlHasPinnedVideo(app.url(), contentId, contentIdRaw)) return true;
    await app.waitForTimeout(200);
  }
  return urlHasPinnedVideo(app.url(), contentId, contentIdRaw);
}

/**
 * Click a Kolibri resource by pinned contentId / nodeId (dashed or undashed).
 * Tries data-content-id, data-node-id, data-testid, href; then learn hash nav
 * under both /learn and /en/learn. Each click or goto must leave the content id
 * in the URL within 15s or the attempt is discarded.
 */
const openContentByIds = async (
  app: Page,
  opts: {
    contentId: string;
    contentIdRaw: string;
    nodeId: string;
    nodeIdRaw: string;
    action: string;
    logicalId: string;
  },
): Promise<void> => {
  const { contentId, contentIdRaw, nodeId, nodeIdRaw, action, logicalId } = opts;
  const contentIds = idSpellings(contentId, contentIdRaw);
  const nodeIds = idSpellings(nodeId, nodeIdRaw);

  if (urlHasPinnedVideo(app.url(), contentId, contentIdRaw)) return;

  const candidates: string[] = [];
  for (const id of contentIds) {
    candidates.push(
      `[data-content-id="${id}"]`,
      `[data-testid="content-${id}"]`,
      `a[href*="${id}"]`,
      `[href*="${id}"]`,
    );
  }
  for (const id of nodeIds) {
    candidates.push(
      `[data-node-id="${id}"]`,
      `[data-testid="node-${id}"]`,
      `a[href*="${id}"]`,
      `[href*="${id}"]`,
    );
  }

  for (const selector of candidates) {
    const loc = app.locator(selector).first();
    if ((await loc.count()) === 0) continue;
    try {
      await loc.click({ timeout: 8_000 });
    } catch {
      continue;
    }
    if (await waitForContentIdInUrl(app, contentId, contentIdRaw)) return;
  }

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
    const live = DURATION_FIXTURES.kolibri.live;
    const lessonIds = idSpellings(live.lesson.id, live.lesson.idDashed);
    const classIds = idSpellings(live.class.id, live.class.idDashed);
    // Live Kolibri is ${origin}/en/learn/#/home; also keep bare /learn.
    const learnRoots = [`${origin}/en/learn`, `${origin}/learn`];
    const lessonTargets: string[] = [];
    for (const root of learnRoots) {
      for (const lid of lessonIds) {
        lessonTargets.push(`${root}/#/lessons/${lid}`);
        lessonTargets.push(`${root}/#/topics/lesson/${lid}`);
        for (const nid of [nodeIdRaw, nodeId]) {
          lessonTargets.push(`${root}/#/lessons/${lid}/resource/${nid}`);
        }
      }
      for (const cid of classIds) {
        lessonTargets.push(`${root}/#/classes/${cid}`);
      }
    }
    for (const target of lessonTargets) {
      try {
        await app.goto(target, { waitUntil: 'domcontentloaded', timeout: 10_000 });
      } catch {
        continue;
      }
      // Lesson id in the URL is not success — wait for the content id, then try a click.
      if (await waitForContentIdInUrl(app, contentId, contentIdRaw)) return;
      for (const selector of candidates) {
        const loc = app.locator(selector).first();
        if ((await loc.count()) === 0) continue;
        try {
          await loc.click({ timeout: 5_000 });
        } catch {
          continue;
        }
        if (await waitForContentIdInUrl(app, contentId, contentIdRaw)) return;
      }
    }
    for (const root of learnRoots) {
      for (const nid of [nodeIdRaw, nodeId, ...nodeIds]) {
        const target = `${root}/#/topics/c/${nid}`;
        try {
          await app.goto(target, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        } catch {
          continue;
        }
        if (await waitForContentIdInUrl(app, contentId, contentIdRaw)) return;
      }
    }
  }

  const finalUrl = (() => {
    try {
      return app.url() || '(empty)';
    } catch {
      return '(empty)';
    }
  })();
  throw new Error(
    `idea#166 ${action}: resource ${logicalId} (contentId=${contentId}/${contentIdRaw}, ` +
      `nodeId=${nodeId}/${nodeIdRaw}) not found via data-content-id / data-node-id / href / ` +
      `learn hash nav (dashed+undashed, /learn and /en/learn). Final URL ${finalUrl} does not ` +
      `contain the content id. Live import on idea01 (@2313112) — confirm ` +
      `kolibri-grade5a-001 is Running and App tab reached the Learn UI.`,
  );
};

type ContentResource = {
  logicalId: string;
  contentId: string;
  contentIdRaw: string;
  nodeId: string;
  nodeIdRaw: string;
};

const runOpenContent = async (
  page: Page,
  instanceId: string | undefined,
  resource: ContentResource,
  action: 'open_video' | 'open_exercise',
): Promise<void> => {
  const id = instanceId ?? DURATION_FIXTURES.kolibri.instanceId;
  const app = await ensureKolibriAppPage(page, id);
  await openContentByIds(app, {
    contentId: resource.contentId,
    contentIdRaw: resource.contentIdRaw,
    nodeId: resource.nodeId,
    nodeIdRaw: resource.nodeIdRaw,
    action,
    logicalId: resource.logicalId,
  });
};


/**
 * Stay on the video open_video just opened (kolibri_watching → kolibri_watching).
 * Not a Console button and not a second open of the resource.
 */
export const keep_watching: IntentFn = async ({ page, instanceId }) => {
  const id = instanceId ?? DURATION_FIXTURES.kolibri.instanceId;
  const app = await ensureKolibriAppPage(page, id);
  const video = DURATION_FIXTURES.kolibri.video;
  const url = app.url();
  const onPinned = urlHasPinnedVideo(url, video.contentId, video.contentIdRaw);
  if (!onPinned) {
    throw new Error(
      `idea#166 keep_watching: pinned video ${video.logicalId} ` +
        `(contentId=${video.contentId}/${video.contentIdRaw}) is not the current page ` +
        `(url=${url || '(empty)'}). Lesson chrome testids are not the missing piece — ` +
        `stay on the video open_video just opened; do not open a new resource.`,
    );
  }
  // <video> is accepted only as extra evidence when the URL already has the pin.
  await app.locator('video').count().catch(() => 0);
};

/** Open pinned Grade 5A video (Kid CONTENT.seeded + live @2313112 → open_video). */
export const open_video: IntentFn = async ({ page, instanceId }) => {
  await runOpenContent(page, instanceId, DURATION_FIXTURES.kolibri.video, 'open_video');
};

/** Open pinned Grade 5A exercise (Kid CONTENT.seeded + live @2313112 → open_exercise). */
export const open_exercise: IntentFn = async ({ page, instanceId }) => {
  await runOpenContent(page, instanceId, DURATION_FIXTURES.kolibri.exercise, 'open_exercise');
};
