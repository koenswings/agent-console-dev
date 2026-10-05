/**
 * Wikipedia (Kiwix) Intents: idea#166 Prefer A, Kid App#11 @a443398 stub ZIM.
 *
 * kiwix-serve 3.8.2 markup (verified on the box against Kid's ZIM with the
 * official kiwix-tools 3.8.2 binary):
 *   - library  /            a.book__link[href="/viewer#<book>"]
 *   - viewer   /viewer#<book>/<path>, article in iframe#content_iframe, h1#firstHeading
 *   - search   #kiwixsearchbox + Enter → iframe /search?books.name=<book>&pattern=<q>
 *              ("Results 1-4 of 4"), result links a[href$="/<path>"]; clicking a
 *              result or an article link moves the viewer hash to #<book>/<path>.
 *
 * Kiwix has no login, so teacher vs learner only differs by the Console role the
 * walker is in. Path A = Console open-instance-kiwix-ideaa-001; Path B = Kid
 * CONTENT.live.json urls.viewerHome with `<host>` = Console host (sidecar port
 * 18380, DURATION_KIWIX_URL / DURATION_KIWIX_PORT override).
 */
import type { FrameLocator, Page } from '@playwright/test';
import type { IntentFn } from './types';
import { sel } from './selectors';
import { DURATION_FIXTURES } from './fixtures';
import { resolveSidecarUrl, sidecarReadyTimeoutMs, isSidecarHttpReadyStatus } from './sidecarUrls';
import { leaveAppToConsole } from './operatorDeepActions';

const KW = DURATION_FIXTURES.kiwix;
const SETTLE_MS = 20_000;

export const KIWIX_SELECTORS = {
  bookLink: `a.book__link[href*="/viewer#${KW.bookName}"]`,
  iframe: 'iframe#content_iframe',
  heading: 'h1#firstHeading',
  searchBox: '#kiwixsearchbox',
} as const;

/** Kiwix base URL (scheme://host:port) for the Console page host. */
export const kiwixBaseUrl = (consoleUrl: string, env: NodeJS.ProcessEnv = process.env): string =>
  resolveSidecarUrl('kiwix', consoleUrl, env);

/** Kid urls.viewerHome with `<host>:<port>` swapped for the resolved Kiwix base. */
export const kiwixViewerHomeUrl = (base: string): string =>
  `${base.replace(/\/$/, '')}${KW.urls.viewerHome.replace(/^https?:\/\/<host>:\d+/, '')}`;

/** Article path from a viewer URL (#<book>/<path>), or null. */
export function kiwixViewerPath(url: string, book: string = KW.bookName): string | null {
  try {
    const u = new URL(url);
    if (!/\/viewer$/.test(u.pathname)) return null;
    const h = decodeURIComponent(u.hash.replace(/^#/, ''));
    return h.startsWith(`${book}/`) ? h.slice(book.length + 1) : null;
  } catch {
    return null;
  }
}

/** True for a Kiwix tab on this base (library or viewer). */
export function isKiwixTabUrl(url: string, base: string): boolean {
  try {
    return new URL(url).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

const waitFor = async (pred: () => Promise<boolean> | boolean, p: Page, ms: number): Promise<boolean> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await pred()) return true;
    await p.waitForTimeout(250);
  }
  return !!(await pred());
};

const article = (p: Page): FrameLocator => p.frameLocator(KIWIX_SELECTORS.iframe);

const headingText = async (p: Page): Promise<string> =>
  ((await article(p).locator(KIWIX_SELECTORS.heading).first().innerText({ timeout: 2_000 }).catch(() => '')) ?? '').trim();

/** Wait until the viewer shows <path> with heading <title>; loud-fail otherwise. */
export const kiwixExpectArticle = async (p: Page, tag: string, path: string, title: string): Promise<void> => {
  const ok = await waitFor(async () => kiwixViewerPath(p.url()) === path && (await headingText(p)) === title, p, SETTLE_MS);
  if (!ok) {
    throw new Error(
      `${tag}: Kiwix viewer not on "${title}" (${path}); url=${p.url()} heading="${await headingText(p)}".`,
    );
  }
};

/** Newest Kiwix tab for this Console host, or loud-fail (not wiki_browse). */
export const kiwixPage = (page: Page, tag: string): Page => {
  const base = kiwixBaseUrl(page.url());
  const pages = page.context().pages();
  for (let i = pages.length - 1; i >= 0; i--) {
    try {
      if (pages[i] !== page && isKiwixTabUrl(pages[i]!.url(), base)) return pages[i]!;
    } catch {
      /* closed */
    }
  }
  throw new Error(`${tag}: not in wiki_browse: no Kiwix tab on ${base} open. Run open_wikipedia_as_teacher / _learner first.`);
};

const waitKiwixReady = async (page: Page, base: string, tag: string): Promise<void> => {
  const budget = sidecarReadyTimeoutMs();
  let last = 'no-attempt';
  const ok = await waitFor(
    async () => {
      try {
        const r = await page.request.get(base, { timeout: 5_000, maxRedirects: 0, failOnStatusCode: false });
        last = `HTTP ${r.status()}`;
        return isSidecarHttpReadyStatus(r.status());
      } catch (e) {
        last = e instanceof Error ? e.message : String(e);
        return false;
      }
    },
    page,
    budget,
  );
  if (!ok) {
    throw new Error(
      `${tag}: Kiwix ${base} not reachable within ${budget}ms (last=${last}). Kid apply pending: ` +
        `post-dock-restore-running.sh --mode sidecar --apps kiwix (idea01), or set DURATION_KIWIX_URL / DURATION_KIWIX_PORT.`,
    );
  }
};

/**
 * Open Kiwix from the Console: Path A (Console Open → new tab; library → book
 * tile) else Path B (Kid viewerHome). Success = viewer on Main_Page with heading
 * "Grade 5A Offline Wikipedia".
 */
export const openWikipedia = async (page: Page, role: 'teacher' | 'learner', instanceId?: string): Promise<Page> => {
  const tag = `idea#166 open_wikipedia_as_${role}`;
  const id = instanceId ?? KW.instanceId;
  const base = kiwixBaseUrl(page.url());
  let kiwix: Page | null = null;

  const open = page.locator(sel.openInstance(id)).first();
  const openable =
    (await open.isVisible().catch(() => false)) &&
    !(await open.isDisabled().catch(() => false)) &&
    (await open.getAttribute('aria-disabled').catch(() => null)) !== 'true';
  if (openable) {
    const popup = page.context().waitForEvent('page', { timeout: 8_000 }).catch(() => null);
    await open.click({ timeout: 8_000 });
    kiwix = await popup;
    if (!kiwix) throw new Error(`${tag}: Console Open for ${id} did not open a new tab.`);
    await kiwix.waitForLoadState('domcontentloaded').catch(() => {});
    if (kiwixViewerPath(kiwix.url()) === null) {
      const book = kiwix.locator(KIWIX_SELECTORS.bookLink).first();
      if (!(await waitFor(async () => book.isVisible().catch(() => false), kiwix, SETTLE_MS))) {
        throw new Error(`${tag}: Open for ${id} landed on ${kiwix.url()}: neither the Kiwix viewer nor a library tile for ${KW.bookName}.`);
      }
      await book.click({ timeout: 8_000 });
    }
  } else {
    await waitKiwixReady(page, base, tag);
    kiwix = await page.context().newPage();
    const url = kiwixViewerHomeUrl(base);
    const resp = await kiwix.goto(url, { waitUntil: 'domcontentloaded', timeout: SETTLE_MS });
    if (resp && resp.status() >= 400) throw new Error(`${tag}: ${url} returned HTTP ${resp.status()}.`);
  }
  await kiwixExpectArticle(kiwix, tag, 'Main_Page', KW.homeTitle);
  return kiwix;
};

export const open_wikipedia_as_teacher: IntentFn = async ({ page, instanceId }) => {
  await openWikipedia(page, 'teacher', instanceId);
};
export const open_wikipedia_as_learner: IntentFn = async ({ page, instanceId }) => {
  await openWikipedia(page, 'learner', instanceId);
};

/**
 * search_browse_wikipedia (wiki_browse dwell): type "fraction" in the viewer
 * search box + Enter → results page (Results 1-4 of 4) → click Fraction →
 * follow the Numerator link. Every hop proven by heading + viewer hash.
 */
export const runSearchBrowseWikipedia = async (kiwix: Page): Promise<string[]> => {
  const tag = 'idea#166 search_browse_wikipedia';
  const s = KW.search;
  if (kiwixViewerPath(kiwix.url()) === null) {
    throw new Error(`${tag}: Kiwix tab is not in the viewer (${kiwix.url()}).`);
  }
  const box = kiwix.locator(KIWIX_SELECTORS.searchBox).first();
  if (!(await waitFor(async () => box.isVisible().catch(() => false), kiwix, SETTLE_MS))) {
    throw new Error(`${tag}: viewer search box ${KIWIX_SELECTORS.searchBox} missing (${kiwix.url()}).`);
  }
  await box.click({ timeout: 8_000 });
  await box.fill('');
  await box.pressSequentially(s.term, { delay: 40 });
  await box.press('Enter');

  const frame = article(kiwix);
  const results = await waitFor(
    async () => ((await frame.locator('body').first().innerText({ timeout: 2_000 }).catch(() => '')) ?? '').replace(/\s+/g, ' ').includes(s.expectResults),
    kiwix,
    SETTLE_MS,
  );
  if (!results) {
    const body = ((await frame.locator('body').first().innerText({ timeout: 2_000 }).catch(() => '')) ?? '').replace(/\s+/g, ' ').slice(0, 160);
    throw new Error(`${tag}: search "${s.term}" did not show "${s.expectResults}" (iframe: "${body}").`);
  }
  const hit = frame.locator(`a[href$="/${s.resultPath}"]`).first();
  if ((await hit.count().catch(() => 0)) === 0) {
    throw new Error(`${tag}: search results have no link to ${s.resultPath}.`);
  }
  await hit.click({ timeout: 8_000 });
  await kiwixExpectArticle(kiwix, tag, s.resultPath, s.expectTitle);

  const link = frame.locator(`a[href$="/${s.followLink}"]`).first();
  if ((await link.count().catch(() => 0)) === 0) {
    throw new Error(`${tag}: article ${s.resultPath} has no link to ${s.followLink}.`);
  }
  await link.click({ timeout: 8_000 });
  await kiwixExpectArticle(kiwix, tag, s.followLink, s.followLink);
  return [s.resultPath, s.followLink];
};

export const search_browse_wikipedia: IntentFn = async ({ page }) => {
  await runSearchBrowseWikipedia(kiwixPage(page, 'idea#166 search_browse_wikipedia'));
};

const leaveWikipedia = async (page: Page, role: 'teacher' | 'learner'): Promise<void> => {
  const tag = `idea#166 leave_wikipedia_as_${role}`;
  const kiwix = kiwixPage(page, tag);
  await leaveAppToConsole(page);
  if (!kiwix.isClosed()) throw new Error(`${tag}: Kiwix tab still open after leaving to the Console (${kiwix.url()}).`);
};

export const leave_wikipedia_as_teacher: IntentFn = async ({ page }) => leaveWikipedia(page, 'teacher');
export const leave_wikipedia_as_learner: IntentFn = async ({ page }) => leaveWikipedia(page, 'learner');
