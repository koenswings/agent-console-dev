// @vitest-environment-options {"url":"http://kind-panda.local/"}
/**
 * fix/kit-app-links — live kit as observed 2026-10-17: Console opened by
 * kind-panda.local, mDNS works, Engines publish no lanAddress.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import MobileAppList from '../src/components/MobileAppList';
import AppBrowser from '../src/components/AppBrowser';
import { resetConnectedEngine, setConnectedEngineHost, setServedEngineId } from '../src/store/connectedEngine';
import { KIT, KIT_APP, kitStore } from './fixtures/kitStore';

vi.mock('../src/store/engine', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/store/engine')>();
  return { ...mod, isProductionWebMode: () => true };
});

const EXPECTED: Record<string, string> = {
  [KIT.KP]: 'http://kind-panda.local:8080',
  [KIT.HZ]: 'http://happy-zebra.local:8081',
  [KIT.SR]: 'http://sunny-robin.local:8082',
};

afterEach(() => { cleanup(); resetConnectedEngine(); });

describe.each([
  ['engineId unknown', null],
  ['engineId from /api/store-url', KIT.KP],
])('page kind-panda.local, no lanAddress (%s)', (_label, served) => {
  it('MobileAppList: every Engine → <name>.local:<port> (never bare name)', () => {
    setConnectedEngineHost('kind-panda.local');
    setServedEngineId(served);
    const store = kitStore();
    render(() => <MobileAppList store={() => store} />);
    for (const e of [KIT.KP, KIT.HZ, KIT.SR]) {
      expect(document.querySelector(`[data-testid="mobile-open-instance-${KIT_APP[e].inst}"]`))
        .toHaveAttribute('href', EXPECTED[e]);
    }
  });

  it('AppBrowser: every Engine → <name>.local:<port>', () => {
    setConnectedEngineHost('kind-panda.local');
    setServedEngineId(served);
    const store = kitStore();
    render(() => <AppBrowser store={() => store} connected={() => true} />);
    for (const e of [KIT.KP, KIT.HZ, KIT.SR]) {
      expect(document.querySelector(`[data-testid="open-instance-${KIT_APP[e].inst}"]`))
        .toHaveAttribute('data-href', EXPECTED[e]);
    }
  });
});
