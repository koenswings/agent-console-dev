/**
 * Path B sidecar URL helpers (idea#168 / Kid App#10).
 */
import { describe, it, expect } from 'vitest';
import {
  resolveSidecarUrl,
  sidecarPort,
  SIDECAR_DEFAULT_PORTS,
  appKindForInstance,
  APP_TAB_URL_RE,
} from '../e2e/intents/sidecarUrls';

describe('sidecarUrls (App-open Path B)', () => {
  it('defaults Kolibri 18080 and Nextcloud 18280', () => {
    expect(SIDECAR_DEFAULT_PORTS.kolibri).toBe(18080);
    expect(SIDECAR_DEFAULT_PORTS.nextcloud).toBe(18280);
    expect(sidecarPort('kolibri', {})).toBe(18080);
    expect(sidecarPort('nextcloud', {})).toBe(18280);
  });

  it('DURATION_*_PORT overrides default port', () => {
    expect(sidecarPort('kolibri', { DURATION_KOLIBRI_PORT: '18081' })).toBe(18081);
    expect(sidecarPort('nextcloud', { DURATION_NEXTCLOUD_PORT: '18281' })).toBe(18281);
  });

  it('builds sidecar URL from Console origin hostname', () => {
    expect(resolveSidecarUrl('kolibri', 'http://idea01/', {})).toBe('http://idea01:18080');
    expect(resolveSidecarUrl('nextcloud', 'http://idea03:80/console', {})).toBe(
      'http://idea03:18280',
    );
    expect(
      resolveSidecarUrl('kolibri', 'http://idea03/', { DURATION_KOLIBRI_PORT: '18081' }),
    ).toBe('http://idea03:18081');
  });

  it('DURATION_*_URL wins over port/host derivation', () => {
    expect(
      resolveSidecarUrl('kolibri', 'http://idea01/', {
        DURATION_KOLIBRI_URL: 'http://idea01:18081/',
      }),
    ).toBe('http://idea01:18081');
    expect(
      resolveSidecarUrl('nextcloud', 'http://idea01/', {
        DURATION_NEXTCLOUD_URL: 'https://nc.example:9443',
      }),
    ).toBe('https://nc.example:9443');
  });

  it('appKindForInstance maps fixture ids', () => {
    expect(appKindForInstance('kolibri-grade5a-001')).toBe('kolibri');
    expect(appKindForInstance('nextcloud-grade5a-001')).toBe('nextcloud');
  });

  it('APP_TAB_URL_RE matches sidecar ports and app paths', () => {
    expect(APP_TAB_URL_RE.test('http://idea01:18080/')).toBe(true);
    expect(APP_TAB_URL_RE.test('http://idea03:18081/learn/#/')).toBe(true);
    expect(APP_TAB_URL_RE.test('http://idea01:18280/apps/files/')).toBe(true);
    expect(APP_TAB_URL_RE.test('http://idea01/')).toBe(false);
  });
});
