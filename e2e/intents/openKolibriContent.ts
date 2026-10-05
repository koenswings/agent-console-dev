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
  action: 'next_resource' | 'next_video' = 'next_resource',
): Promise<void> => {
  const tag = `idea#166 ${action}`;
  const startUrl = app.url();
  if (!urlHasPinnedVideo(startUrl, from)) {
    throw new Error(
      `${tag}: expected to start on ${from.logicalId} (/topics/c/${rawHex(from.nodeIdRaw)}) after ` +
        `the previous step, but URL is ${startUrl || '(empty)'}. Not re-opening it.`,
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

/**
 * next_video: pinned exercise → the folder's video (kolibri_exercise →
 * kolibri_watching). Same Kolibri resource-list panel as next_resource, reversed:
 * must start on /topics/c/<exercise node>; success only on /topics/c/<video node>.
 * Kid pack has one video, so "next video" re-opens video-grade5a-01 (walker-ref).
 */
export const next_video: IntentFn = async ({ page, instanceId }) => {
  const id = instanceId ?? DURATION_FIXTURES.kolibri.instanceId;
  const app = await ensureKolibriAppPage(page, id);
  await runNextResource(app, DURATION_FIXTURES.kolibri.exercise, DURATION_FIXTURES.kolibri.video, 'next_video');
};

/**
 * True on Kolibri Learn home: hash route `/home` (query allowed). Topic
 * folders, content pages and other routes fail.
 */
export function isLearnHomeUrl(url: string): boolean {
  if (!url) return false;
  const hashAt = url.indexOf('#');
  if (hashAt < 0) return false;
  const route = url.slice(hashAt + 1).split('?')[0];
  return /^\/home\/?$/.test(route);
}

/**
 * Kolibri 0.15.5 exercise UI (upstream markup, not Kid testids).
 * AssessmentWrapper: KButton "Check" → "Next" once the item is answered correctly.
 * OverallStatus: `.overall-status-text .completed` ("Completed") when mastered.
 * CompletionModal (first completion only): role=dialog "Resource completed",
 * close KIconButton aria "Close", section button "Stay here".
 * LearningActivityBar back: aria "Go back". LearnTopNav: "Home" link.
 */
export const EXERCISE_SELECTORS = {
  check: ['button:text-is("Check")', 'button:has-text("Check")'],
  next: ['button:text-is("Next")'],
  completed: [
    '[role="dialog"]:has-text("Resource completed")',
    '.overall-status-text .completed',
  ],
  modalClose: [
    '[role="dialog"] button[aria-label="Close"]',
    '[role="dialog"] button:has-text("Stay here")',
  ],
  back: ['button[aria-label="Go back"]'],
  /** LearnTopNav NavbarLink (non-immersive pages only, e.g. #/library). */
  homeLink: ['a[href$="#/home"]', 'a[href*="#/home"]', 'a:text-is("Home")'],
  /**
   * CoreBase ImmersiveToolbar on topic / search pages (no top nav there):
   * router-link wrapping KIconButton aria "Close" (or "Go back"), to Library or
   * Home (when query last=HOME).
   */
  // aria-current="page" = the link targets the route we are already on (stale
  // toolbar left over during a route change, r8). Never click those.
  toolbarExit: [
    'a:not([aria-current="page"]):has(> button[aria-label="Close"])',
    'a:not([aria-current="page"]):has(button[aria-label="Close"])',
    'a:not([aria-current="page"]):has(button[aria-label="Go back"])',
    'span > button[aria-label="Close"]',
    'span > button[aria-label="Go back"]',
  ],
} as const;

/**
 * Kolibri 0.15.5 Learn `router.afterEach` → `blockDoubleClicks`: CoreBase /
 * LearnImmersiveLayout render `div.click-mask` over the page for 500ms after
 * every route change. Clicks during that window are intercepted (r8).
 */
export const CLICK_MASK_SELECTOR = '.click-mask';
const CLICK_MASK_MIN_SETTLE_MS = 600;
const CLICK_MASK_CLEAR_MS = 300;
const CLICK_MASK_BUDGET_MS = 5_000;

/**
 * Wait until the post-navigation click-mask is gone: at least 600ms since the
 * call and no `.click-mask` for 300ms straight. False if it never clears.
 */
export async function waitForClickMaskGone(app: Page, budgetMs = CLICK_MASK_BUDGET_MS): Promise<boolean> {
  const start = Date.now();
  let clearSince: number | null = null;
  while (Date.now() - start < budgetMs) {
    const masked = (await app.locator(CLICK_MASK_SELECTOR).count().catch(() => 0)) > 0;
    const now = Date.now();
    if (masked) clearSince = null;
    else if (clearSince === null) clearSince = now;
    if (clearSince !== null && now - start >= CLICK_MASK_MIN_SETTLE_MS && now - clearSince >= CLICK_MASK_CLEAR_MS) {
      return true;
    }
    await app.waitForTimeout(100);
  }
  return false;
}

/** Learn hash route without query (e.g. `/topics/t/<id>/search`), or ''. */
export function learnHashRoute(url: string): string {
  const hashAt = url ? url.indexOf('#') : -1;
  return hashAt < 0 ? '' : url.slice(hashAt + 1).split('?')[0];
}

/**
 * Which Learn chrome to click next to head for #/home, in order.
 * Content page (immersive, no top nav): bar "Go back".
 * Other pages: top-nav Home if shown, else the immersive toolbar Close/Go back
 * (topic & search pages → Library or Home).
 */
export function learnHomeHopSelectors(url: string): string[] {
  const S = EXERCISE_SELECTORS;
  if (kolibriContentRouteNodeId(url)) return [...S.homeLink, ...S.back];
  return [...S.homeLink, ...S.toolbarExit];
}

const LEARN_HOME_MAX_HOPS = 5;

/** Perseus radio choice selectors: exact answer text first, then fixture index. */
export function exerciseChoiceSelectors(answer: { correctChoiceText: string; correctChoiceIndex: number }): string[] {
  const q = answer.correctChoiceText.replace(/"/g, '\\"');
  return [
    `.perseus-widget-radio li:has-text("${q}")`,
    `#perseus li:has-text("${q}")`,
    `.perseus-widget-radio input[type="radio"] >> nth=${answer.correctChoiceIndex}`,
    `#perseus input[type="radio"] >> nth=${answer.correctChoiceIndex}`,
  ];
}

const FINISH_SETTLE_MS = 20_000;
const FINISH_MAX_ITEMS = 4;

/**
 * From the pinned exercise (kolibri_exercise) to Learn home (kolibri_home).
 * 1. Must start on /topics/c/<exercise node> (loud-fail otherwise; no re-open).
 * 2. Pick the fixture's correct choice, click Check, wait for Next (correct).
 *    Repeat on the next item until completion shows (modal or "Completed").
 * 3. Close the modal if shown, then walk Learn chrome home: content "Go back"
 *    → topic/search toolbar "Close" → Library top-nav "Home" (no hash goto).
 * Success only when completion was seen AND the URL is Learn #/home.
 */
export const runFinishExercise = async (
  app: Page,
  exercise: PinnedNode & {
    logicalId: string;
    correctChoiceText: string;
    correctChoiceIndex: number;
  },
): Promise<void> => {
  const tag = 'idea#166 finish_exercise';
  const S = EXERCISE_SELECTORS;
  const startUrl = app.url();
  if (!urlHasPinnedVideo(startUrl, exercise)) {
    throw new Error(
      `${tag}: expected to start on ${exercise.logicalId} (/topics/c/${rawHex(exercise.nodeIdRaw)}) ` +
        `after next_resource, but URL is ${startUrl || '(empty)'}. Not re-opening the exercise.`,
    );
  }

  const choices = exerciseChoiceSelectors(exercise);
  // Always answer at least one item, even if a prior run already mastered it.
  let completed = false;
  let attempts = 0;
  const trail: string[] = [];

  while (!completed && attempts < FINISH_MAX_ITEMS) {
    attempts += 1;
    const ready = await waitForFirstPresent(app, [...S.check, ...S.next], FINISH_SETTLE_MS);
    if (!ready) {
      throw new Error(
        `${tag}: exercise controls (Check/Next) did not render on ${app.url()} within ` +
          `${FINISH_SETTLE_MS}ms (item ${attempts}). Perseus may not have loaded.`,
      );
    }
    if ((S.next as readonly string[]).includes(ready)) {
      // Item already answered: move to a fresh one.
      await app.locator(ready).first().click({ timeout: 8_000 });
      trail.push(`item${attempts}:next(pre-answered)`);
      continue;
    }
    const choice = await waitForFirstPresent(app, choices, FINISH_SETTLE_MS);
    if (!choice) {
      throw new Error(
        `${tag}: no Perseus choice "${exercise.correctChoiceText}" on ${app.url()} (item ${attempts}; ` +
          `tried ${choices.join(' | ')}).`,
      );
    }
    await app.locator(choice).first().click({ timeout: 8_000, force: true });
    await app.locator(ready).first().click({ timeout: 8_000 });
    const correct = await waitForFirstPresent(app, [...S.next, ...S.completed], 10_000);
    if (!correct) {
      throw new Error(
        `${tag}: Check on "${exercise.correctChoiceText}" (${choice}) did not mark item ${attempts} ` +
          `correct (no Next / completion) on ${app.url()}.`,
      );
    }
    trail.push(`item${attempts}:correct`);
    completed = (await waitForFirstPresent(app, S.completed, 5_000)) !== null;
    if (!completed) {
      const nxt = await firstPresent(app, S.next);
      if (nxt) await app.locator(nxt).first().click({ timeout: 8_000 });
    }
  }

  if (!completed) {
    throw new Error(
      `${tag}: ${exercise.logicalId} answered ${attempts} item(s) (${trail.join(', ')}) but no completion ` +
        `("Resource completed" modal or "Completed" status) on ${app.url()}.`,
    );
  }

  const close = await firstPresent(app, S.modalClose);
  if (close) await app.locator(close).first().click({ timeout: 8_000 });

  // Walk Learn chrome to #/home: content "Go back" → topic/search toolbar
  // Close → Library top-nav "Home". Each hop must change the URL. Before every
  // pick, wait out Kolibri's 500ms post-navigation click-mask and re-resolve
  // controls on the page actually shown (no force / JS clicks).
  const hops: string[] = [];
  const maskStuck = (where: string) =>
    new Error(
      `${tag}: Kolibri click-mask (${CLICK_MASK_SELECTOR}) still covering ${where} after ` +
        `${CLICK_MASK_BUDGET_MS}ms (hops: ${hops.join(' → ') || 'none'}).`,
    );
  for (let hop = 1; hop <= LEARN_HOME_MAX_HOPS && !isLearnHomeUrl(app.url()); hop++) {
    const before = app.url();
    let clicked: string | null = null;
    let lastErr = '';
    for (let attempt = 1; attempt <= 3 && !clicked; attempt++) {
      if (!(await waitForClickMaskGone(app))) throw maskStuck(before);
      if (app.url() !== before) break; // route moved under us; re-plan next hop
      const hit = await waitForFirstPresent(app, learnHomeHopSelectors(before), 10_000);
      if (!hit) {
        throw new Error(
          `${tag}: exercise completed (${trail.join(', ')}) but no Learn nav control on ` +
            `${before || '(empty)'} to head home (hops: ${hops.join(' → ') || 'none'}; tried ` +
            `${learnHomeHopSelectors(before).join(' | ')}).`,
        );
      }
      try {
        await app.locator(hit).first().click({ timeout: 3_000 });
        clicked = hit;
      } catch (e) {
        lastErr = `${hit}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`;
      }
    }
    if (!clicked && app.url() === before) {
      throw new Error(
        `${tag}: Learn nav click on ${before} failed 3 times (last ${lastErr}; hops: ` +
          `${hops.join(' → ') || 'none'}).`,
      );
    }
    hops.push(`${learnHashRoute(before) || before} [${clicked ?? 'route moved'}]`);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && app.url() === before) {
      await app.waitForTimeout(200);
    }
    if (app.url() === before) {
      throw new Error(
        `${tag}: clicked ${clicked} on ${before} but the URL did not change (hops: ${hops.join(' → ')}).`,
      );
    }
  }
  if (!isLearnHomeUrl(app.url())) {
    throw new Error(
      `${tag}: exercise completed (${trail.join(', ')}) but Learn nav did not reach #/home after ` +
        `${LEARN_HOME_MAX_HOPS} hops (hops: ${hops.join(' → ')}; final ${app.url() || '(empty)'}).`,
    );
  }
};

/** finish_exercise: pinned exercise → completed → Learn home. */
export const finish_exercise: IntentFn = async ({ page, instanceId }) => {
  const id = instanceId ?? DURATION_FIXTURES.kolibri.instanceId;
  const app = await ensureKolibriAppPage(page, id);
  await runFinishExercise(app, DURATION_FIXTURES.kolibri.exercise);
};

/** Open pinned Grade 5A video (Kid CONTENT.seeded + live @2313112 → open_video). */
export const open_video: IntentFn = async ({ page, instanceId }) => {
  await runOpenContent(page, instanceId, DURATION_FIXTURES.kolibri.video, 'open_video');
};

/** Open pinned Grade 5A exercise (Kid CONTENT.seeded + live @2313112 → open_exercise). */
export const open_exercise: IntentFn = async ({ page, instanceId }) => {
  await runOpenContent(page, instanceId, DURATION_FIXTURES.kolibri.exercise, 'open_exercise');
};
