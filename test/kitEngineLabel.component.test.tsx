// @vitest-environment-options {"url":"http://kind-panda.local/"}
/**
 * fix/kit-app-links follow-up: with three Engines the App cards looked
 * identical. AppCard (AppBrowser grid) and the MobileAppList card show the
 * Engine name small: "on kind-panda" (hostname without .local). Also covers an
 * explicit lanAddress null (agent-engine-dev#166) in the rendered hrefs.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSignal } from 'solid-js';
import { render, cleanup, screen } from '@solidjs/testing-library';
import MobileAppList from '../src/components/MobileAppList';
import AppBrowser from '../src/components/AppBrowser';
import AppCard from '../src/components/AppCard';
import { engineDisplayName } from '../src/store/appUrl';
import { resetConnectedEngine, setConnectedEngineHost, setServedEngineId } from '../src/store/connectedEngine';
import { KIT, KIT_APP, KIT_NAME, kitStore } from './fixtures/kitStore';

vi.mock('../src/store/engine', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/store/engine')>();
  return { ...mod, isProductionWebMode: () => true };
});

const ENGINES = [KIT.KP, KIT.HZ, KIT.SR];
afterEach(() => { cleanup(); resetConnectedEngine(); });

describe('engineDisplayName', () => {
  it('strips .local, keeps bare names', () => {
    expect(engineDisplayName('kind-panda.local')).toBe('kind-panda');
    expect(engineDisplayName('KIND-PANDA.LOCAL.')).toBe('KIND-PANDA');
    expect(engineDisplayName('happy-zebra')).toBe('happy-zebra');
    expect(engineDisplayName(undefined)).toBe('');
  });
});

describe('AppBrowser grid: Engine label per card', () => {
  it('each card says "on <engine>" and carries the engine data attributes', () => {
    const store = kitStore();
    render(() => <AppBrowser store={() => store} connected={() => true} />);
    for (const e of ENGINES) {
      const inst = KIT_APP[e].inst;
      expect(screen.getByTestId(`app-engine-${inst}`)).toHaveTextContent(`on ${KIT_NAME[e]}`);
      const card = screen.getByTestId(`instance-${inst}`);
      expect(card).toHaveAttribute('data-engine-id', e);
      expect(card).toHaveAttribute('data-engine-hostname', KIT_NAME[e]);
    }
  });

  it('a .local hostname in the store is shown without .local', () => {
    const store = kitStore();
    store.engineDB[KIT.HZ].hostname = 'happy-zebra.local';
    render(() => <AppBrowser store={() => store} connected={() => true} />);
    expect(screen.getByTestId(`app-engine-${KIT_APP[KIT.HZ].inst}`).textContent?.trim()).toBe('on happy-zebra');
  });

  it('label follows a hostname change (derived accessor, same card)', () => {
    const [store, setStore] = createSignal(kitStore());
    render(() => (
      <AppCard
        instance={() => store().instanceDB[KIT_APP[KIT.KP].inst]}
        app={() => undefined}
        appUrl={() => null}
        engine={() => store().engineDB[KIT.KP]}
      />
    ));
    const card = screen.getByTestId(`instance-${KIT_APP[KIT.KP].inst}`);
    expect(screen.getByTestId(`app-engine-${KIT_APP[KIT.KP].inst}`)).toHaveTextContent('on kind-panda');
    const next = kitStore();
    next.engineDB[KIT.KP].hostname = 'brave-otter';
    setStore(next);
    expect(screen.getByTestId(`instance-${KIT_APP[KIT.KP].inst}`)).toBe(card);
    expect(screen.getByTestId(`app-engine-${KIT_APP[KIT.KP].inst}`)).toHaveTextContent('on brave-otter');
  });

  it('no engine known → no label', () => {
    const store = kitStore();
    const inst = store.instanceDB[KIT_APP[KIT.KP].inst];
    render(() => <AppCard instance={() => inst} app={() => undefined} appUrl={() => null} />);
    expect(screen.queryByTestId(`app-engine-${inst.id}`)).toBeNull();
  });
});

describe('MobileAppList card: Engine label', () => {
  it('each card says "on <engine>" next to the app name', () => {
    const store = kitStore();
    render(() => <MobileAppList store={() => store} />);
    for (const e of ENGINES) {
      const inst = KIT_APP[e].inst;
      const label = screen.getByTestId(`mobile-app-engine-${inst}`);
      expect(label).toHaveTextContent(`on ${KIT_NAME[e]}`);
      expect(label.closest('.mobile-app-card')).toHaveAttribute('data-engine-id', e);
    }
  });
});

describe('explicit lanAddress null (agent-engine-dev#166) in rendered hrefs', () => {
  it('MobileAppList: IP for an Engine with an IP, .local for null', () => {
    setConnectedEngineHost('kind-panda.local');
    setServedEngineId(KIT.KP);
    const store = kitStore({ withLan: true });
    store.engineDB[KIT.SR].lanAddress = null;
    render(() => <MobileAppList store={() => store} />);
    const href = (e: string) =>
      document.querySelector(`[data-testid="mobile-open-instance-${KIT_APP[e].inst}"]`)?.getAttribute('href');
    expect(href(KIT.KP)).toBe('http://kind-panda.local:8080');
    expect(href(KIT.HZ)).toBe('http://10.42.0.3:8081');
    expect(href(KIT.SR)).toBe('http://sunny-robin.local:8082');
  });
});
