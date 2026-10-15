/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "http://brave-otter.local:8080/"}
 *
 * idea#184: Pis have free two-word sticker names. The Console bootstraps from
 * the ONE host the operator opened (the sticker name) and lists every Engine
 * from the network database. It never guesses idea<N>/engine<N>/appdocker<N>
 * names and never uses a shared alias.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import ConnectionManagement from '../src/components/ConnectionManagement';
import { bootstrapCandidates, discoverAllEngines, enginesFromStore } from '../src/store/discovery';

const STORE = 'automerge:fleet';

function stubFetch(reachable: string[]) {
  const fn = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (reachable.some((r) => url === `http://${r}/api/store-url`)) {
      return new Response(JSON.stringify({ url: STORE }), { status: 200 });
    }
    throw new Error('ECONNREFUSED');
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
const probed = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.map((c) => String(c[0]));

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe('bootstrapCandidates', () => {
  it('uses the page host (sticker name) and history only', () => {
    expect(bootstrapCandidates({ protocol: 'http:', hostname: 'brave-otter.local' }, ['calm-heron']))
      .toEqual(['brave-otter', 'brave-otter.local', 'calm-heron', 'calm-heron.local']);
  });
  it('skips loopback and extension pages; keeps IPs and FQDNs as given', () => {
    expect(bootstrapCandidates({ protocol: 'http:', hostname: 'localhost' }, [])).toEqual([]);
    expect(bootstrapCandidates({ protocol: 'chrome-extension:', hostname: 'abc' }, [])).toEqual([]);
    expect(bootstrapCandidates(null, ['10.0.0.5', 'brave-otter.tail1234.ts.net']))
      .toEqual(['10.0.0.5', 'brave-otter.tail1234.ts.net']);
  });
  it('never generates numbered names or a shared alias', () => {
    const c = bootstrapCandidates({ protocol: 'http:', hostname: 'brave-otter.local' }, []);
    expect(c.some((h) => /\d/.test(h))).toBe(false);
    expect(c).not.toContain('idea.local');
  });
});

describe('discoverAllEngines (page host bootstrap)', () => {
  it('finds the sticker-named Engine the page came from, and probes nothing else', async () => {
    const f = stubFetch(['brave-otter:8080', 'brave-otter.local:8080', 'idea01:8080']);
    const found = await discoverAllEngines([]);
    expect(found.map((r) => r.hostname)).toEqual(['brave-otter']);
    expect(found[0]).toMatchObject({ storeUrl: STORE, port: 8080 });
    for (const u of probed(f)) expect(u).toMatch(/^http:\/\/brave-otter(\.local)?:8080\//);
  });
});

describe('enginesFromStore', () => {
  const store = { engineDB: {
    e2: { id: 'e2', hostname: 'calm-heron' },
    e1: { id: 'e1', hostname: 'brave-otter' },
    e3: { id: 'e3', hostname: 'idea03' },      // legacy names still work
    e4: { id: 'e4', hostname: '' },            // no hostname: skipped
  } };
  it('lists every Engine in the network database, any name, sorted, as name.local', () => {
    const r = enginesFromStore(store, STORE, 8080);
    expect(r.map((x) => x.hostname)).toEqual(['brave-otter.local', 'calm-heron.local', 'idea03.local']);
    expect(r.map((x) => x.engineId)).toEqual(['e1', 'e2', 'e3']);
    expect(r.every((x) => x.port === 8080 && x.storeUrl === STORE)).toBe(true);
  });
  it('uses the published LAN address when asked (Console opened by IP, no mDNS across subnets)', () => {
    const r = enginesFromStore({ engineDB: {
      a: { id: 'a', hostname: 'brave-otter', lanAddress: '10.7.0.2' }, b: { id: 'b', hostname: 'calm-heron' },
    } }, STORE, 80, true);
    expect(r.map((x) => x.hostname)).toEqual(['10.7.0.2', 'calm-heron.local']);
    expect(r.map((x) => x.engineId)).toEqual(['a', 'b']);
  });
  it('empty or missing store -> empty list', () => {
    expect(enginesFromStore(null, STORE)).toEqual([]);
    expect(enginesFromStore({ engineDB: {} }, STORE)).toEqual([]);
  });
});

describe('ConnectionManagement', () => {
  it('shows all Engines from the store without probing guessed names', async () => {
    const f = stubFetch([]);
    const engines = enginesFromStore({ engineDB: {
      a: { id: 'a', hostname: 'brave-otter' }, b: { id: 'b', hostname: 'calm-heron' }, c: { id: 'c', hostname: 'wise-owl' },
    } }, STORE, 8080);
    render(() => <ConnectionManagement onComplete={() => undefined} storeEngines={engines} />);
    await screen.findByTestId('connect-engine-brave-otter');
    expect(screen.getByTestId('connect-engine-calm-heron')).toBeTruthy();
    expect(screen.getByTestId('connect-engine-wise-owl')).toBeTruthy();
    await waitFor(() => expect(f).toHaveBeenCalled());
    for (const u of probed(f)) expect(u).not.toMatch(/(idea|engine|appdocker)\d/);
  });
  it('manual entry of a sticker name probes only that name', async () => {
    const f = stubFetch(['calm-heron:8080']);
    const onSelect = vi.fn();
    render(() => <ConnectionManagement onComplete={() => undefined} onDiscoverySelect={onSelect} />);
    fireEvent.click(await screen.findByText(/Enter hostname manually/));
    const input = screen.getByPlaceholderText(/host:8080/);
    fireEvent.input(input, { target: { value: 'calm-heron' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(onSelect.mock.calls[0][0]).toMatchObject({ hostname: 'calm-heron', storeUrl: STORE, port: 8080 });
    for (const u of probed(f)) expect(u).toMatch(/^http:\/\/(calm-heron|brave-otter)(\.local)?:8080\//);
  });
});
