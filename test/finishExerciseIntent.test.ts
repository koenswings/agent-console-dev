import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Page } from '@playwright/test';
import {
  EXERCISE_SELECTORS as S,
  exerciseChoiceSelectors,
  isLearnHomeUrl,
  learnHashRoute,
  learnHomeHopSelectors,
  runFinishExercise,
} from '../e2e/intents/openKolibriContent';
import { DURATION_FIXTURES } from '../e2e/intents/fixtures';

const exercise = DURATION_FIXTURES.kolibri.exercise;
const video = DURATION_FIXTURES.kolibri.video;
const BASE = 'http://idea01:18080/en/learn/#';
const EX_URL = `${BASE}/topics/c/${exercise.nodeIdRaw}?prevName=TOPICS_TOPIC`;
const CHOICE = '.perseus-widget-radio li:has-text("4")';
const CHECK = S.check[0];
const NEXT = S.next[0];
const MODAL = S.completed[0];
const STATUS = S.completed[1];
const CLOSE = S.modalClose[0];
const BACK = S.back[0];
const HOME = S.homeLink[0];
const TOOLBAR_CLOSE = S.toolbarExit[0];
const SEARCH = `/topics/t/${exercise.parentTopicNodeIdRaw}/search`;

/**
 * `afterMask` effects apply once the post-navigation mask clears (models the
 * old page's toolbar lingering until Library renders).
 */
type Effect = { show?: string[]; hide?: string[]; to?: string; afterMask?: { show?: string[]; hide?: string[] } };

function fakeExercisePage(opts: {
  start: string;
  visible: string[];
  onClick: Record<string, Effect | (() => Effect)>;
  /** Kolibri blockDoubleClicks: `.click-mask` for this long after each route change. */
  maskMs?: number;
}) {
  let url = opts.start;
  const visible = new Set(opts.visible);
  const clicks: string[] = [];
  const intercepted: string[] = [];
  const gotos: string[] = [];
  let maskUntil = 0;
  let pendingAfterMask: Effect['afterMask'] | null = null;
  const masked = () => {
    if (Date.now() < maskUntil) return true;
    if (pendingAfterMask) {
      for (const s of pendingAfterMask.hide ?? []) visible.delete(s);
      for (const s of pendingAfterMask.show ?? []) visible.add(s);
      pendingAfterMask = null;
    }
    return false;
  };
  const page = {
    url: () => url,
    async goto(t: string) {
      gotos.push(t);
      url = t;
      return null;
    },
    async waitForTimeout(ms: number) {
      vi.setSystemTime(Date.now() + ms);
    },
    locator(selector: string) {
      const first = {
        async count() {
          if (selector === '.click-mask') return masked() ? 1 : 0;
          masked();
          return visible.has(selector) ? 1 : 0;
        },
        async click() {
          if (masked()) {
            intercepted.push(selector);
            // Playwright: waits, mask intercepts, then the element detaches.
            if (pendingAfterMask?.hide?.includes(selector)) vi.setSystemTime(maskUntil);
            throw new Error('locator.click: Timeout exceeded. <div class="click-mask"></div> intercepts pointer events');
          }
          if (!visible.has(selector)) throw new Error(`not visible: ${selector}`);
          clicks.push(selector);
          const raw = opts.onClick[selector];
          const eff = typeof raw === 'function' ? raw() : raw ?? {};
          for (const s of eff.hide ?? []) visible.delete(s);
          for (const s of eff.show ?? []) visible.add(s);
          if (eff.to) {
            url = `${url.split('#')[0]}#${eff.to}`;
            if (opts.maskMs) maskUntil = Date.now() + opts.maskMs;
            pendingAfterMask = eff.afterMask ?? null;
          }
        },
      };
      return { first: () => first, count: first.count };
    },
  };
  return { page: page as unknown as Page, clicks, gotos, intercepted };
}

describe('isLearnHomeUrl', () => {
  it('accepts #/home (with query) only', () => {
    expect(isLearnHomeUrl(`${BASE}/home`)).toBe(true);
    expect(isLearnHomeUrl(`${BASE}/home?x=1`)).toBe(true);
    expect(isLearnHomeUrl(EX_URL)).toBe(false);
    expect(isLearnHomeUrl(`${BASE}/topics/t/${exercise.parentTopicNodeIdRaw}/folders`)).toBe(false);
    expect(isLearnHomeUrl('http://idea01:18080/en/learn/')).toBe(false);
    expect(isLearnHomeUrl('')).toBe(false);
  });
});

describe('learnHomeHopSelectors', () => {
  it('uses bar Go back on a content page and toolbar Close on topic/search pages', () => {
    expect(learnHomeHopSelectors(EX_URL)).toContain(BACK);
    expect(learnHomeHopSelectors(EX_URL)).not.toContain(TOOLBAR_CLOSE);
    const search = `${BASE}${SEARCH}`;
    expect(learnHomeHopSelectors(search)).toContain(TOOLBAR_CLOSE);
    expect(learnHomeHopSelectors(search)[0]).toBe(HOME);
    expect(learnHashRoute(search)).toBe(SEARCH);
  });
});

describe('exerciseChoiceSelectors', () => {
  it('targets choice "4" by text first, then fixture index 1', () => {
    const sel = exerciseChoiceSelectors(exercise);
    expect(sel[0]).toBe(CHOICE);
    expect(sel).toContain('.perseus-widget-radio input[type="radio"] >> nth=1');
  });
});

describe('runFinishExercise (exercise → completed → Learn home)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('r7 path: Go back lands on topic search; toolbar Close → Library; top-nav Home → #/home', async () => {
    const { page, clicks, gotos } = fakeExercisePage({
      start: EX_URL,
      visible: [CHECK, CHOICE, BACK],
      onClick: {
        [CHECK]: { hide: [CHECK], show: [NEXT, MODAL, CLOSE] },
        [CLOSE]: { hide: [MODAL, CLOSE] },
        // Immersive topic search page: no top nav, only the toolbar Close.
        [BACK]: { to: SEARCH, hide: [BACK, NEXT, CHOICE], show: [TOOLBAR_CLOSE] },
        [TOOLBAR_CLOSE]: { to: '/library', hide: [TOOLBAR_CLOSE], show: [HOME] },
        [HOME]: { to: '/home' },
      },
    });
    await runFinishExercise(page, exercise);
    expect(clicks).toEqual([CHOICE, CHECK, CLOSE, BACK, TOOLBAR_CLOSE, HOME]);
    expect(gotos).toEqual([]);
    expect(isLearnHomeUrl(page.url())).toBe(true);
  });

  it('r8: waits out the 500ms click-mask after each route change; never clicks the stale Close on Library', async () => {
    const STALE_CLOSE = 'a[aria-current="page"]:has(> button[aria-label="Close"])';
    const { page, clicks, intercepted, gotos } = fakeExercisePage({
      start: EX_URL,
      maskMs: 500,
      visible: [CHECK, CHOICE, BACK],
      onClick: {
        [CHECK]: { hide: [CHECK], show: [NEXT, MODAL, CLOSE] },
        [CLOSE]: { hide: [MODAL, CLOSE] },
        [BACK]: { to: SEARCH, hide: [BACK, NEXT, CHOICE], show: [TOOLBAR_CLOSE] },
        // On #/library the old toolbar lingers (now aria-current=page) until the mask clears.
        [TOOLBAR_CLOSE]: {
          to: '/library',
          hide: [TOOLBAR_CLOSE],
          show: [STALE_CLOSE],
          afterMask: { hide: [STALE_CLOSE], show: [HOME] },
        },
        [HOME]: { to: '/home' },
      },
    });
    await runFinishExercise(page, exercise);
    expect(clicks).toEqual([CHOICE, CHECK, CLOSE, BACK, TOOLBAR_CLOSE, HOME]);
    expect(clicks).not.toContain(STALE_CLOSE);
    expect(intercepted).toEqual([]);
    expect(gotos).toEqual([]);
    expect(isLearnHomeUrl(page.url())).toBe(true);
  });

  it('toolbarExit selectors skip links to the current page (aria-current="page")', () => {
    for (const s of S.toolbarExit.filter((x) => x.startsWith('a'))) {
      expect(s).toContain(':not([aria-current="page"])');
    }
  });

  it('loud-fails when the click-mask never clears', async () => {
    const { page } = fakeExercisePage({
      start: EX_URL,
      maskMs: 60_000,
      visible: [CHECK, CHOICE, BACK],
      onClick: {
        [CHECK]: { hide: [CHECK], show: [NEXT, STATUS] },
        [BACK]: { to: SEARCH, hide: [BACK], show: [TOOLBAR_CLOSE] },
      },
    });
    await expect(runFinishExercise(page, exercise)).rejects.toThrow(
      /click-mask \(\.click-mask\) still covering http:\/\/idea01:18080\/en\/learn\/#\/topics\/t\/63427029c7eb5e86b62a731d9564aa50\/search/,
    );
  });

  it('topic page toolbar Close goes straight home when the route has last=HOME', async () => {
    const { page, clicks } = fakeExercisePage({
      start: EX_URL,
      visible: [CHECK, CHOICE, BACK],
      onClick: {
        [CHECK]: { hide: [CHECK], show: [NEXT, STATUS] },
        [BACK]: { to: `${SEARCH}?last=HOME`, hide: [BACK], show: [TOOLBAR_CLOSE] },
        [TOOLBAR_CLOSE]: { to: '/home' },
      },
    });
    await runFinishExercise(page, exercise);
    expect(clicks).toEqual([CHOICE, CHECK, BACK, TOOLBAR_CLOSE]);
  });

  it('loud-fails on the topic search page when no nav control is present (no soft-pass)', async () => {
    const { page } = fakeExercisePage({
      start: EX_URL,
      visible: [CHECK, CHOICE, BACK],
      onClick: {
        [CHECK]: { hide: [CHECK], show: [NEXT, STATUS] },
        [BACK]: { to: SEARCH, hide: [BACK] },
      },
    });
    await expect(runFinishExercise(page, exercise)).rejects.toThrow(
      /no Learn nav control on http:\/\/idea01:18080\/en\/learn\/#\/topics\/t\/63427029c7eb5e86b62a731d9564aa50\/search/,
    );
    expect(isLearnHomeUrl(page.url())).toBe(false);
  });

  it('loud-fails when a nav click does not change the URL', async () => {
    const { page } = fakeExercisePage({
      start: EX_URL,
      visible: [CHECK, CHOICE, BACK],
      onClick: {
        [CHECK]: { hide: [CHECK], show: [NEXT, STATUS] },
        [BACK]: { to: SEARCH, hide: [BACK], show: [TOOLBAR_CLOSE] },
        [TOOLBAR_CLOSE]: {},
      },
    });
    await expect(runFinishExercise(page, exercise)).rejects.toThrow(/URL did not change/);
  });

  it('re-run (already mastered, no modal): still answers one item, then "Completed" status counts', async () => {
    const { page, clicks } = fakeExercisePage({
      start: EX_URL,
      visible: [CHECK, CHOICE, BACK, STATUS],
      onClick: {
        [CHECK]: { hide: [CHECK], show: [NEXT] },
        [BACK]: { to: '/home' },
      },
    });
    await runFinishExercise(page, exercise);
    expect(clicks).toEqual([CHOICE, CHECK, BACK]);
  });

  it('answers a second item when the first correct answer does not complete it', async () => {
    let checks = 0;
    const { page, clicks } = fakeExercisePage({
      start: EX_URL,
      visible: [CHECK, CHOICE, BACK],
      onClick: {
        [CHECK]: () => (++checks === 1 ? { hide: [CHECK], show: [NEXT] } : { hide: [CHECK], show: [NEXT, STATUS] }),
        [NEXT]: { hide: [NEXT], show: [CHECK] },
        [BACK]: { to: '/home' },
      },
    });
    await runFinishExercise(page, exercise);
    expect(clicks).toEqual([CHOICE, CHECK, NEXT, CHOICE, CHECK, BACK]);
  });

  it('loud-fails when not starting on the pinned exercise (no re-open)', async () => {
    const { page, clicks } = fakeExercisePage({ start: `${BASE}/topics/c/${video.nodeIdRaw}`, visible: [], onClick: {} });
    await expect(runFinishExercise(page, exercise)).rejects.toThrow(
      /finish_exercise: expected to start on exercise-grade5a-01 .*Not re-opening/,
    );
    expect(clicks).toEqual([]);
  });

  it('loud-fails when Perseus never renders Check/Next', async () => {
    const { page } = fakeExercisePage({ start: EX_URL, visible: [], onClick: {} });
    await expect(runFinishExercise(page, exercise)).rejects.toThrow(/Check\/Next\) did not render/);
  });

  it('loud-fails when Check does not mark the answer correct', async () => {
    const { page } = fakeExercisePage({ start: EX_URL, visible: [CHECK, CHOICE], onClick: { [CHECK]: {} } });
    await expect(runFinishExercise(page, exercise)).rejects.toThrow(/did not mark item 1 correct/);
  });

  it('loud-fails when completion never appears after the max items', async () => {
    const { page } = fakeExercisePage({
      start: EX_URL,
      visible: [CHECK, CHOICE],
      onClick: { [CHECK]: { hide: [CHECK], show: [NEXT] }, [NEXT]: { hide: [NEXT], show: [CHECK] } },
    });
    await expect(runFinishExercise(page, exercise)).rejects.toThrow(/answered 4 item\(s\) .*but no completion/);
  });

  it('loud-fails when nav keeps bouncing between non-home pages', async () => {
    let n = 0;
    const { page } = fakeExercisePage({
      start: EX_URL,
      visible: [CHECK, CHOICE, BACK],
      onClick: {
        [CHECK]: { hide: [CHECK], show: [NEXT, STATUS] },
        [BACK]: { to: SEARCH, hide: [BACK], show: [TOOLBAR_CLOSE] },
        [TOOLBAR_CLOSE]: () => ({ to: `${SEARCH}?n=${++n}` }),
      },
    });
    await expect(runFinishExercise(page, exercise)).rejects.toThrow(
      /did not reach #\/home after 5 hops .*final http:\/\/idea01:18080\/en\/learn\/#\/topics\/t\/63427029c7eb5e86b62a731d9564aa50\/search/,
    );
  });
});
