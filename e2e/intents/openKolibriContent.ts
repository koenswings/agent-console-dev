/**
 * Phase 5 Kolibri content Intents (idea#166): open_video / open_exercise.
 *
 * Content/node IDs from Kid CONTENT.seeded.json; live API verified in
 * CONTENT.live.json @2313112 (idea01). Matchers accept dashed + undashed
 * forms (Kolibri API uses 32-hex without dashes). Tries lesson-scoped Learn
 * URLs using fixtures.live.lesson when available.
 *
 * Deferred (unregistered — need Kid App testids): keep_watching, next_resource,
 * exit_lesson, finish_exercise, next_video. Not hardpassable vs stock player + CONTENT pins.
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
 * Click a Kolibri resource by pinned contentId / nodeId (dashed or undashed).
 * Tries data-content-id, data-node-id, data-testid, href; then learn hash nav.
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
  const all = [...contentIds, ...nodeIds];

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
    if ((await loc.count()) > 0) {
      await loc.click({ timeout: 8_000 });
      return;
    }
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
    // Lesson-scoped Learn routes (after facility login)
    const lessonTargets: string[] = [];
    for (const lid of lessonIds) {
      lessonTargets.push(`${origin}/learn/#/lessons/${lid}`);
      lessonTargets.push(`${origin}/learn/#/topics/lesson/${lid}`);
      for (const nid of [nodeIdRaw, nodeId]) {
        lessonTargets.push(`${origin}/learn/#/lessons/${lid}/resource/${nid}`);
      }
    }
    for (const cid of classIds) {
      lessonTargets.push(`${origin}/learn/#/classes/${cid}`);
    }
    for (const target of lessonTargets) {
      try {
        await app.goto(target, { waitUntil: 'domcontentloaded', timeout: 10_000 });
        const still = app.url();
        if (all.some((id) => still.includes(id)) || lessonIds.some((id) => still.includes(id))) {
          // If lesson page loaded, try clicking the resource on that page
          for (const selector of candidates) {
            const loc = app.locator(selector).first();
            if ((await loc.count()) > 0) {
              await loc.click({ timeout: 5_000 });
              return;
            }
          }
          if (all.some((id) => still.includes(id))) return;
        }
      } catch {
        /* try next */
      }
    }
    // Prefer undashed node id (live API style), then dashed
    for (const nid of [nodeIdRaw, nodeId, ...nodeIds]) {
      const target = `${origin}/learn/#/topics/c/${nid}`;
      await app.goto(target, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      const still = app.url();
      if (all.some((id) => still.includes(id))) return;
      const after = app.locator(
        contentIds.map((id) => `[data-content-id="${id}"]`).concat(
          nodeIds.map((id) => `[data-node-id="${id}"]`),
          all.map((id) => `a[href*="${id}"]`),
        ).join(', '),
      ).first();
      if ((await after.count()) > 0) return;
    }
  }

  throw new Error(
    `idea#166 ${action}: resource ${logicalId} (contentId=${contentId}/${contentIdRaw}, ` +
      `nodeId=${nodeId}/${nodeIdRaw}) not found via data-content-id / data-node-id / href / ` +
      `learn hash nav (dashed+undashed). Live import on idea01 (@2313112) — confirm ` +
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

/** Open pinned Grade 5A video (Kid CONTENT.seeded + live @2313112 → open_video). */
export const open_video: IntentFn = async ({ page, instanceId }) => {
  await runOpenContent(page, instanceId, DURATION_FIXTURES.kolibri.video, 'open_video');
};

/** Open pinned Grade 5A exercise (Kid CONTENT.seeded + live @2313112 → open_exercise). */
export const open_exercise: IntentFn = async ({ page, instanceId }) => {
  await runOpenContent(page, instanceId, DURATION_FIXTURES.kolibri.exercise, 'open_exercise');
};
