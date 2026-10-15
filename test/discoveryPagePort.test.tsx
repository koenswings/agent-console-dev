/**
 * r86m FAIL@127: the pool Engines serve the Console and /api/store-url on
 * :8080, but discovery and bare-name manual connect probed port 80, so every
 * probe was refused. Probes now default to the page's own port (80 fallback).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const pagePort = vi.hoisted(() => ({ value: 80 }));

vi.mock('../src/store/discovery', async (orig) => {
  const mod = await orig<typeof import('../src/store/discovery')>();
  return { ...mod, defaultEnginePort: () => pagePort.value };
});

import { parseHostPort } from '../src/components/ConnectionManagement';
import {
  enginePortFromLocation,
  defaultEnginePort,
  probeHost,
} from '../src/store/discovery';

const STORE_URL = 'automerge:store123';

function stubFetch(reachable: string[]) {
  const fn = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (reachable.some((r) => url === `http://${r}/api/store-url`)) {
      return new Response(JSON.stringify({ url: STORE_URL }), { status: 200 });
    }
    throw new Error('ECONNREFUSED');
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => { pagePort.value = 80; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('enginePortFromLocation', () => {
  it('uses the page port when explicit', () => {
    expect(enginePortFromLocation({ protocol: 'http:', port: '8080' })).toBe(8080);
  });
  it('falls back to 80 without an explicit port', () => {
    expect(enginePortFromLocation({ protocol: 'http:', port: '' })).toBe(80);
    expect(enginePortFromLocation({ protocol: 'https:', port: '' })).toBe(80);
  });
  it('falls back to 80 for extension pages, invalid ports and no location', () => {
    expect(enginePortFromLocation({ protocol: 'chrome-extension:', port: '' })).toBe(80);
    expect(enginePortFromLocation({ protocol: 'http:', port: 'abc' })).toBe(80);
    expect(enginePortFromLocation(null)).toBe(80);
  });
  it('mock wiring sanity: defaultEnginePort follows the mocked page port', () => {
    pagePort.value = 8080;
    expect(defaultEnginePort()).toBe(8080);
  });
});

describe('probeHost port', () => {
  it('probes host:port and reports the non-default port', async () => {
    const f = stubFetch(['idea01:8080']);
    expect(await probeHost('idea01', 8080)).toEqual({ hostname: 'idea01', storeUrl: STORE_URL, port: 8080 });
    expect(String(f.mock.calls[0][0])).toBe('http://idea01:8080/api/store-url');
  });
  it('port 80 keeps the bare URL and no port field', async () => {
    stubFetch(['idea01']);
    expect(await probeHost('idea01', 80)).toEqual({ hostname: 'idea01', storeUrl: STORE_URL });
  });
});

describe('parseHostPort default', () => {
  it('defaults to the page port, explicit :port wins', () => {
    pagePort.value = 8080;
    expect(parseHostPort('idea03')).toEqual({ host: 'idea03', port: 8080 });
    expect(parseHostPort('idea03:9000')).toEqual({ host: 'idea03', port: 9000 });
    expect(parseHostPort('idea03:80')).toEqual({ host: 'idea03', port: 80 });
  });
  it('defaults to 80 when the page has no port', () => {
    expect(parseHostPort('idea03')).toEqual({ host: 'idea03', port: 80 });
  });
});

