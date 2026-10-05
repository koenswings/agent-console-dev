import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Page } from '@playwright/test';
import {
  contentUrlHasPinnedId,
  kolibriContentRouteNodeId,
  openContentByIds,
  urlHasPinnedVideo,
} from '../e2e/intents/openKolibriContent';
import { DURATION_FIXTURES } from '../e2e/intents/fixtures';

const video = DURATION_FIXTURES.kolibri.video;
const exercise = DURATION_FIXTURES.kolibri.exercise;
const BASE = 'http://idea01:18080/en/learn/#';

describe('kolibriContentRouteNodeId', () => {
  it('reads the node id from TOPICS_CONTENT routes (with query, device segment, dashes)', () => {
    expect(kolibriContentRouteNodeId(`${BASE}/topics/c/${video.nodeIdRaw}`)).toBe(video.nodeIdRaw);
    expect(
      kolibriContentRouteNodeId(`${BASE}/topics/c/${video.nodeIdRaw}?prevName=TOPICS_TOPIC&prevQuery=%7B%7D`),
    ).toBe(video.nodeIdRaw);
    expect(
      kolibriContentRouteNodeId(`${BASE}/topics/30b6c2634b965a6293bddcf9a5cad7ca/c/${video.nodeIdRaw}`),
    ).toBe(video.nodeIdRaw);
    expect(kolibriContentRouteNodeId(`${BASE}/topics/c/${video.nodeId}`)).toBe(video.nodeIdRaw);
  });

  it('is null for topic folders, home, lessons and non-hash URLs', () => {
    expect(kolibriContentRouteNodeId(`${BASE}/topics/t/${video.parentTopicNodeIdRaw}/folders`)).toBeNull();
    expect(kolibriContentRouteNodeId(`${BASE}/home`)).toBeNull();
    expect(kolibriContentRouteNodeId(`${BASE}/lessons/11111111222233334444555555555555`)).toBeNull();
    expect(kolibriContentRouteNodeId(`http://idea01:18080/topics/c/${video.nodeIdRaw}`)).toBeNull();
    expect(kolibriContentRouteNodeId('')).toBeNull();
  });
});

describe('urlHasPinnedVideo (open_video / keep_watching)', () => {
  it('passes on the live Learn URL Kid observed (node id in /topics/c/, no content id)', () => {
    const live = `${BASE}/topics/c/4a1a1b923f6d59eba94c3f91f0011dd5?prevName=TOPICS_TOPIC`;
    expect(live).not.toContain(video.contentIdRaw);
    expect(urlHasPinnedVideo(live, video)).toBe(true);
    expect(contentUrlHasPinnedId(live, video)).toBe(true);
  });

  it('fails for the exercise node, the parent topic folder, home, lesson-only and empty URLs', () => {
    expect(urlHasPinnedVideo(`${BASE}/topics/c/${exercise.nodeIdRaw}`, video)).toBe(false);
    expect(urlHasPinnedVideo(`${BASE}/topics/t/${video.parentTopicNodeIdRaw}/folders`, video)).toBe(false);
    expect(urlHasPinnedVideo(`${BASE}/home`, video)).toBe(false);
    expect(urlHasPinnedVideo(`${BASE}/lessons/11111111-2222-3333-4444-555555555555`, video)).toBe(false);
    expect(urlHasPinnedVideo('', video)).toBe(false);
    expect(urlHasPinnedVideo('   ', video)).toBe(false);
  });

  it('does not accept a content id outside the node route', () => {
    expect(urlHasPinnedVideo(`http://idea01:18080/en/learn/?content_id=${video.contentIdRaw}`, video)).toBe(false);
  });

  it('exercise pin matches only its own node route', () => {
    expect(urlHasPinnedVideo(`${BASE}/topics/c/${exercise.nodeIdRaw}`, exercise)).toBe(true);
    expect(urlHasPinnedVideo(`${BASE}/topics/c/${video.nodeIdRaw}`, exercise)).toBe(false);
  });
});

/**
 * Minimal fake Learn tab: per-route cards; clicking a card navigates.
 * Topic routes redirect like Kolibri (/topics/t/:id → /topics/t/:id/folders).
 */
function fakeLearn(opts: {
  start: string;
  cards: Record<string, { selector: string; to: string }[]>;
  deepLinkWorks?: boolean;
}) {
  let url = opts.start;
  const gotos: string[] = [];
  const clicks: string[] = [];
  const routeKey = () => url.split('#')[1]?.split('?')[0] ?? '';
  const page = {
    url: () => url,
    async goto(target: string) {
      gotos.push(target);
      if (/\/topics\/c\//.test(target) && !opts.deepLinkWorks) {
        url = `${target.split('#')[0]}#/home`;
        return null;
      }
      url = /\/topics\/t\/[^/]+$/.test(target) ? `${target}/folders` : target;
      return null;
    },
    async waitForTimeout(ms: number) {
      vi.setSystemTime(Date.now() + ms);
    },
    locator(selector: string) {
      const match = () => (opts.cards[routeKey()] ?? []).find((c) => c.selector === selector);
      const first = {
        async count() {
          return match() ? 1 : 0;
        },
        async click() {
          const m = match();
          if (!m) throw new Error('not found');
          clicks.push(selector);
          url = `${url.split('#')[0]}#${m.to}`;
        },
      };
      return { first: () => first, count: first.count };
    },
  };
  return { page: page as unknown as Page, gotos, clicks };
}

const videoOpts = {
  contentId: video.contentId,
  contentIdRaw: video.contentIdRaw,
  nodeId: video.nodeId,
  nodeIdRaw: video.nodeIdRaw,
  title: video.title,
  parentTopicNodeIdRaw: video.parentTopicNodeIdRaw,
  action: 'open_video',
  logicalId: video.logicalId,
};

describe('openContentByIds (topic → video leaf)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T08:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens the parent topic and clicks the video card into /topics/c/<node>', async () => {
    const parentRoute = `/topics/t/${video.parentTopicNodeIdRaw}/folders`;
    const { page, gotos, clicks } = fakeLearn({
      start: `${BASE}/home`,
      cards: {
        [parentRoute]: [
          { selector: `a[href*="/topics/c/${video.nodeIdRaw}"]`, to: `/topics/c/${video.nodeIdRaw}?prevName=TOPICS_TOPIC` },
        ],
      },
    });
    await openContentByIds(page, videoOpts);
    expect(gotos[0]).toBe(`${BASE}/topics/t/${video.parentTopicNodeIdRaw}`);
    expect(clicks).toEqual([`a[href*="/topics/c/${video.nodeIdRaw}"]`]);
    expect(urlHasPinnedVideo(page.url(), video)).toBe(true);
  });

  it('clicks the card by title when the href form is absent', async () => {
    const parentRoute = `/topics/t/${video.parentTopicNodeIdRaw}/folders`;
    const { page, clicks } = fakeLearn({
      start: `${BASE}/home`,
      cards: { [parentRoute]: [{ selector: 'a:has-text("Open video target")', to: `/topics/c/${video.nodeIdRaw}` }] },
    });
    await openContentByIds(page, videoOpts);
    expect(clicks).toEqual(['a:has-text("Open video target")']);
  });

  it('returns immediately when already on the pinned node route', async () => {
    const { page, gotos, clicks } = fakeLearn({ start: `${BASE}/topics/c/${video.nodeIdRaw}`, cards: {} });
    await openContentByIds(page, videoOpts);
    expect(gotos).toEqual([]);
    expect(clicks).toEqual([]);
  });

  it('falls back to the /topics/c/<node> deep link when no card is present', async () => {
    const { page, gotos } = fakeLearn({ start: `${BASE}/home`, cards: {}, deepLinkWorks: true });
    await openContentByIds(page, videoOpts);
    expect(gotos.at(-1)).toBe(`${BASE}/topics/c/${video.nodeIdRaw}`);
    expect(urlHasPinnedVideo(page.url(), video)).toBe(true);
  });

  it('loud-fails when neither a card click nor the deep link reaches the node route', async () => {
    const parentRoute = `/topics/t/${video.parentTopicNodeIdRaw}/folders`;
    const { page } = fakeLearn({
      start: `${BASE}/home`,
      // Wrong card: lands on the exercise, not the pinned video.
      cards: { [parentRoute]: [{ selector: 'a:has-text("Open video target")', to: `/topics/c/${exercise.nodeIdRaw}` }] },
    });
    await expect(openContentByIds(page, videoOpts)).rejects.toThrow(
      /open_video: resource video-grade5a-01 .*did not reach Kolibri content page \/topics\/c\/4a1a1b923f6d59eba94c3f91f0011dd5/,
    );
  });
});
