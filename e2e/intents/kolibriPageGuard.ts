/**
 * Kolibri page guard (idea#168 r31): never let a Kolibri server error pass as a
 * UI/fixture state.
 *
 * cover-all-d398c40-r31: every Kolibri HTML page on idea01:18080 returned
 * HTTP 500 ("Server Error (500)"). open_kolibri_as_teacher (@2) still passed
 * (no login form → 'no_form' was swallowed) and create_class (@3) failed with a
 * misleading "Grade 5A not listed and NEW CLASS button missing".
 *
 * - trackMainDocuments(page): records the last MAIN-FRAME document response per
 *   Page (context-level listener, so an App popup's first document is seen too).
 * - assertKolibriPageOk(page, ctx, response?): throws with URL + HTTP status when
 *   the current main document is 5xx (goto response → listener → Django
 *   "Server Error (5xx)" body as last resort).
 * - waitKolibriTeacherLanding(page, ctx): polls until the Kolibri login form OR
 *   a signed-in coach/facility view renders; throws on 5xx or when neither
 *   renders within the budget.
 */
import type { Page, Response } from '@playwright/test';

export interface MainDocStatus {
  url: string;
  status: number;
  at: number;
}

export type StatusSource = 'goto' | 'listener' | 'body' | 'none';

const lastDoc = new WeakMap<Page, MainDocStatus>();
const trackedContexts = new WeakSet<object>();
const trackedPages = new WeakSet<object>();

const stripHash = (u: string): string => (u ?? '').split('#')[0] ?? '';

/** Listener body: keep only main-frame document responses (redirect hops included; last wins). */
export const recordMainDocumentResponse = (resp: Response): void => {
  try {
    if (resp.request().resourceType() !== 'document') return;
    const frame = resp.frame();
    const page = frame.page();
    if (frame !== page.mainFrame()) return;
    lastDoc.set(page, { url: resp.url(), status: resp.status(), at: Date.now() });
  } catch {
    /* service-worker / detached frame responses have no page */
  }
};

/** Start recording main-document statuses for every page of `page`'s context (idempotent). */
export const trackMainDocuments = (page: Page): void => {
  try {
    const ctx = page.context();
    if (!trackedContexts.has(ctx)) {
      trackedContexts.add(ctx);
      ctx.on('response', recordMainDocumentResponse);
    }
    return;
  } catch {
    /* fall back to a page-level listener */
  }
  try {
    if (!trackedPages.has(page)) {
      trackedPages.add(page);
      page.on('response', recordMainDocumentResponse);
    }
  } catch {
    /* best-effort */
  }
};

/** Last recorded main-document response for `page` (test/diagnostic helper). */
export const lastMainDocument = (page: Page): MainDocStatus | undefined => lastDoc.get(page);

export const isServerErrorStatus = (status: number | null | undefined): status is number =>
  typeof status === 'number' && status >= 500 && status <= 599;

/** Django's default error page ("Server Error (500)") — Kolibri serves it on 5xx. */
export const serverErrorFromBody = (text: string): number | null => {
  const m = /^\s*Server Error \((5\d\d)\)/i.exec(text ?? '');
  return m ? Number(m[1]) : null;
};

const bodyText = async (page: Page): Promise<string> =>
  page.locator('body').innerText({ timeout: 2_000 }).catch(() => '');

/**
 * Status of the document currently shown in `page`: goto response if given,
 * else the listener record for the same URL (hash ignored), else a Django
 * 5xx body. `status: null` when unknown.
 */
export const mainDocumentStatus = async (
  page: Page,
  response?: Response | null,
): Promise<{ status: number | null; url: string; source: StatusSource }> => {
  if (response) {
    try {
      return { status: response.status(), url: response.url(), source: 'goto' };
    } catch {
      /* fall through */
    }
  }
  let current = '';
  try {
    current = page.url();
  } catch {
    /* closed */
  }
  const tracked = lastDoc.get(page);
  if (tracked && stripHash(tracked.url) === stripHash(current)) {
    return { status: tracked.status, url: tracked.url, source: 'listener' };
  }
  const fromBody = serverErrorFromBody(await bodyText(page));
  if (fromBody) return { status: fromBody, url: current, source: 'body' };
  return { status: null, url: current, source: 'none' };
};

export const kolibriServerErrorMessage = (
  context: string,
  s: { status: number | null; url: string; source: StatusSource },
): string =>
  `idea#168 ${context}: Kolibri returned HTTP ${s.status} for ${s.url} ` +
  `(main document, via ${s.source}) — Kolibri server error, not a UI/fixture gap`;

/** Throw (URL + HTTP status) when the current Kolibri main document is 5xx. */
export const assertKolibriPageOk = async (
  page: Page,
  context: string,
  response?: Response | null,
): Promise<void> => {
  const s = await mainDocumentStatus(page, response);
  if (isServerErrorStatus(s.status)) throw new Error(kolibriServerErrorMessage(context, s));
};

export type KolibriLanding = 'server_error' | 'login_form' | 'signed_in' | 'loading';

const AUTH_MESSAGE_RE =
  /must be signed in|sign in to (view|access|continue)|please sign in|you are not signed in|not authori[sz]ed|do not have permission|don't have permission/i;
const SIGNED_IN_VIEW_RE =
  /\b(classes|class name|grade 5a|learners|coaches|lessons|quizzes|reports|users|facility|plan|coach)\b/i;

/**
 * Pure classifier for one poll of a Kolibri tab after the teacher login step.
 * login_form = username/password field rendered; signed_in = on /coach/ or
 * /facility/ with real view text and no auth prompt.
 */
export function classifyKolibriLanding(s: {
  status: number | null;
  url: string;
  bodyText: string;
  hasLoginField: boolean;
}): KolibriLanding {
  if (isServerErrorStatus(s.status) || serverErrorFromBody(s.bodyText)) return 'server_error';
  if (s.hasLoginField) return 'login_form';
  const onView = /\/(coach|facility)\//i.test(s.url) && !/\/auth\/|#\/signin/i.test(s.url);
  const text = s.bodyText ?? '';
  if (onView && text.trim() && !AUTH_MESSAGE_RE.test(text) && SIGNED_IN_VIEW_RE.test(text)) {
    return 'signed_in';
  }
  return 'loading';
}

/** Budget for the @2 landing wait (same order as the coach goto timeout). */
export const kolibriLandingMs = (): number => {
  const raw = Number(process.env.DURATION_KOLIBRI_LANDING_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 15_000;
};

const LOGIN_FIELD_SEL =
  'input[autocomplete="username"], input[name="username"], input#id_username, input[type="password"]';

const hasLoginField = async (page: Page, url: string): Promise<boolean> => {
  const specific = await page.locator(LOGIN_FIELD_SEL).count().catch(() => 0);
  if (specific > 0) return true;
  if (/\/auth\/|#\/signin/i.test(url)) {
    return (await page.locator('input[type="text"]').count().catch(() => 0)) > 0;
  }
  return false;
};

/**
 * Wait until the Kolibri login form or a signed-in coach/facility view renders.
 * Throws with URL + status on 5xx; throws when neither renders in `budgetMs`.
 */
export const waitKolibriTeacherLanding = async (
  page: Page,
  context: string,
  opts: { budgetMs?: number; pollMs?: number; response?: Response | null } = {},
): Promise<'login_form' | 'signed_in'> => {
  const budget = opts.budgetMs ?? kolibriLandingMs();
  const poll = opts.pollMs ?? 500;
  const deadline = Date.now() + budget;
  let last = { status: null as number | null, url: '', source: 'none' as StatusSource };
  let lastText = '';
  let response = opts.response ?? null;
  for (;;) {
    last = await mainDocumentStatus(page, response);
    response = null; // a goto response only describes the first poll
    lastText = await bodyText(page);
    const state = classifyKolibriLanding({
      status: last.status,
      url: last.url || page.url(),
      bodyText: lastText,
      hasLoginField: await hasLoginField(page, page.url()),
    });
    if (state === 'server_error') {
      const status = last.status ?? serverErrorFromBody(lastText);
      throw new Error(kolibriServerErrorMessage(context, { ...last, status, url: last.url || page.url() }));
    }
    if (state === 'login_form' || state === 'signed_in') return state;
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(poll);
  }
  const snippet = lastText.replace(/\s+/g, ' ').trim().slice(0, 200) || '(empty body)';
  throw new Error(
    `idea#168 ${context}: neither the Kolibri login form nor a signed-in coach/facility view ` +
      `rendered within ${budget}ms at ${page.url()} (HTTP ${last.status ?? 'unknown'}, via ${last.source}); ` +
      `body: ${snippet}`,
  );
};
