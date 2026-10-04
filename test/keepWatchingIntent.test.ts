import { describe, it, expect } from 'vitest';
import { contentUrlHasPinnedId, urlHasPinnedVideo } from '../e2e/intents/openKolibriContent';
import { DURATION_FIXTURES } from '../e2e/intents/fixtures';

const video = DURATION_FIXTURES.kolibri.video;
const exercise = DURATION_FIXTURES.kolibri.exercise;

describe('urlHasPinnedVideo (keep_watching)', () => {
  it('passes when the URL contains the dashed content id', () => {
    expect(
      urlHasPinnedVideo(
        `http://idea01:18080/en/learn/#/topics/c/${video.contentId}`,
        video.contentId,
        video.contentIdRaw,
      ),
    ).toBe(true);
  });

  it('passes when the URL contains the raw content id', () => {
    expect(
      urlHasPinnedVideo(
        `http://idea01:18080/en/learn/?content_id=${video.contentIdRaw}`,
        video.contentId,
        video.contentIdRaw,
      ),
    ).toBe(true);
  });

  it('fails for a different id or the exercise pin', () => {
    expect(
      urlHasPinnedVideo(
        `http://idea01:18080/en/learn/?content_id=${exercise.contentIdRaw}`,
        video.contentId,
        video.contentIdRaw,
      ),
    ).toBe(false);
    expect(
      urlHasPinnedVideo(
        'http://idea01:18080/en/learn/#/home',
        video.contentId,
        video.contentIdRaw,
      ),
    ).toBe(false);
  });

  it('fails for an empty URL', () => {
    expect(urlHasPinnedVideo('', video.contentId, video.contentIdRaw)).toBe(false);
    expect(urlHasPinnedVideo('   ', video.contentId, video.contentIdRaw)).toBe(false);
  });

  it('fails for /en/learn/#/home and a lesson-id-only URL', () => {
    const home = 'http://idea01:18080/en/learn/#/home';
    expect(urlHasPinnedVideo(home, video.contentId, video.contentIdRaw)).toBe(false);
    const lessonOnly = 'http://idea01:18080/en/learn/#/lessons/11111111-2222-3333-4444-555555555555';
    expect(contentUrlHasPinnedId(lessonOnly, video.contentId, video.contentIdRaw)).toBe(false);
    expect(urlHasPinnedVideo(lessonOnly, video.contentId, video.contentIdRaw)).toBe(false);
  });
});
