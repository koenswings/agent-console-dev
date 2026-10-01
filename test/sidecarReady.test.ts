import { describe, it, expect } from 'vitest';
import {
  sidecarReadyTimeoutMs,
  isSidecarHttpReadyStatus,
  resolveSidecarUrl,
} from '../e2e/intents/sidecarUrls';

describe('sidecar HTTP ready (Prefer A r19)', () => {
  it('defaults DURATION_SIDECAR_READY_MS to 90s', () => {
    expect(sidecarReadyTimeoutMs({})).toBe(90_000);
  });

  it('DURATION_SIDECAR_READY_MS override', () => {
    expect(sidecarReadyTimeoutMs({ DURATION_SIDECAR_READY_MS: '60000' })).toBe(60_000);
  });

  it('treats 2xx and 3xx as ready (Kolibri 302)', () => {
    expect(isSidecarHttpReadyStatus(200)).toBe(true);
    expect(isSidecarHttpReadyStatus(302)).toBe(true);
    expect(isSidecarHttpReadyStatus(404)).toBe(false);
    expect(isSidecarHttpReadyStatus(500)).toBe(false);
  });

  it('resolveSidecarUrl still prefers DURATION_KOLIBRI_URL', () => {
    expect(
      resolveSidecarUrl('kolibri', 'http://idea01.local:8080/', {
        DURATION_KOLIBRI_URL: 'http://idea01.local:18080',
      }),
    ).toBe('http://idea01.local:18080');
  });
});
