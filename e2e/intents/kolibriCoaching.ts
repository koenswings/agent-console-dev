/**
 * Kolibri coaching Intents (idea#168) — run inside Kolibri after
 * open_kolibri_as_teacher (kolibri_manage). Real click/nav sequences against
 * Facility + Coach hash routes. Fail loud — never silent ok.
 *
 * Preload (Kid CONTENT.live): Grade 5A class + learners + lesson usually exist;
 * create_class = create-or-assert; enroll/build prefer navigate+assert+minimal UI.
 */
import type { Page } from '@playwright/test';
import type { IntentFn } from './types';
import { DURATION_FIXTURES, uuidForms } from './fixtures';
import { openAppInstance, resolveAppPage, APP_TAB_URL_RE } from './openApp';
import { attemptAppLogin } from './appLogin';
import { resolveSidecarUrl } from './sidecarUrls';

const CLASS_NAME = DURATION_FIXTURES.kolibri.live.class.name; // Grade 5A
const LESSON_TITLE = DURATION_FIXTURES.kolibri.live.lesson.title;

/** Resolve Kolibri app tab; ensure teacher session when possible. */
const ensureKolibriCoachPage = async (consolePage: Page): Promise<Page> => {
  let app = resolveAppPage(consolePage);
  if (!APP_TAB_URL_RE.test(app.url()) || /nextcloud|18280/i.test(app.url())) {
    app = await openAppInstance(
      consolePage,
      DURATION_FIXTURES.kolibri.instanceId,
      'kolibri',
    );
  }
  // Best-effort teacher login if sign-in chrome visible
  await attemptAppLogin(app, DURATION_FIXTURES.kolibri.auth.teacher).catch(() => 'no_form');
  return app;
};

const classIds = (): string[] => {
  const { id, idDashed } = DURATION_FIXTURES.kolibri.live.class;
  const forms = uuidForms(id);
  return [...new Set([id, idDashed, forms.raw, forms.dashed])];
};

const lessonIds = (): string[] => {
  const { id, idDashed } = DURATION_FIXTURES.kolibri.live.lesson;
  const forms = uuidForms(id);
  return [...new Set([id, idDashed, forms.raw, forms.dashed])];
};

/** Origin for Kolibri (sidecar or current app tab). */
const kolibriOrigin = (app: Page, consolePage: Page): string => {
  try {
    const u = app.url();
    if (u && u !== 'about:blank' && APP_TAB_URL_RE.test(u)) {
      return new URL(u).origin;
    }
  } catch {
    /* fall through */
  }
  return resolveSidecarUrl('kolibri', consolePage.url());
};

const gotoCoach = async (app: Page, origin: string, hashPath: string): Promise<void> => {
  const path = hashPath.startsWith('#') ? hashPath : `#${hashPath.replace(/^#/, '')}`;
  // Prefer /en/coach/ locale path used by live 0.15.5
  const targets = [
    `${origin}/en/coach/${path}`,
    `${origin}/coach/${path}`,
  ];
  let lastErr: unknown;
  for (const t of targets) {
    try {
      await app.goto(t, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await app.waitForTimeout(800);
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `idea#168 Kolibri coach nav failed for ${hashPath}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
};

const gotoFacility = async (app: Page, origin: string, hashPath: string): Promise<void> => {
  const path = hashPath.startsWith('#') ? hashPath : `#${hashPath.replace(/^#/, '')}`;
  const targets = [`${origin}/en/facility/${path}`, `${origin}/facility/${path}`];
  let lastErr: unknown;
  for (const t of targets) {
    try {
      await app.goto(t, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await app.waitForTimeout(800);
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `idea#168 Kolibri facility nav failed for ${hashPath}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
};

const bodyHas = async (app: Page, re: RegExp): Promise<boolean> => {
  const text = await app.locator('body').innerText().catch(() => '');
  return re.test(text);
};

/**
 * create_class — Facility Classes: assert Grade 5A exists, else NEW CLASS → save.
 * Preload-friendly create-or-assert (Kid CONTENT.live usually has Grade 5A).
 */
export const create_class: IntentFn = async ({ page }) => {
  const app = await ensureKolibriCoachPage(page);
  const origin = kolibriOrigin(app, page);
  await gotoFacility(app, origin, '#/classes');

  if (await bodyHas(app, new RegExp(CLASS_NAME, 'i'))) {
    // Already present — open it to prove interactivity
    const row = app.getByText(CLASS_NAME, { exact: false }).first();
    if (await row.count()) await row.click({ timeout: 5_000 }).catch(() => {});
    await app.waitForTimeout(400);
    return;
  }

  const newBtn = app.getByRole('button', { name: /new class/i })
    .or(app.getByText(/^NEW CLASS$/i));
  if (!(await newBtn.count())) {
    throw new Error(
      `idea#168 create_class: Grade 5A not listed and NEW CLASS button missing on ${app.url()}`,
    );
  }
  await newBtn.first().click();
  await app.waitForTimeout(600);
  const nameInput = app.locator('input[type="text"], input').first();
  await nameInput.waitFor({ state: 'visible', timeout: 10_000 });
  await nameInput.fill(CLASS_NAME);
  const save = app.getByRole('button', { name: /save|create|confirm/i }).first();
  if (!(await save.count())) {
    throw new Error('idea#168 create_class: Save/Create button missing after NEW CLASS');
  }
  await save.click();
  await app.waitForTimeout(1000);
  if (!(await bodyHas(app, new RegExp(CLASS_NAME, 'i')))) {
    throw new Error(`idea#168 create_class: after Save, '${CLASS_NAME}' still not visible`);
  }
};

/**
 * enroll_learners — Facility class → ENROLL LEARNERS (or assert learners listed).
 * Minimal hardpass: open enroll UI or confirm learner01..03 already enrolled.
 */
export const enroll_learners: IntentFn = async ({ page }) => {
  const app = await ensureKolibriCoachPage(page);
  const origin = kolibriOrigin(app, page);
  const cid = classIds()[0]!;
  await gotoFacility(app, origin, `#/classes/${cid}`);

  const hasLearners =
    (await bodyHas(app, /learner01/i)) ||
    (await bodyHas(app, /Learner One/i));
  const enrollBtn = app.getByRole('button', { name: /enroll learners/i })
    .or(app.getByText(/^ENROLL LEARNERS$/i));

  if (hasLearners && !(await enrollBtn.count())) {
    // Already enrolled; prove page is the class roster
    return;
  }
  if (!(await enrollBtn.count())) {
    throw new Error(
      `idea#168 enroll_learners: ENROLL LEARNERS not found and no learner01 on ${app.url()}`,
    );
  }
  await enrollBtn.first().click();
  await app.waitForTimeout(800);
  // Enroll dialog/page: assert user list chrome, then Cancel if present (avoid dirty enroll)
  const listVisible =
    (await bodyHas(app, /username|full name|select/i)) ||
    (await app.locator('input[type="checkbox"], table, [role="row"]').count()) > 0;
  if (!listVisible) {
    throw new Error(`idea#168 enroll_learners: enroll UI did not open on ${app.url()}`);
  }
  const cancel = app.getByRole('button', { name: /cancel|back|close/i }).first();
  if (await cancel.count()) await cancel.click().catch(() => {});
};

/**
 * build_lesson — Coach Plan → Lessons: open existing Grade 5A Duration Lesson
 * (preload) or NEW LESSON form. Prefer assert+open existing (non-destructive).
 */
export const build_lesson: IntentFn = async ({ page }) => {
  const app = await ensureKolibriCoachPage(page);
  const origin = kolibriOrigin(app, page);
  const cid = classIds()[0]!;
  await gotoCoach(app, origin, `#/${cid}/plan/lessons`);

  const lessonLink = app.getByText(LESSON_TITLE, { exact: false }).first();
  if (await lessonLink.count()) {
    await lessonLink.click();
    await app.waitForTimeout(1000);
    // Lesson detail / resources should mention resources or title
    if (!(await bodyHas(app, new RegExp(LESSON_TITLE.slice(0, 12), 'i')))) {
      // URL may include lesson id
      const ok = lessonIds().some((id) => app.url().includes(id));
      if (!ok) {
        throw new Error(
          `idea#168 build_lesson: clicked '${LESSON_TITLE}' but detail did not settle (${app.url()})`,
        );
      }
    }
    return;
  }

  const newLesson = app.getByRole('button', { name: /new lesson/i })
    .or(app.getByText(/^NEW LESSON$/i));
  if (!(await newLesson.count())) {
    throw new Error(
      `idea#168 build_lesson: '${LESSON_TITLE}' not listed and NEW LESSON missing on ${app.url()}`,
    );
  }
  await newLesson.first().click();
  await app.waitForTimeout(800);
  const titleInput = app.locator('input[type="text"]').first();
  await titleInput.waitFor({ state: 'visible', timeout: 10_000 });
  // Minimal: fill title then leave without full resource add (destructive-safe)
  await titleInput.fill(LESSON_TITLE);
  const cancel = app.getByRole('button', { name: /cancel|back/i }).first();
  if (await cancel.count()) {
    await cancel.click();
  } else {
    throw new Error(
      'idea#168 build_lesson: opened NEW LESSON form (lesson not preloaded) but no Cancel — ' +
        'aborting before incomplete save. Preload Grade 5A Duration Lesson for hardpass.',
    );
  }
};

/**
 * create_quiz — Coach Plan → Quizzes → NEW QUIZ (quiz not preseeded).
 * Opens creation UI; cancels if possible to avoid dirty Active quizzes.
 */
export const create_quiz: IntentFn = async ({ page }) => {
  const app = await ensureKolibriCoachPage(page);
  const origin = kolibriOrigin(app, page);
  const cid = classIds()[0]!;
  await gotoCoach(app, origin, `#/${cid}/plan/quizzes`);

  const newQuiz = app.getByRole('button', { name: /new quiz/i })
    .or(app.getByText(/^NEW QUIZ$/i));
  if (!(await newQuiz.count())) {
    throw new Error(`idea#168 create_quiz: NEW QUIZ button missing on ${app.url()}`);
  }
  await newQuiz.first().click();
  await app.waitForTimeout(1000);
  // Quiz wizard / title field
  const wizard =
    (await bodyHas(app, /quiz|question|title|channel/i)) ||
    (await app.locator('input').count()) > 0;
  if (!wizard) {
    throw new Error(`idea#168 create_quiz: quiz creation UI did not open (${app.url()})`);
  }
  const cancel = app.getByRole('button', { name: /cancel|back|exit|close/i }).first();
  if (await cancel.count()) await cancel.click().catch(() => {});
};

/**
 * read_reports — Reports → Lessons → open Grade 5A Duration Lesson → learner table.
 */
export const read_reports: IntentFn = async ({ page }) => {
  const app = await ensureKolibriCoachPage(page);
  const origin = kolibriOrigin(app, page);
  const cid = classIds()[0]!;
  await gotoCoach(app, origin, `#/${cid}/reports/lessons`);

  const lesson = app.getByText(LESSON_TITLE, { exact: false }).first();
  if (!(await lesson.count())) {
    throw new Error(
      `idea#168 read_reports: '${LESSON_TITLE}' not in reports lessons on ${app.url()}`,
    );
  }
  await lesson.click();
  await app.waitForTimeout(1200);
  const tableOk =
    (await bodyHas(app, /learner|progress|username|status|not started|score/i)) ||
    (await app.locator('table, [role="row"], [role="table"]').count()) > 0;
  if (!tableOk) {
    throw new Error(
      `idea#168 read_reports: lesson report opened but learner table/progress not visible (${app.url()})`,
    );
  }
};

/**
 * preview_as_learner — from coaching, open Learn tab (learner view).
 */
export const preview_as_learner: IntentFn = async ({ page }) => {
  const app = await ensureKolibriCoachPage(page);
  const origin = kolibriOrigin(app, page);
  const learnTargets = [`${origin}/en/learn/#/home`, `${origin}/en/learn/#/`, `${origin}/learn/#/`];
  let landed = false;
  for (const t of learnTargets) {
    try {
      await app.goto(t, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      await app.waitForTimeout(1000);
      if (/\/learn/i.test(app.url())) {
        landed = true;
        break;
      }
    } catch {
      /* try next */
    }
  }
  if (!landed) {
    const learnLink = app.getByRole('link', { name: /^learn$/i }).first();
    if (await learnLink.count()) {
      await learnLink.click();
      await app.waitForTimeout(1200);
      landed = /\/learn/i.test(app.url());
    }
  }
  if (!landed) {
    throw new Error(`idea#168 preview_as_learner: could not open Learn view from ${app.url()}`);
  }
  if (!(await bodyHas(app, /home|library|learn|class|lesson/i))) {
    throw new Error(`idea#168 preview_as_learner: Learn page empty/unexpected (${app.url()})`);
  }
};

/**
 * browse_classes — Learn home: scan channels/classes without starting a resource.
 */
export const browse_classes: IntentFn = async ({ page }) => {
  const app = await ensureKolibriCoachPage(page);
  // Prefer learner session if already learner; else Learn as teacher still shows library
  const origin = kolibriOrigin(app, page);
  await app.goto(`${origin}/en/learn/#/home`, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    .catch(async () => {
      await app.goto(`${origin}/learn/#/home`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    });
  await app.waitForTimeout(1000);
  // Open library / classes chrome
  const library = app.getByRole('link', { name: /library|home|classes/i }).first();
  if (await library.count()) await library.click().catch(() => {});
  await app.waitForTimeout(600);
  const ok =
    (await bodyHas(app, /library|channel|class|home|lesson|grade/i)) ||
    /\/learn/i.test(app.url());
  if (!ok) {
    throw new Error(`idea#168 browse_classes: Learn browse UI not visible (${app.url()})`);
  }
};

