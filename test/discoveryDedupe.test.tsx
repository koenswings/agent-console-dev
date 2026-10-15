/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "http://idea02:8080/"}
 *
 * r86n FAIL@127: each pool Engine answers on both `ideaNN` and `ideaNN.local`
 * with the same store URL. Discovery must list one row per Engine, so
 * `connect-engine-idea01` is unique.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import ConnectionManagement from '../src/components/ConnectionManagement';
import {
  dedupeEngines, discoverAllEngines, enginesFromStore, type DiscoveryResult,
} from '../src/store/discovery';

const urlFor = (_h: string) => 'automerge:fleet-store';

function stubFetch(engines: string[]) {
  // every engine answers on bare, .local (both :8080)
  const reachable = new Map<string, string>();
  for (const e of engines) {
    reachable.set(`http://${e}:8080/api/store-url`, urlFor(e));
    reachable.set(`http://${e}.local:8080/api/store-url`, urlFor(e));
  }
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const u = reachable.get(String(input));
    if (u) return new Response(JSON.stringify({ url: u }), { status: 200 });
    throw new Error('ECONNREFUSED');
  }));
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('dedupeEngines', () => {
  it('collapses name and name.local, never engines sharing the fleet store URL', () => {
    const F = 'automerge:fleet';
    const r: DiscoveryResult[] = [
      { hostname: 'idea01', storeUrl: F, port: 8080 },
      { hostname: 'idea01.local', storeUrl: F, port: 8080 },
      { hostname: 'IDEA01.local', storeUrl: F, port: 8080 },
      { hostname: 'idea03', storeUrl: F, port: 8080 },
      { hostname: 'idea04.local', storeUrl: F, port: 8080 },
    ];
    expect(dedupeEngines(r).map((x) => x.hostname)).toEqual(['idea01', 'idea03', 'idea04.local']);
  });
  it('uses engineId when reported (name + IP of one engine)', () => {
    const r: DiscoveryResult[] = [
      { hostname: 'idea01', storeUrl: 'automerge:f', engineId: 'e1' },
      { hostname: '10.99.0.11', storeUrl: 'automerge:f', engineId: 'e1' },
      { hostname: 'idea03', storeUrl: 'automerge:f', engineId: 'e3' },
    ];
    expect(dedupeEngines(r).map((x) => x.hostname)).toEqual(['idea01', 'idea03']);
  });
  it('keeps distinct engines and is order-stable', () => {
    const r = [
      { hostname: 'idea04.local', storeUrl: 'automerge:c' },
      { hostname: 'idea04', storeUrl: 'automerge:c' },
      { hostname: 'idea01', storeUrl: 'automerge:a' },
    ];
    expect(dedupeEngines(r).map((x) => x.hostname)).toEqual(['idea04.local', 'idea01']);
    expect(dedupeEngines([])).toEqual([]);
  });
});

describe('discovery with name + .local both answering', () => {
  it('discoverAllEngines returns one entry per engine, bare name preferred', async () => {
    stubFetch(['idea01', 'idea03', 'idea04']);
    // idea#184: no name guessing; the Engines come from history (and the page host)
    const found = await discoverAllEngines(['idea01', 'idea03.local', 'idea04']);
    expect(found.map((r) => r.hostname)).toEqual(['idea01', 'idea03', 'idea04']);
  });
  it('picker renders exactly one connect-engine-idea01 button (Engines from the store)', async () => {
    stubFetch([]);
    const store = { engineDB: {
      e1: { id: 'e1', hostname: 'idea01' }, e3: { id: 'e3', hostname: 'idea03' }, e4: { id: 'e4', hostname: 'idea04' },
    } };
    const fromStore = enginesFromStore(store, 'automerge:fleet-store', 8080);
    render(() => <ConnectionManagement onComplete={() => undefined} onDiscoverySelect={() => undefined} storeEngines={fromStore} />);
    await screen.findByTestId('connect-engine-idea01');
    expect(screen.getAllByTestId('connect-engine-idea01')).toHaveLength(1);
    expect(screen.getAllByTestId(/^connect-engine-idea\d+$/)).toHaveLength(3);
    expect(await screen.findByText('3 engines found')).toBeTruthy();
  });
  it('parent-provided results with .local twins merge into one row', async () => {
    stubFetch([]);
    const parent: DiscoveryResult[] = [
      { hostname: 'idea01', storeUrl: 'automerge:a', port: 8080 },
      { hostname: 'idea01.local', storeUrl: 'automerge:a', port: 8080 },
      { hostname: 'idea03', storeUrl: 'automerge:a', port: 8080 },
    ];
    render(() => <ConnectionManagement onComplete={() => undefined} discoveryResults={parent} />);
    await waitFor(() => expect(screen.getAllByTestId('connect-engine-idea01')).toHaveLength(1));
    expect(screen.getAllByTestId('connect-engine-idea03')).toHaveLength(1);
  });
  it('manual idea01.local still connects after dedupe kept the bare name', async () => {
    stubFetch(['idea01']);
    const onSelect = vi.fn();
    render(() => <ConnectionManagement onComplete={() => undefined} onDiscoverySelect={onSelect} />);
    fireEvent.click(await screen.findByText(/Enter hostname manually/));
    const input = screen.getByPlaceholderText(/host:8080/);
    fireEvent.input(input, { target: { value: 'idea01.local' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(onSelect.mock.calls[0][0].storeUrl).toBe('automerge:fleet-store');
    expect(onSelect.mock.calls[0][0].hostname.replace(/\.local$/, '')).toBe('idea01');
  });
});
