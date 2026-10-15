// @vitest-environment-options {"url":"http://idea.local/"}
/**
 * The real App.tsx failover effect (idea#203) with the serving host going down.
 * Mocked: the Engine connection (signals we drive), the network probe and the
 * navigation call. Real: App, its effects, prodFailover.decideFailover.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import type { Store } from '../src/types/store';
import { MOCK_STORE } from '../src/mock/mockStore';

const h = vi.hoisted(() => ({
  conns: [] as Array<{ setStore: (s: unknown) => void; setConnected: (b: boolean) => void }>,
  probe: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('../src/store/engine', async (orig) => {
  const mod = await orig<typeof import('../src/store/engine')>();
  const { createSignal: cs } = await import('solid-js');
  return {
    ...mod,
    isProductionWebMode: () => true,
    createEngineConnection: vi.fn(async () => {
      const [store, setStore] = cs<unknown>(null);
      const [connected, setConnected] = cs(false);
      h.conns.push({ setStore, setConnected });
      return {
        store, connected, sendCommand: vi.fn(), changeDoc: vi.fn(),
        commandLogStore: () => ({ traces: {}, recentTraceIds: [] }), dispose: vi.fn(), hostname: 'idea.local',
      };
    }),
  };
});
vi.mock('../src/store/discovery', async (orig) => {
  const mod = await orig<typeof import('../src/store/discovery')>();
  return { ...mod, probeHost: h.probe, defaultEnginePort: () => 80 };
});
vi.mock('../src/store/prodFailover', async (orig) => {
  const mod = await orig<typeof import('../src/store/prodFailover')>();
  return { ...mod, navigateTo: h.navigate };
});

import App from '../src/App';
import { setServedEngineId, resetConnectedEngine } from '../src/store/connectedEngine';

const fleet = (): Store => {
  const s = structuredClone(MOCK_STORE) as Store;
  const ids = Object.keys(s.engineDB);
  s.engineDB[ids[0]] = { ...s.engineDB[ids[0]], hostname: 'brave-otter', lanAddress: '10.42.0.2' };
  s.engineDB[ids[1]] = { ...s.engineDB[ids[1]], hostname: 'calm-heron', lanAddress: '10.42.0.3' };
  return s;
};
const ok = (hostname: string) => ({ hostname, storeUrl: 'automerge:x' });
const flush = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };

const bootConnected = async () => {
  const r = render(() => <App />);
  await flush(10);
  expect(h.conns.length).toBe(1);
  h.conns[0].setStore(fleet());
  h.conns[0].setConnected(true);
  await flush(10);
  return r;
};

beforeEach(() => {
  vi.useFakeTimers();
  h.conns.length = 0;
  h.probe.mockReset();
  h.navigate.mockReset();
  resetConnectedEngine();
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('App failover effect (production web, idea.local page)', () => {
  it('page host gone: after 30 s probes the other Engines from the last store and opens the first live one', async () => {
    h.probe.mockImplementation(async (host: string) => (host === 'calm-heron.local' ? ok(host) : null));
    await bootConnected();
    h.conns[0].setConnected(false); // WS dropped
    await flush(29_000);
    expect(h.probe).not.toHaveBeenCalled(); // waits the full delay
    await flush(1_500);
    expect(h.probe.mock.calls[0][0]).toBe('idea.local'); // page host first
    const probed = h.probe.mock.calls.map((c) => c[0]);
    expect(probed).toEqual(expect.arrayContaining(['brave-otter.local', 'calm-heron.local', '10.42.0.2', '10.42.0.3']));
    expect(h.navigate).toHaveBeenCalledTimes(1);
    expect(h.navigate).toHaveBeenCalledWith('http://calm-heron.local/');
  });

  it('page host answers again (new idea.local holder): reconnects in place, no navigation', async () => {
    h.probe.mockImplementation(async (host: string) => (host === 'idea.local' ? ok(host) : null));
    await bootConnected();
    h.conns[0].setConnected(false);
    await flush(31_000);
    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.conns.length).toBe(2); // a fresh connection was opened
    expect(h.probe).toHaveBeenCalledTimes(1);
  });

  it('nobody answers: keeps retrying every 30 s, never navigates', async () => {
    h.probe.mockResolvedValue(null);
    await bootConnected();
    h.conns[0].setConnected(false);
    await flush(31_000);
    const first = h.probe.mock.calls.length;
    expect(first).toBeGreaterThan(1);
    await flush(30_000);
    expect(h.probe.mock.calls.length).toBe(first * 2);
    await flush(30_000);
    expect(h.probe.mock.calls.length).toBe(first * 3);
    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.conns.length).toBe(1);
  });

  it('a short drop that recovers before 30 s does nothing', async () => {
    h.probe.mockResolvedValue(null);
    await bootConnected();
    h.conns[0].setConnected(false);
    await flush(10_000);
    h.conns[0].setConnected(true);
    await flush(60_000);
    expect(h.probe).not.toHaveBeenCalled();
    expect(h.navigate).not.toHaveBeenCalled();
  });
});

describe('Status bar name behind idea.local', () => {
  const label = (c: HTMLElement) => c.querySelector('[data-testid="status-bar-hostname"]')?.textContent;

  it('falls back to the page host when nothing tells which Engine it is', async () => {
    const { container } = await bootConnected();
    expect(label(container)).toBe('idea');
  });

  it('shows the real Engine name once the host reported its engineId', async () => {
    const { container } = await bootConnected();
    const id = Object.keys(fleet().engineDB)[1];
    setServedEngineId(id);
    await flush(10);
    expect(label(container)).toBe('calm-heron');
  });
});
