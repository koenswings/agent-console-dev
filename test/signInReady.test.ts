
import { describe, it, expect } from 'vitest';
import { isLiveDurationConsole } from '../e2e/intents/openConsole';

describe('isLiveDurationConsole (Prefer A)', () => {
  const fakePage = (url: string) => ({ url: () => url }) as never;

  it('DURATION_LIVE forces live (no bootDemo)', () => {
    expect(isLiveDurationConsole(fakePage('http://localhost:5173/'), { DURATION_LIVE: '1' })).toBe(true);
  });

  it('DURATION_CONSOLE_URL forces live', () => {
    expect(
      isLiveDurationConsole(fakePage('about:blank'), {
        DURATION_CONSOLE_URL: 'http://idea01:8080/',
      }),
    ).toBe(true);
  });

  it(':8080 URL is live Engine Console', () => {
    expect(isLiveDurationConsole(fakePage('http://idea01:8080/'), {})).toBe(true);
  });

  it('vite localhost stays demo boot path', () => {
    expect(isLiveDurationConsole(fakePage('http://localhost:5173/'), {})).toBe(false);
  });
});
