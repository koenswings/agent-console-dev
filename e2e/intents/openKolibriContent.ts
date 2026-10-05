/**
 * Phase 5 Kolibri content Intents (idea#166): open_video / open_exercise.
 *
 * Content/node IDs from Kid CONTENT.seeded.json; live API verified in
 * CONTENT.live.json @2313112 (idea01). Matchers accept dashed + undashed
 * forms (Kolibri API uses 32-hex without dashes). Navigates via the parent
 * topic card, then Kolibri's /topics/c/<nodeId> deep link.
 *
 * Success = Learn URL is /topics/c/<pinned ContentNode id> (Kolibri TOPICS_CONTENT).
 * Kolibri never puts content_id in the URL; the node id is the URL proof.
 * keep_watching is registered: stay on the pinned video open_video just opened
 * (same node route). No lesson-chrome testids in the Kolibri image.
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

/** 32-hex lowercase, no dashes (Kolibri / Morango raw form). */
const rawHex = (id: string): string => id.replace(/-/g, '').toLowerCase();

/**
 * Kolibri Learn TOPICS_CONTENT route: `#/topics[/<deviceId>]/c/<contentNodeId>`.
 * Returns the raw ContentNode id, or null for any other route (home, topic
 * folder `/topics/t/…`, lessons, …). Query string after the id is ignored.
 */
export function kolibriContentRouteNodeId(url: string): string | null {
  if (!url || !url.trim()) return null;
  const hashAt = url.indexOf('#');
  if (hashAt < 0) return null;
  const route = url.slice(hashAt + 1).split('?')[0];
  const m = /^\/topics(?:\/[A-Za-z0-9_-]+)?\/c\/([0-9a-fA-F-]{32,36})\/?$/.exec(route);
  if (!m) return null;
  const id = rawHex(m[1]);
  return /^[0-9a-f]{32}$/.test(id) ? id : null;
}

type PinnedNode = { nodeId: string; nodeIdRaw: string };

/**
 * True when the Kolibri page is the pinned resource's content page:
 * `/topics/c/<pinned ContentNode id>` (dashed or raw). Kolibri never puts the
 * content_id in the Learn URL, so the node id is the only URL proof.
 * A topic folder, home, lesson-only URL, another node (including the exercise
 * pin), or an empty URL fails.
 */
export function urlHasPinnedVideo(url: string, pin: PinnedNode): boolean {
  const routeId = kolibriContentRouteNodeId(url);
  if (!routeId) return false;
  return routeId === rawHex(pin.nodeIdRaw || pin.nodeId) || routeId === rawHex(pin.nodeId);
}

/** open_video / open_exercise success bar (same as keep_watching). */
export function contentUrlHasPinnedId(url: string, pin: PinnedNode): boolean {
  return urlHasPinnedVideo(url, pin);
}

const CONTENT_URL_WAIT_MS = 15_000;
const CARD_WAIT_MS = 15_000;

async function waitForPinnedRoute(app: Page, pin: PinnedNode, ms = CONTENT_URL_WAIT_MS): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (urlHasPinnedVideo(app.url(), pin)) return true;
    await app.waitForTimeout(200);
  }
  return urlHasPinnedVideo(app.url(), pin);
}

/** Selectors for the pinned resource card/link (node href first, then title). */
export function resourceCardSelectors(opts: {
  contentId: string;
  contentIdRaw: string;
  nodeId: string;
  nodeIdRaw: string;
  title?: string;
}): string[] {
  const out: string[] = [];
  for (const id of idSpellings(opts.nodeId, opts.nodeIdRaw)) {
    out.push(
      `a[href*="/topics/c/${id}"]`,
      `[data-node-id="${id}"]`,
      `[data-testid="node-${id}"]`,
      `a[href*="${id}"]`,
    );
  }
  for (const id of idSpellings(opts.contentId, opts.contentIdRaw)) {
    out.push(`[data-content-id="${id}"]`, `[data-testid="content-${id}"]`);
  }
  if (opts.title) {
    const q = opts.title.replace(/"/g, '\\"');
    out.push(`a:has-text("${q}")`, `[role="link"]:has-text("${q}")`, `text="${q}"`);
  }
  return out;
}

/** Click the first visible card matching selectors; true once the pinned route is reached. */
async function clickCardToPinnedRoute(
  app: Page,
  selectors: string[],
  pin: PinnedNode,
  clickTimeout: number,
): Promise<boolean> {
  for (const selector of selectors) {
    const loc = app.locator(selector).first();
    if ((await loc.count()) === 0) continue;
    try {
      await loc.click({ timeout: clickTimeout });
    } catch {
      continue;
    }
    if (await waitForPinnedRoute(app, pin)) return true;
  }
  return false;
}

/** Wait until any selector has a match (Learn grid renders after API fetch). */
async function waitForAnyCard(app: Page, selectors: string[], ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    for (const s of selectors) {
      if ((await app.locator(s).count().catch(() => 0)) > 0) return true;
    }
    await app.waitForTimeout(250);
  }
  return false;
}

/**
 * Open the pinned Kolibri resource so the Learn URL is `/topics/c/<nodeId>`.
 * 1. Already there → done.
 * 2. Click its card on the current page (node href / data ids / title).
 * 3. Real Learn UI: parent topic `/topics/t/<parent>` → click the card.
 * 4. Kolibri's own content deep link `/topics/c/<nodeId>` (Kid: same player).
 * Each attempt must reach the pinned node route within 15s. Loud-fail otherwise.
 */
export const openContentByIds = async (
  app: Page,
  opts: {
    contentId: string;
    contentIdRaw: string;
    nodeId: string;
    nodeIdRaw: string;
    title?: string;
    parentTopicNodeIdRaw?: string;
    action: string;
    logicalId: string;
  },
): Promise<void> => {
  const { contentId, contentIdRaw, nodeId, nodeIdRaw, action, logicalId } = opts;
  const pin: PinnedNode = { nodeId, nodeIdRaw };
  const tried: string[] = [];

  if (urlHasPinnedVideo(app.url(), pin)) return;

  const selectors = resourceCardSelectors(opts);
  tried.push('card click on current page');
  if (await clickCardToPinnedRoute(app, selectors, pin, 8_000)) return;

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
    // Live Kolibri is ${origin}/en/learn/#/home; also keep bare /learn.
    const learnRoots = [`${origin}/en/learn`, `${origin}/learn`];

    if (opts.parentTopicNodeIdRaw) {
      for (const root of learnRoots) {
        const target = `${root}/#/topics/t/${opts.parentTopicNodeIdRaw}`;
        tried.push(`parent topic ${target} → card click`);
        try {
          await app.goto(target, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        } catch {
          continue;
        }
        if (!(await waitForAnyCard(app, selectors, CARD_WAIT_MS))) continue;
        if (await clickCardToPinnedRoute(app, selectors, pin, 8_000)) return;
      }
    }

    for (const root of learnRoots) {
      const target = `${root}/#/topics/c/${rawHex(nodeIdRaw || nodeId)}`;
      tried.push(`deep link ${target}`);
      try {
        await app.goto(target, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      } catch {
        continue;
      }
      if (await waitForPinnedRoute(app, pin)) return;
    }
  } else {
    tried.push('(no Kolibri origin — App tab URL did not match; skipped topic/deep-link nav)');
  }

  const finalUrl = (() => {
    try {
      return app.url() || '(empty)';
    } catch {
      return '(empty)';
    }
  })();
  throw new Error(
    `idea#166 ${action}: resource ${logicalId} (nodeId=${nodeId}/${nodeIdRaw}, ` +
      `contentId=${contentId}/${contentIdRaw}) did not reach Kolibri content page ` +
      `/topics/c/${rawHex(nodeIdRaw || nodeId)}. Tried: ${tried.join('; ')}. ` +
      `Final URL ${finalUrl}. Confirm kolibri-grade5a-001 is Running and the App tab reached the Learn UI.`,
  );
};

type ContentResource = {
  logicalId: string;
  contentId: string;
  contentIdRaw: string;
  nodeId: string;
  nodeIdRaw: string;
  title?: string;
  parentTopicNodeIdRaw?: string;
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
    title: resource.title,
    parentTopicNodeIdRaw: resource.parentTopicNodeIdRaw,
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
  const onPinned = urlHasPinnedVideo(url, video);
  if (!onPinned) {
    throw new Error(
      `idea#166 keep_watching: pinned video ${video.logicalId} ` +
        `(Learn route /topics/c/${video.nodeIdRaw}) is not the current page ` +
        `(url=${url || '(empty)'}). Lesson chrome testids are not the missing piece — ` +
        `stay on the video open_video just opened; do not open a new resource.`,
    );
  }
  // <video> is accepted only as extra evidence when the URL already has the pin.
  await app.locator('video').count().catch(() => 0);
};

/**
 * Kolibri 0.15.5 LearningActivityBar "resource list" control (upstream markup,
 * not Kid testids): KIconButton `data-test="bar_viewTopicResourcesButton"` /
 * `bar_viewLessonPlanButton`, aria-label "View folder resources" / "View lesson
 * resources". On narrow windows it moves into More options (`moreOptionsButton`
 * → `menu_*`).
 */
export const RESOURCE_LIST_BAR_SELECTORS = [
  '[data-test="bar_viewTopicResourcesButton"]',
  '[data-test="bar_viewLessonPlanButton"]',
  'button[aria-label="View folder resources"]',
  'button[aria-label="View lesson resources"]',
] as const;
export const RESOURCE_LIST_MENU_SELECTORS = [
  '[data-test="menu_viewTopicResourcesButton"]',
  '[data-test="menu_viewLessonPlanButton"]',
  '[role="menuitem"]:has-text("View folder resources")',
  '[role="menuitem"]:has-text("View lesson resources")',
] as const;
export const MORE_OPTIONS_SELECTORS = [
  '[data-test="moreOptionsButton"]',
  'button[aria-label="More options"]',
] as const;
/** AlsoInThis side panel (`.also-in-this-side-panel`), router-link rows. */
export const RESOURCE_PANEL_SELECTOR = '.also-in-this-side-panel';

/** Selectors for the next resource's row inside the resource panel. */
export function nextResourceRowSelectors(next: { nodeId: string; nodeIdRaw: string; title?: string }): string[] {
  const out: string[] = [];
  for (const id of idSpellings(next.nodeId, next.nodeIdRaw)) {
    out.push(`${RESOURCE_PANEL_SELECTOR} a[href*="/topics/c/${id}"]`);
  }
  if (next.title) {
    const q = next.title.replace(/"/g, '\\"');
    out.push(`${RESOURCE_PANEL_SELECTOR} a:has-text("${q}")`);
  }
  // Panel wrapper class missing in some builds: fall back to any node link.
  for (const id of idSpellings(next.nodeId, next.nodeIdRaw)) {
    out.push(`a[href*="/topics/c/${id}"]`);
  }
  return out;
}

const firstPresent = async (app: Page, selectors: readonly string[]): Promise<string | null> => {
  for (const s of selectors) {
    if ((await app.locator(s).first().count().catch(() => 0)) > 0) return s;
  }
  return null;
};

const waitForFirstPresent = async (
  app: Page,
  selectors: readonly string[],
  ms: number,
): Promise<string | null> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const hit = await firstPresent(app, selectors);
    if (hit) return hit;
    await app.waitForTimeout(250);
  }
  return firstPresent(app, selectors);
};

const NEXT_RESOURCE_SETTLE_MS = 15_000;

/**
 * From the pinned video (kolibri_watching) to the next resource in its folder,
 * the pinned exercise (kolibri_exercise), through Kolibri's resource-list panel.
 * Needs the video node route first (open_video / keep_watching). Success only
 * when the URL is /topics/c/<exercise node id>. No deep-link fallback.
 */
export const runNextResource = async (
  app: Page,
  from: PinnedNode & { logicalId: string },
  next: PinnedNode & { logicalId: string; title?: string },
): Promise<void> => {
  const tag = 'idea#166 next_resource';
  const startUrl = app.url();
  if (!urlHasPinnedVideo(startUrl, from)) {
    throw new Error(
      `${tag}: expected to start on ${from.logicalId} (/topics/c/${rawHex(from.nodeIdRaw)}) after ` +
        `open_video/keep_watching, but URL is ${startUrl || '(empty)'}. Not re-opening the video.`,
    );
  }

  const rowSelectors = nextResourceRowSelectors(next);
  let opened = 'bar';
  const barHit = await waitForFirstPresent(app, RESOURCE_LIST_BAR_SELECTORS, NEXT_RESOURCE_SETTLE_MS);
  if (barHit) {
    await app.locator(barHit).first().click({ timeout: 8_000 });
  } else {
    opened = 'more-options menu';
    const more = await firstPresent(app, MORE_OPTIONS_SELECTORS);
    if (!more) {
      throw new Error(
        `${tag}: Kolibri resource-list control not found on ${startUrl} after ` +
          `${NEXT_RESOURCE_SETTLE_MS}ms (tried ${[...RESOURCE_LIST_BAR_SELECTORS, ...MORE_OPTIONS_SELECTORS].join(' | ')}).`,
      );
    }
    await app.locator(more).first().click({ timeout: 8_000 });
    const item = await waitForFirstPresent(app, RESOURCE_LIST_MENU_SELECTORS, 5_000);
    if (!item) {
      throw new Error(
        `${tag}: More options opened on ${startUrl} but no "View folder/lesson resources" item ` +
          `(tried ${RESOURCE_LIST_MENU_SELECTORS.join(' | ')}).`,
      );
    }
    await app.locator(item).first().click({ timeout: 8_000 });
  }

  const row = await waitForFirstPresent(app, rowSelectors, NEXT_RESOURCE_SETTLE_MS);
  if (!row) {
    throw new Error(
      `${tag}: resource panel (opened via ${opened}) has no row for ${next.logicalId} ` +
        `(/topics/c/${rawHex(next.nodeIdRaw)}${next.title ? `, "${next.title}"` : ''}) after ` +
        `${NEXT_RESOURCE_SETTLE_MS}ms on ${app.url()}.`,
    );
  }
  await app.locator(row).first().click({ timeout: 8_000 });

  const deadline = Date.now() + NEXT_RESOURCE_SETTLE_MS;
  while (Date.now() < deadline) {
    if (urlHasPinnedVideo(app.url(), next)) return;
    await app.waitForTimeout(200);
  }
  if (urlHasPinnedVideo(app.url(), next)) return;
  throw new Error(
    `${tag}: clicked ${next.logicalId} row (${row}) but URL did not reach ` +
      `/topics/c/${rawHex(next.nodeIdRaw)} within ${NEXT_RESOURCE_SETTLE_MS}ms (final ${app.url() || '(empty)'}).`,
  );
};

/** next_resource: pinned video → pinned exercise (next sibling in "Grade 5A Duration"). */
export const next_resource: IntentFn = async ({ page, instanceId }) => {
  const id = instanceId ?? DURATION_FIXTURES.kolibri.instanceId;
  const app = await ensureKolibriAppPage(page, id);
  await runNextResource(app, DURATION_FIXTURES.kolibri.video, DURATION_FIXTURES.kolibri.exercise);
};

/** Open pinned Grade 5A video (Kid CONTENT.seeded + live @2313112 → open_video). */
export const open_video: IntentFn = async ({ page, instanceId }) => {
  await runOpenContent(page, instanceId, DURATION_FIXTURES.kolibri.video, 'open_video');
};

/** Open pinned Grade 5A exercise (Kid CONTENT.seeded + live @2313112 → open_exercise). */
export const open_exercise: IntentFn = async ({ page, instanceId }) => {
  await runOpenContent(page, instanceId, DURATION_FIXTURES.kolibri.exercise, 'open_exercise');
};
