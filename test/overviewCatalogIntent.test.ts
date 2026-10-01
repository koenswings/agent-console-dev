import { describe, it, expect } from 'vitest';
import {
  overviewCatalogTimeoutMs,
  isConnectingStatusLabel,
} from '../e2e/intents/stayOnOverview';

describe('overviewCatalogTimeoutMs (Prefer A r40)', () => {
  it('defaults to 60s for cold WS/catalog sync', () => {
    expect(overviewCatalogTimeoutMs({})).toBe(60_000);
  });

  it('DURATION_OVERVIEW_CATALOG_MS override', () => {
    expect(overviewCatalogTimeoutMs({ DURATION_OVERVIEW_CATALOG_MS: '45000' })).toBe(
      45_000,
    );
  });

  it('rejects values below 5s floor', () => {
    expect(overviewCatalogTimeoutMs({ DURATION_OVERVIEW_CATALOG_MS: '1000' })).toBe(
      5_000,
    );
  });
});

describe('isConnectingStatusLabel', () => {
  it('detects Connecting… / Searching…', () => {
    expect(isConnectingStatusLabel('Connecting…')).toBe(true);
    expect(isConnectingStatusLabel('Searching…')).toBe(true);
    expect(isConnectingStatusLabel('100.99.231.94')).toBe(false);
    expect(isConnectingStatusLabel('idea01')).toBe(false);
  });
});
