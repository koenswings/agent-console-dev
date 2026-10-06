import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Page } from '@playwright/test';
import {
  nextResourceRowSelectors,
  runNextResource,
  urlHasPinnedVideo,
} from '../e2e/intents/openKolibriContent';
import { DURATION_FIXTURES } from '../e2e/intents/fixtures';

const video = DURATION_FIXTURES.kolibri.video;
const exercise = DURATION_FIXTURES.kolibri.exercise;
const BASE = 'http://idea01:18080/en/learn/#';
const VIDEO_URL = `${BASE}/topics/c/${video.nodeIdRaw}?prevName=TOPICS_TOPIC`;
const EX_ROW = `.also-in-this-side-panel a[href*="/topics/c/${exercise.nodeIdRaw}"]`;

/**
 * Fake Kolibri content page. `visible` is the set of selectors currently
 * present; `onClick` maps a selector to what clicking it does.
 */
function fakeContentPage(opts: {
  start: string;
  visible: string[];
  onClick: Record<string, { show?: string[]; to?: string }>;
}) {
  let url = opts.start;
  const visible = new Set(opts.visible);
  const clicks: string[] = [];
  const gotos: string[] = [];
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
          return visible.has(selector) ? 1 : 0;
        },
        async click() {
          if (!visible.has(selector)) throw new Error(`not visible: ${selector}`);
          clicks.push(selector);
          const eff = opts.onClick[selector] ?? {};
          for (const s of eff.show ?? []) visible.add(s);
          if (eff.to) url = `${url.split('#')[0]}#${eff.to}`;
        },
      };
      return { first: () => first, count: first.count };
    },
  };
  return { page: page as unknown as Page, clicks, gotos };
}

describe('nextResourceRowSelectors', () => {
  it('targets the exercise node link inside the resource panel first, then title', () => {
    const sel = nextResourceRowSelectors(exercise);
    expect(sel[0]).toBe(`.also-in-this-side-panel a[href*="/topics/c/${exercise.nodeId}"]`);
    expect(sel).toContain(EX_ROW);
    expect(sel).toContain('.also-in-this-side-panel a:has-text("Open exercise target")');
    expect(sel.some((s) => s.includes(video.nodeIdRaw))).toBe(false);
  });
});

describe('runNextResource (video → exercise via Kolibri resource panel)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T09:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('clicks the bar "View folder resources" button then the exercise row', async () => {
    const bar = '[data-test="bar_viewTopicResourcesButton"]';
    const { page, clicks, gotos } = fakeContentPage({
      start: VIDEO_URL,
      visible: [bar],
      onClick: {
        [bar]: { show: [EX_ROW] },
        [EX_ROW]: { to: `/topics/c/${exercise.nodeIdRaw}?prevName=TOPICS_TOPIC` },
      },
    });
    await runNextResource(page, video, exercise);
    expect(clicks).toEqual([bar, EX_ROW]);
    expect(gotos).toEqual([]);
    expect(urlHasPinnedVideo(page.url(), exercise)).toBe(true);
  });

  it('uses the lesson-context button and the title row when the href form is absent', async () => {
    const bar = '[data-test="bar_viewLessonPlanButton"]';
    const titleRow = '.also-in-this-side-panel a:has-text("Open exercise target")';
    const { page, clicks } = fakeContentPage({
      start: VIDEO_URL,
      visible: [bar],
      onClick: { [bar]: { show: [titleRow] }, [titleRow]: { to: `/topics/c/${exercise.nodeIdRaw}` } },
    });
    await runNextResource(page, video, exercise);
    expect(clicks).toEqual([bar, titleRow]);
  });

  it('falls back to More options → menu item on a narrow window', async () => {
    const more = '[data-test="moreOptionsButton"]';
    const item = '[data-test="menu_viewTopicResourcesButton"]';
    const { page, clicks } = fakeContentPage({
      start: VIDEO_URL,
      visible: [more],
      onClick: {
        [more]: { show: [item] },
        [item]: { show: [EX_ROW] },
        [EX_ROW]: { to: `/topics/c/${exercise.nodeIdRaw}` },
      },
    });
    await runNextResource(page, video, exercise);
    expect(clicks).toEqual([more, item, EX_ROW]);
  });

  it('loud-fails when not starting on the pinned video (no silent re-open)', async () => {
    const { page, clicks } = fakeContentPage({ start: `${BASE}/home`, visible: [], onClick: {} });
    await expect(runNextResource(page, video, exercise)).rejects.toThrow(
      /next_resource: expected to start on video-grade5a-01 .*URL is http:\/\/idea01:18080\/en\/learn\/#\/home/,
    );
    expect(clicks).toEqual([]);
  });

  it('loud-fails when the resource-list control is missing', async () => {
    const { page } = fakeContentPage({ start: VIDEO_URL, visible: [], onClick: {} });
    await expect(runNextResource(page, video, exercise)).rejects.toThrow(
      /resource-list control not found/,
    );
  });

  it('loud-fails when the panel has no exercise row', async () => {
    const bar = '[data-test="bar_viewTopicResourcesButton"]';
    const { page } = fakeContentPage({ start: VIDEO_URL, visible: [bar], onClick: { [bar]: {} } });
    await expect(runNextResource(page, video, exercise)).rejects.toThrow(
      /resource panel \(opened via bar\) has no row for exercise-grade5a-01/,
    );
  });

  it('loud-fails when the click does not reach the exercise node route', async () => {
    const bar = '[data-test="bar_viewTopicResourcesButton"]';
    const { page } = fakeContentPage({
      start: VIDEO_URL,
      visible: [bar],
      // Row exists but lands back on the video.
      onClick: { [bar]: { show: [EX_ROW] }, [EX_ROW]: { to: `/topics/c/${video.nodeIdRaw}` } },
    });
    await expect(runNextResource(page, video, exercise)).rejects.toThrow(
      /did not reach \/topics\/c\/94a47ec7f30d5cd193f8ad08c42b6c2a/,
    );
  });
});

describe('runNextResource as next_video (exercise → video via the same panel)', () => {
  const EX_URL = `${BASE}/topics/c/${exercise.nodeIdRaw}?prevName=TOPICS_TOPIC`;
  const VIDEO_ROW = `.also-in-this-side-panel a[href*="/topics/c/${video.nodeIdRaw}"]`;
  const BAR = '[data-test="bar_viewTopicResourcesButton"]';

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T12:30:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('clicks the resource-list button then the video row and lands on the video node', async () => {
    const { page, clicks, gotos } = fakeContentPage({
      start: EX_URL,
      visible: [BAR],
      onClick: {
        [BAR]: { show: [VIDEO_ROW] },
        [VIDEO_ROW]: { to: `/topics/c/${video.nodeIdRaw}?prevName=TOPICS_TOPIC` },
      },
    });
    await runNextResource(page, exercise, video, 'next_video');
    expect(clicks).toEqual([BAR, VIDEO_ROW]);
    expect(gotos).toEqual([]);
    expect(urlHasPinnedVideo(page.url(), video)).toBe(true);
  });

  it('clicks the video row by title when the href form is absent', async () => {
    const titleRow = '.also-in-this-side-panel a:has-text("Open video target")';
    const { page, clicks } = fakeContentPage({
      start: EX_URL,
      visible: [BAR],
      onClick: { [BAR]: { show: [titleRow] }, [titleRow]: { to: `/topics/c/${video.nodeIdRaw}` } },
    });
    await runNextResource(page, exercise, video, 'next_video');
    expect(clicks).toEqual([BAR, titleRow]);
  });

  it('loud-fails with the next_video tag when not starting on the exercise', async () => {
    const { page, clicks } = fakeContentPage({ start: VIDEO_URL, visible: [BAR], onClick: {} });
    await expect(runNextResource(page, exercise, video, 'next_video')).rejects.toThrow(
      /next_video: expected to start on exercise-grade5a-01 .*Not re-opening it/,
    );
    expect(clicks).toEqual([]);
  });

  it('loud-fails when the click lands back on the exercise instead of the video', async () => {
    const { page } = fakeContentPage({
      start: EX_URL,
      visible: [BAR],
      onClick: { [BAR]: { show: [VIDEO_ROW] }, [VIDEO_ROW]: { to: `/topics/c/${exercise.nodeIdRaw}` } },
    });
    await expect(runNextResource(page, exercise, video, 'next_video')).rejects.toThrow(
      /next_video: clicked video-grade5a-01 row .*did not reach \/topics\/c\/4a1a1b923f6d59eba94c3f91f0011dd5/,
    );
  });
});
