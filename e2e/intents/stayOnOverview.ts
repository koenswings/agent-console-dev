/**
 * Minimal usage Intents: dwell on teacher / learner overview (idea#166).
 */
import type { IntentFn } from './types';
import { sel } from './selectors';

export const stay_on_teacher_overview: IntentFn = async ({ page }) => {
  await page.locator(sel.consoleOverview).waitFor({ state: 'visible', timeout: 10_000 });
  // Dwell — CRDT updates; no selection change
  await page.waitForTimeout(200);
};

export const stay_on_learner_overview: IntentFn = async ({ page }) => {
  await page.locator(sel.consoleOverview).waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(200);
};
