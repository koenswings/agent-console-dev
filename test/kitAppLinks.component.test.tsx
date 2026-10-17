// @vitest-environment-options {"url":"http://10.42.0.127/"}
/**
 * fix/kit-app-links — component hrefs on the school kit LAN, Console opened by
 * IP 10.42.0.127 (kind-panda), three Engines, no lanAddress published (live
 * kit), page Engine known from /api/store-url engineId.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import MobileAppList from '../src/components/MobileAppList';
import AppBrowser from '../src/components/AppBrowser';
import AppCard from '../src/components/AppCard';
import InstanceRow from '../src/components/InstanceRow';
import { resetConnectedEngine, setConnectedEngineHost, setServedEngineId } from '../src/store/connectedEngine';
import { KIT, KIT_APP, kitStore } from './fixtures/kitStore';

vi.mock('../src/store/engine', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/store/engine')>();
  return { ...mod, isProductionWebMode: () => true };
});

const EXPECTED_NO_LAN: Record<string, string> = {
  [KIT.KP]: 'http://10.42.0.127:8080',
  [KIT.HZ]: 'http://happy-zebra.local:8081',
  [KIT.SR]: 'http://sunny-robin.local:8082',
};
const EXPECTED_LAN: Record<string, string> = {
  [KIT.KP]: 'http://10.42.0.127:8080',
  [KIT.HZ]: 'http://10.42.0.3:8081',
  [KIT.SR]: 'http://10.42.0.4:8082',
};

beforeEach(() => {
  resetConnectedEngine();
  setConnectedEngineHost('10.42.0.127');
  setServedEngineId(KIT.KP);
});
afterEach(() => { cleanup(); resetConnectedEngine(); });

describe('MobileAppList Open hrefs (was `http://${hostname}:${port}`, bare name)', () => {
  it('no lanAddress: page Engine → page IP, others → .local, all with port', () => {
    expect(window.location.hostname).toBe('10.42.0.127');
    const store = kitStore();
    render(() => <MobileAppList store={() => store} />);
    for (const e of [KIT.KP, KIT.HZ, KIT.SR]) {
      const a = document.querySelector(`[data-testid="mobile-open-instance-${KIT_APP[e].inst}"]`);
      expect(a?.tagName).toBe('A');
      expect(a).toHaveAttribute('href', EXPECTED_NO_LAN[e]);
    }
  });

  it('with lanAddress: others → their LAN IP', () => {
    const store = kitStore({ withLan: true });
    render(() => <MobileAppList store={() => store} />);
    for (const e of [KIT.KP, KIT.HZ, KIT.SR]) {
      expect(document.querySelector(`[data-testid="mobile-open-instance-${KIT_APP[e].inst}"]`))
        .toHaveAttribute('href', EXPECTED_LAN[e]);
    }
  });

  it('missing port → disabled button, no href', () => {
    const store = kitStore({ ports: { [KIT.HZ]: undefined } });
    render(() => <MobileAppList store={() => store} />);
    const btn = document.querySelector(`[data-testid="mobile-open-instance-${KIT_APP[KIT.HZ].inst}"]`);
    expect(btn?.tagName).toBe('BUTTON');
    expect(btn).toBeDisabled();
    expect(btn).not.toHaveAttribute('href');
    expect(document.body.innerHTML).not.toContain('undefined');
  });
});

describe('AppBrowser / AppCard Open URLs', () => {
  it('each card opens its Engine with the page-host/IP-first rule', () => {
    const store = kitStore();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(() => <AppBrowser store={() => store} connected={() => true} />);
    for (const e of [KIT.KP, KIT.HZ, KIT.SR]) {
      const btn = document.querySelector(`[data-testid="open-instance-${KIT_APP[e].inst}"]`) as HTMLElement;
      expect(btn).toHaveAttribute('data-href', EXPECTED_NO_LAN[e]);
      fireEvent.click(btn);
      expect(open).toHaveBeenLastCalledWith(EXPECTED_NO_LAN[e], '_blank', 'noopener,noreferrer');
    }
    open.mockRestore();
  });

  it('port 0 → AppCard Open disabled, window.open never called', () => {
    const store = kitStore({ ports: { [KIT.SR]: 0 } });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(() => <AppBrowser store={() => store} connected={() => true} />);
    const btn = document.querySelector(`[data-testid="open-instance-${KIT_APP[KIT.SR].inst}"]`) as HTMLElement;
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('AppCard with a null url renders a disabled Open', () => {
    const store = kitStore();
    const inst = store.instanceDB[KIT_APP[KIT.KP].inst];
    const { getByRole } = render(() => (
      <AppCard instance={() => inst} app={() => store.appDB[inst.instanceOf]} appUrl={() => null} />
    ));
    expect(getByRole('button', { name: 'Open' })).toBeDisabled();
  });
});

describe('InstanceRow Open href (operator tree)', () => {
  const row = (engineId: string, store = kitStore()) => {
    const id = KIT_APP[engineId].inst;
    const inst = store.instanceDB[id];
    return render(() => (
      <InstanceRow
        instanceId={id}
        instance={() => store.instanceDB[id]}
        app={() => store.appDB[inst.instanceOf]}
        engine={() => store.engineDB[engineId]}
        store={() => store}
      />
    ));
  };
  it('page Engine opened by IP keeps the page IP (no .local)', () => {
    row(KIT.KP);
    expect(document.querySelector(`[data-testid="open-instance-${KIT_APP[KIT.KP].inst}"]`))
      .toHaveAttribute('href', 'http://10.42.0.127:8080');
  });
  it('missing port → disabled Open button', () => {
    row(KIT.HZ, kitStore({ ports: { [KIT.HZ]: undefined } }));
    const btn = document.querySelector(`[data-testid="open-instance-${KIT_APP[KIT.HZ].inst}"]`);
    expect(btn?.tagName).toBe('BUTTON');
    expect(btn).toBeDisabled();
  });
});
