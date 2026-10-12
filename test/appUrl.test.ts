import { describe, it, expect } from 'vitest';
import {
  buildAppUrl,
  resolveAppHost,
  isConnectedEngine,
  ensureLocal,
  type AppHostContext,
} from '../src/store/appUrl';

const prod = (pageHostname: string, engineCount = 2): AppHostContext => ({
  pageHostname,
  productionWebMode: true,
  engineCount,
});

describe('ensureLocal', () => {
  it('appends .local to a bare name', () => {
    expect(ensureLocal('idea02')).toBe('idea02.local');
  });
  it('leaves .local names, IPv4 addresses and localhost alone', () => {
    expect(ensureLocal('idea02.local')).toBe('idea02.local');
    expect(ensureLocal('192.168.0.180')).toBe('192.168.0.180');
    expect(ensureLocal('localhost')).toBe('localhost');
    expect(ensureLocal('')).toBe('');
  });
});

describe('buildAppUrl — connected engine (production web mode)', () => {
  it('page opened via idea02.local → idea02.local', () => {
    expect(buildAppUrl('idea02', 8080, prod('idea02.local'))).toBe('http://idea02.local:8080');
  });

  it('page opened via bare idea02 (Tailscale MagicDNS) → idea02', () => {
    expect(buildAppUrl('idea02', 8080, prod('idea02'))).toBe('http://idea02:8080');
  });

  it('page opened via a Tailscale FQDN → that FQDN', () => {
    expect(buildAppUrl('idea02', 8080, prod('idea02.tail1234.ts.net')))
      .toBe('http://idea02.tail1234.ts.net:8080');
  });

  it('matches the engine name case-insensitively', () => {
    expect(buildAppUrl('IDEA02', 8080, prod('idea02'))).toBe('http://idea02:8080');
  });

  it('page opened via an IP with a single engine in the store → that IP', () => {
    expect(buildAppUrl('idea02', 8080, prod('100.64.1.2', 1))).toBe('http://100.64.1.2:8080');
  });

  it('page opened via a bare IPv6 literal with a single engine → bracketed', () => {
    expect(buildAppUrl('idea02', 8080, prod('fd7a::1', 1))).toBe('http://[fd7a::1]:8080');
  });

  it('page opened via an already-bracketed IPv6 host is not double-bracketed', () => {
    expect(buildAppUrl('idea02', 8080, prod('[fd7a::1]', 1))).toBe('http://[fd7a::1]:8080');
  });
});

describe('buildAppUrl — other engines', () => {
  it('another engine on the LAN keeps <hostname>.local', () => {
    expect(buildAppUrl('idea03', 8081, prod('idea02'))).toBe('http://idea03.local:8081');
    expect(buildAppUrl('idea03', 8081, prod('idea02.local'))).toBe('http://idea03.local:8081');
  });

  it('does not treat a name that merely starts with the page host as the same engine', () => {
    expect(buildAppUrl('idea021', 8081, prod('idea02'))).toBe('http://idea021.local:8081');
  });

  it('IP page host with several engines cannot be attributed → .local for all', () => {
    const ctx = prod('100.64.1.2', 2);
    expect(buildAppUrl('idea02', 8080, ctx)).toBe('http://idea02.local:8080');
    expect(buildAppUrl('idea03', 8081, ctx)).toBe('http://idea03.local:8081');
  });

  it('does not double-append .local to an engine hostname that already has it', () => {
    expect(buildAppUrl('idea03.local', 8081, prod('idea02'))).toBe('http://idea03.local:8081');
  });
});

describe('buildAppUrl — dev / extension mode falls back to current behaviour', () => {
  const dev = (pageHostname: string, engineCount = 1): AppHostContext => ({
    pageHostname,
    productionWebMode: false,
    engineCount,
  });

  it('localhost dev server → <hostname>.local', () => {
    expect(buildAppUrl('idea02', 8080, dev('localhost'))).toBe('http://idea02.local:8080');
  });

  it('extension origin → <hostname>.local', () => {
    expect(buildAppUrl('idea02', 8080, dev('abcdefghijklmnop'))).toBe('http://idea02.local:8080');
  });

  it('never uses the page host even when it matches the engine name', () => {
    expect(isConnectedEngine('idea02', dev('idea02'))).toBe(false);
    expect(resolveAppHost('idea02', dev('idea02'))).toBe('idea02.local');
  });
});

// ---------------------------------------------------------------------------
// LAN address from the store (learner devices without mDNS)
// ---------------------------------------------------------------------------
describe('LAN address: never .local only when an IP is available', () => {
  const other = { hostname: 'idea03', lanAddress: '192.0.2.13' };

  it('same Pi: uses the host the Console was loaded from, even when the Engine has an IP', () => {
    expect(buildAppUrl({ hostname: 'idea01', lanAddress: '192.0.2.11' }, 8080, prod('idea01.local')))
      .toBe('http://idea01.local:8080');
    expect(buildAppUrl({ hostname: 'idea01', lanAddress: '192.0.2.11' }, 8080, prod('192.0.2.11', 1)))
      .toBe('http://192.0.2.11:8080');
  });

  it('another Pi: uses its LAN IP from the store', () => {
    expect(buildAppUrl(other, 8081, prod('idea01.local'))).toBe('http://192.0.2.13:8081');
    expect(resolveAppHost(other, prod('idea01'))).toBe('192.0.2.13');
  });

  it('another Pi, Console opened by IP with several engines: still its LAN IP', () => {
    expect(buildAppUrl(other, 8081, prod('192.0.2.11', 3))).toBe('http://192.0.2.13:8081');
  });

  it('dev / extension mode: LAN IP still beats .local', () => {
    const dev: AppHostContext = { pageHostname: 'localhost', productionWebMode: false, engineCount: 2 };
    expect(buildAppUrl(other, 8081, dev)).toBe('http://192.0.2.13:8081');
  });

  it('IPv6 LAN address is bracketed', () => {
    expect(buildAppUrl({ hostname: 'idea03', lanAddress: 'fd00::13' }, 8081, prod('idea01')))
      .toBe('http://[fd00::13]:8081');
  });

  it('no IP in the store (absent, null, empty, not an IP): falls back to .local', () => {
    for (const lanAddress of [undefined, null, '', '  ', 'idea03.lan']) {
      expect(buildAppUrl({ hostname: 'idea03', lanAddress }, 8081, prod('idea01.local')))
        .toBe('http://idea03.local:8081');
    }
    expect(buildAppUrl('idea03', 8081, prod('idea01.local'))).toBe('http://idea03.local:8081');
  });

  it('never .local when an IP is available (sweep of page hosts and modes)', () => {
    for (const page of ['idea01.local', 'idea01', '192.0.2.11', 'localhost']) {
      for (const productionWebMode of [true, false]) {
        const url = buildAppUrl(other, 8081, { pageHostname: page, productionWebMode, engineCount: 3 });
        expect(url).not.toContain('.local');
        expect(url).toBe('http://192.0.2.13:8081');
      }
    }
  });
});
