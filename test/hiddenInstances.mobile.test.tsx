// @vitest-environment-options {"url":"http://kind-panda.local/"}
/** idea#212: the hide list also filters the mobile app list, and is fetched once. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@solidjs/testing-library';
import MobileAppList from '../src/components/MobileAppList';
import { resetSharedHiddenInstances, sharedHiddenInstances } from '../src/store/hiddenInstances';
import { KIT, KIT_APP, kitStore } from './fixtures/kitStore';

vi.mock('../src/store/engine', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/store/engine')>();
  return { ...mod, isProductionWebMode: () => true };
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetSharedHiddenInstances(); });

describe('MobileAppList hide list (idea#212)', () => {
  it('a hidden instance is absent; the others stay', async () => {
    const store = kitStore();
    const gone = KIT_APP[KIT.HZ].inst;
    render(() => <MobileAppList store={() => store} loadHidden={() => Promise.resolve([gone])} />);
    expect(screen.getByTestId(`mobile-instance-${KIT_APP[KIT.KP].inst}`)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId(`mobile-instance-${gone}`)).not.toBeInTheDocument());
    expect(screen.getByTestId(`mobile-instance-${KIT_APP[KIT.SR].inst}`)).toBeInTheDocument();
  });

  it('a missing hide-list file hides nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })));
    const store = kitStore();
    render(() => <MobileAppList store={() => store} />);
    await sharedHiddenInstances();
    for (const e of [KIT.KP, KIT.HZ, KIT.SR]) {
      expect(screen.getByTestId(`mobile-instance-${KIT_APP[e].inst}`)).toBeInTheDocument();
    }
  });
});

describe('sharedHiddenInstances', () => {
  it('fetches the file once for all lists', async () => {
    const f = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ hidden: ['x'] }) }));
    vi.stubGlobal('fetch', f);
    expect(await sharedHiddenInstances()).toEqual(['x']);
    expect(await sharedHiddenInstances()).toEqual(['x']);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
