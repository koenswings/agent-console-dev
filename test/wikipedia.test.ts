import { describe, it, expect } from 'vitest';
import type { Page } from '@playwright/test';
import {
  isKiwixTabUrl,
  kiwixBaseUrl,
  kiwixPage,
  kiwixViewerHomeUrl,
  kiwixViewerPath,
} from '../e2e/intents/wikipedia';
import { DURATION_FIXTURES } from '../e2e/intents/fixtures';

const KW = DURATION_FIXTURES.kiwix;
const BOOK = 'duration_wikipedia_en_grade5a_stub_2026-10';

describe('Kiwix fixture pins (Kid App#11 @a443398 CONTENT.live.json)', () => {
  it('mirrors the kiwix keys', () => {
    expect(KW.diskId).toBe('duration-kiwix-ideaa-001');
    expect(KW.instanceId).toBe('kiwix-ideaa-001');
    expect(KW.sidecarHttpPort).toBe(18380);
    expect(KW.bookName).toBe(BOOK);
    expect(KW.urls.viewerHome).toBe(`http://<host>:18380/viewer#${BOOK}/Main_Page`);
    expect(KW.homeTitle).toBe('Grade 5A Offline Wikipedia');
    expect(KW.search).toMatchObject({ term: 'fraction', resultPath: 'Fraction', followLink: 'Numerator' });
  });
});

describe('Kiwix URL helpers', () => {
  it('kiwixBaseUrl: Console host + 18380, env overrides', () => {
    expect(kiwixBaseUrl('http://idea01:5173/#/', {})).toBe('http://idea01:18380');
    expect(kiwixBaseUrl('http://idea01:5173/', { DURATION_KIWIX_PORT: '18381' })).toBe('http://idea01:18381');
    expect(kiwixBaseUrl('http://idea01:5173/', { DURATION_KIWIX_URL: 'http://pi:9000/' })).toBe('http://pi:9000');
  });

  it('kiwixViewerHomeUrl substitutes <host>:<port> from Kid viewerHome', () => {
    expect(kiwixViewerHomeUrl('http://idea01:18380')).toBe(`http://idea01:18380/viewer#${BOOK}/Main_Page`);
  });

  it('kiwixViewerPath reads #<book>/<path> on /viewer only', () => {
    expect(kiwixViewerPath(`http://h:18380/viewer#${BOOK}/Main_Page`)).toBe('Main_Page');
    expect(kiwixViewerPath(`http://h:18380/viewer#${BOOK}/Fraction`)).toBe('Fraction');
    expect(kiwixViewerPath('http://h:18380/viewer#search?books.name=x&pattern=fraction')).toBeNull();
    expect(kiwixViewerPath('http://h:18380/#lang=eng')).toBeNull();
    expect(kiwixViewerPath(`http://h:18380/content/${BOOK}/Fraction`)).toBeNull();
  });

  it('isKiwixTabUrl matches the resolved Kiwix origin only', () => {
    expect(isKiwixTabUrl(`http://idea01:18380/viewer#${BOOK}/Main_Page`, 'http://idea01:18380')).toBe(true);
    expect(isKiwixTabUrl('http://idea01:18280/apps/files/', 'http://idea01:18380')).toBe(false);
  });
});

describe('kiwixPage (wiki_browse precondition)', () => {
  const ctx = (urls: string[]) => {
    const pages: { url: () => string }[] = [];
    const ctxObj = { pages: () => pages };
    for (const u of urls) pages.push({ url: () => u, context: () => ctxObj } as never);
    return pages as unknown as Page[];
  };

  it('returns the newest Kiwix tab, never the Console', () => {
    const [consolePage, , kiwix] = ctx([
      'http://idea01:5173/#/',
      'http://idea01:18280/apps/files/',
      `http://idea01:18380/viewer#${BOOK}/Main_Page`,
    ]);
    expect(kiwixPage(consolePage!, 't')).toBe(kiwix);
  });

  it('loud-fails when no Kiwix tab is open', () => {
    const [consolePage] = ctx(['http://idea01:5173/#/', 'http://idea01:18080/en/learn/']);
    expect(() => kiwixPage(consolePage!, 'idea#166 search_browse_wikipedia')).toThrow(/not in wiki_browse: no Kiwix tab on http:\/\/idea01:18380/);
  });
});
