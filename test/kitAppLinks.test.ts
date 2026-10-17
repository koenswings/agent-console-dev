/**
 * fix/kit-app-links — App Open links on the school kit LAN: three Engines
 * (kind-panda 10.42.0.127, happy-zebra 10.42.0.3, sunny-robin 10.42.0.4)
 * sharing one store. Every Open link goes through buildAppUrl (appUrl.ts):
 *   1. page Engine (name, page IP == lanAddress, or page engineId) → page host
 *   2. other Engines → their lanAddress
 *   3. `<hostname>.local` only as the last fallback
 *   4. always the instance port; no usable port → null (button disabled)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildAppUrl, isConnectedEngine, validAppPort, type AppHostContext } from '../src/store/appUrl';
import {
  pageEngineId, resetConnectedEngine, setConnectedEngineHost, setServedEngineId,
} from '../src/store/connectedEngine';
import { KIT, KIT_APP, KIT_IP, KIT_NAME, kitStore } from './fixtures/kitStore';

const ENGINES = [KIT.KP, KIT.HZ, KIT.SR];

const ctx = (pageHostname: string, pageEngineId: string | null = null): AppHostContext => ({
  pageHostname, productionWebMode: true, engineCount: 3, pageEngineId,
});

/** Open URL for the app on `engineId` in the kit store. */
const urlFor = (engineId: string, c: AppHostContext, withLan: boolean): string | null => {
  const s = kitStore({ withLan });
  const inst = s.instanceDB[KIT_APP[engineId].inst];
  return buildAppUrl(s.engineDB[engineId], inst.port, c);
};

beforeEach(() => resetConnectedEngine());

describe('kit: page opened by IP 10.42.0.127 (kind-panda)', () => {
  it('Engines publish lanAddress: page Engine by IP match, others by their IP', () => {
    const c = ctx('10.42.0.127');
    expect(urlFor(KIT.KP, c, true)).toBe('http://10.42.0.127:8080');
    expect(urlFor(KIT.HZ, c, true)).toBe('http://10.42.0.3:8081');
    expect(urlFor(KIT.SR, c, true)).toBe('http://10.42.0.4:8082');
  });

  it('no lanAddress, page engineId from /api/store-url: page Engine keeps the page IP', () => {
    const c = ctx('10.42.0.127', KIT.KP);
    expect(urlFor(KIT.KP, c, false)).toBe('http://10.42.0.127:8080');
    expect(urlFor(KIT.HZ, c, false)).toBe('http://happy-zebra.local:8081');
    expect(urlFor(KIT.SR, c, false)).toBe('http://sunny-robin.local:8082');
  });

  it('root cause on main: IP page with 3 engines, no id, no lanAddress → only .local remains', () => {
    // Nothing identifies the page Engine: .local is the last fallback (still with the port).
    expect(urlFor(KIT.KP, ctx('10.42.0.127'), false)).toBe('http://kind-panda.local:8080');
  });

  it('page engineId of another Engine never claims kind-panda for the page IP', () => {
    const s = kitStore({ withLan: false });
    expect(isConnectedEngine(s.engineDB[KIT.KP], ctx('10.42.0.127', KIT.HZ))).toBe(false);
    expect(isConnectedEngine(s.engineDB[KIT.HZ], ctx('10.42.0.127', KIT.HZ))).toBe(true);
  });
});

describe('kit: page opened by kind-panda.local', () => {
  it('live kit (no lanAddress, mDNS works): page Engine and others keep .local with their ports', () => {
    const c = ctx('kind-panda.local');
    expect(urlFor(KIT.KP, c, false)).toBe('http://kind-panda.local:8080');
    expect(urlFor(KIT.HZ, c, false)).toBe('http://happy-zebra.local:8081');
    expect(urlFor(KIT.SR, c, false)).toBe('http://sunny-robin.local:8082');
  });

  it('with lanAddress: page Engine keeps the page host, others use their IP', () => {
    const c = ctx('kind-panda.local');
    expect(urlFor(KIT.KP, c, true)).toBe('http://kind-panda.local:8080');
    expect(urlFor(KIT.HZ, c, true)).toBe('http://10.42.0.3:8081');
    expect(urlFor(KIT.SR, c, true)).toBe('http://10.42.0.4:8082');
  });
});

describe('kit: page opened by bare name kind-panda', () => {
  it('no lanAddress: page Engine uses the bare page host, others .local', () => {
    const c = ctx('kind-panda');
    expect(urlFor(KIT.KP, c, false)).toBe('http://kind-panda:8080');
    expect(urlFor(KIT.HZ, c, false)).toBe('http://happy-zebra.local:8081');
    expect(urlFor(KIT.SR, c, false)).toBe('http://sunny-robin.local:8082');
  });

  it('with lanAddress: others use their IP', () => {
    const c = ctx('kind-panda');
    expect(urlFor(KIT.KP, c, true)).toBe('http://kind-panda:8080');
    expect(urlFor(KIT.HZ, c, true)).toBe('http://10.42.0.3:8081');
    expect(urlFor(KIT.SR, c, true)).toBe('http://10.42.0.4:8082');
  });
});

describe('kit: page opened on each Engine by IP (with lanAddress) — that Engine keeps the page IP', () => {
  for (const page of ENGINES) {
    it(`page ${KIT_IP[page]} (${KIT_NAME[page]})`, () => {
      for (const e of ENGINES) {
        expect(urlFor(e, ctx(KIT_IP[page]), true)).toBe(`http://${KIT_IP[e]}:${KIT_APP[e].port}`);
      }
    });
  }
});

describe('missing lanAddress on one Engine only', () => {
  it('that Engine falls back to .local; the others keep their IP', () => {
    const s = kitStore({ withLan: true });
    delete (s.engineDB[KIT.SR] as { lanAddress?: string | null }).lanAddress;
    const c = ctx('10.42.0.127');
    expect(buildAppUrl(s.engineDB[KIT.SR], 8082, c)).toBe('http://sunny-robin.local:8082');
    expect(buildAppUrl(s.engineDB[KIT.HZ], 8081, c)).toBe('http://10.42.0.3:8081');
    expect(buildAppUrl(s.engineDB[KIT.KP], 8080, c)).toBe('http://10.42.0.127:8080');
  });
});

describe('port: always present, never undefined / 0', () => {
  const eng = kitStore({ withLan: true }).engineDB[KIT.HZ];
  it.each([undefined, null, 0, -1, 70000, NaN, 8080.5, '', 'abc', '80a', {}])('port %s → null', (p) => {
    expect(buildAppUrl(eng, p, ctx('10.42.0.127'))).toBeNull();
    expect(validAppPort(p)).toBeNull();
  });
  it('numeric string port from the store is accepted', () => {
    expect(buildAppUrl(eng, '8081', ctx('10.42.0.127'))).toBe('http://10.42.0.3:8081');
  });
  it('no engine / no host → null', () => {
    expect(buildAppUrl(undefined, 8080, ctx('kind-panda'))).toBeNull();
    expect(buildAppUrl({ hostname: '' }, 8080, ctx('kind-panda'))).toBeNull();
  });
  it('every URL built for the kit carries the port', () => {
    for (const page of ['10.42.0.127', 'kind-panda.local', 'kind-panda']) {
      for (const withLan of [true, false]) {
        for (const e of ENGINES) {
          expect(urlFor(e, ctx(page, KIT.KP), withLan)).toMatch(/^http:\/\/[^/]+:\d+$/);
        }
      }
    }
  });
});

describe('pageEngineId (connectedEngine.ts): the page Engine from /api/store-url', () => {
  const s = kitStore();
  it('connected to the page host → the engineId it reported', () => {
    setConnectedEngineHost('10.42.0.127');
    setServedEngineId(KIT.KP);
    expect(pageEngineId(s, '10.42.0.127')).toBe(KIT.KP);
  });
  it('connected to another (picked) Engine → null, page Engine stays unknown', () => {
    setConnectedEngineHost('happy-zebra.local');
    setServedEngineId(KIT.HZ);
    expect(pageEngineId(s, '10.42.0.127')).toBeNull();
  });
  it('unknown engineId (not in the store) → null', () => {
    setConnectedEngineHost('10.42.0.127');
    setServedEngineId('not-in-store');
    expect(pageEngineId(s, '10.42.0.127')).toBeNull();
  });
});
