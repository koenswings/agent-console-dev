/**
 * Post-Intent viewport screenshot for Axle --record-walk (idea#168).
 *
 * Locked contract with Engine PlaywrightUiDriver soft-detect:
 *   captureAfterIntent(page, { path, intent?, settleMs? })
 *
 * Settle once here (domcontentloaded → optional networkidle → settleMs).
 * Engine must NOT add a second settle wait when this export exists / when
 * runDurationIntent already wrote the PNG via screenshotPath.
 *
 * Screenshot: fullPage: false (viewport only — stitch-friendly for walk.mp4).
 * Engine fallback may use fullPage: true; this hook stays viewport.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Page } from '@playwright/test';
import { appKindForUrl } from './sidecarUrls';

export const CAPTURE_AFTER_INTENT_DEFAULT_SETTLE_MS = 300;

export interface CaptureAfterIntentOptions {
  /** Absolute or relative path for the PNG. */
  path: string;
  /** YAML action key (for diagnostics / future overlays). */
  intent?: string;
  /** Extra settle after load states (default 300ms). */
  settleMs?: number;
}

/**
 * Multi-step in-app intents that keep an App tab (Kolibri/Nextcloud/Kiwix) open
 * and focused across steps until `leave_*` / `back_to_console*`. Recording
 * after these steps must not pull the Console tab to the front mid-flow.
 */
export const IN_APP_INTENTS: ReadonlySet<string> = new Set([
  // Kolibri classroom / coaching / content
  'open_kolibri_as_teacher',
  'open_kolibri_as_learner',
  'open_video',
  'keep_watching',
  'next_resource',
  'finish_exercise',
  'next_video',
  'exit_lesson',
  'open_exercise',
  'create_class',
  'enroll_learners',
  'build_lesson',
  'create_quiz',
  'read_reports',
  'preview_as_learner',
  'browse_classes',
  // Nextcloud classroom / collab / file drop
  'open_nextcloud_as_teacher',
  'open_nextcloud_as_learner',
  'browse_folders',
  'share_to_class',
  'done_sharing',
  'open_collab_doc',
  'close_doc',
  'keep_editing',
  'open_file_drop',
  'after_upload',
  // Wikipedia / Kiwix
  'open_wikipedia_as_teacher',
  'open_wikipedia_as_learner',
  'search_browse_wikipedia',
]);

/** True when `intent` operates inside an open App tab across multiple steps. */
export function isInAppIntent(intent?: string): boolean {
  return !!intent && IN_APP_INTENTS.has(intent);
}

function safePageUrl(page: Page): string {
  try {
    return page.url?.() ?? '';
  } catch {
    return '';
  }
}

/**
 * Resolve the Console Page to capture. Returns `page` directly when it is
 * already a non-App page (Console URL, about:blank, or a minimal test mock);
 * if `page` is an App tab (Kolibri/Nextcloud/Kiwix), selects the open non-App
 * Console tab from the same BrowserContext.
 */
export function resolveConsolePage(page: Page): Page {
  const url = safePageUrl(page);
  if (!url || appKindForUrl(url) === null) {
    return page;
  }
  let pages: Page[] = [];
  try {
    pages = page.context?.()?.pages?.() ?? [];
  } catch {
    pages = [];
  }
  for (const p of pages) {
    try {
      if (p === page || p.isClosed?.()) continue;
      const pUrl = safePageUrl(p);
      if (pUrl && !pUrl.startsWith('about:') && appKindForUrl(pUrl) === null) {
        return p;
      }
    } catch {
      /* ignore closed/inaccessible page */
    }
  }
  for (const p of pages) {
    try {
      if (p === page || p.isClosed?.()) continue;
      const pUrl = safePageUrl(p);
      if (pUrl && appKindForUrl(pUrl) === null) return p;
    } catch {
      /* ignore */
    }
  }
  return page;
}

/**
 * Wait for a settled DOM, then write a viewport PNG to opts.path.
 * For Console steps (and when intent is omitted), resolves and focuses the
 * Console page via bringToFront() before settling so a leftover foreground App
 * tab cannot mask Console UI state.
 * Best-effort load waits — never throws solely because networkidle timed out
 * or bringToFront fails.
 */
export async function captureAfterIntent(
  page: Page,
  opts: CaptureAfterIntentOptions,
): Promise<void> {
  const settleMs = opts.settleMs ?? CAPTURE_AFTER_INTENT_DEFAULT_SETTLE_MS;
  const outPath = opts.path;
  if (!outPath) {
    throw new Error('idea#168 captureAfterIntent: opts.path is required');
  }

  mkdirSync(dirname(outPath), { recursive: true });

  const consoleStep = !isInAppIntent(opts.intent);
  const target = consoleStep ? resolveConsolePage(page) : page;
  if (consoleStep) {
    await target.bringToFront?.().catch(() => {});
  }

  // Settle once — Engine soft-detect skips a second wait when PNG already exists
  // or when this function is invoked from captureFrame.
  try {
    await target.waitForLoadState('domcontentloaded', { timeout: 10_000 });
  } catch {
    /* page may already be idle / closed-ish — still try screenshot */
  }
  try {
    await target.waitForLoadState('networkidle', { timeout: 5_000 });
  } catch {
    /* networkidle is optional; many SPAs never go fully idle */
  }
  if (settleMs > 0) {
    await target.waitForTimeout(settleMs);
  }

  await target.screenshot({
    path: outPath,
    fullPage: false, // viewport — stitch-friendly; Engine fallback may differ
  });
}
