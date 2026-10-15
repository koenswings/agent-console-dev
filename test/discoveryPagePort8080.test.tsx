/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "http://idea02:8080/"}
 *
 * r86m FAIL@127 end to end: the Console page itself is served on :8080 (as on
 * the Pi pool), so discovery and bare-name manual connect must probe :8080.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import ConnectionManagement from '../src/components/ConnectionManagement';
import { defaultEnginePort, discoverAllEngines, type DiscoveryResult } from '../src/store/discovery';

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

afterEach(() => { vi.unstubAllGlobals(); });

describe('Console served on :8080', () => {
  it('defaultEnginePort is the page port', () => {
    expect(window.location.port).toBe('8080');
    expect(defaultEnginePort()).toBe(8080);
  });

  it('discoverAllEngines finds the :8080 pool and never probes bare :80 URLs', async () => {
    const f = stubFetch(['idea01:8080', 'idea03:8080', 'idea04:8080']);
    // idea#184: candidates are the page host (idea02, refused here) + history
    const found = await discoverAllEngines(['idea01', 'idea03', 'idea04']);
    expect(found.map((r) => r.hostname)).toEqual(['idea01', 'idea03', 'idea04']);
    expect(found.every((r) => r.port === 8080)).toBe(true);
    expect(f.mock.calls.every(([u]) => /:8080\/api\/store-url$/.test(String(u)))).toBe(true);
  });

async function enterManually(value: string, onSelect: (r: DiscoveryResult) => void) {
  render(() => <ConnectionManagement onComplete={() => undefined} onDiscoverySelect={onSelect} />);
  fireEvent.click(await screen.findByText(/Enter hostname manually/));
  const input = screen.getByPlaceholderText(/host:8080/);
  fireEvent.input(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

  it('bare name connects on the page port and keeps it', async () => {
    stubFetch(['idea03:8080']);
    const onSelect = vi.fn();
    await enterManually('idea03', onSelect);
    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(onSelect.mock.calls[0][0]).toEqual({ hostname: 'idea03', storeUrl: STORE_URL, port: 8080 });
  });
  it('bare IP connects on the page port', async () => {
    stubFetch(['10.99.0.13:8080']);
    const onSelect = vi.fn();
    await enterManually('10.99.0.13', onSelect);
    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(onSelect.mock.calls[0][0]).toEqual({ hostname: '10.99.0.13', storeUrl: STORE_URL, port: 8080 });
  });
  it('explicit :port still wins over the page port', async () => {
    stubFetch(['10.99.0.13:9000']);
    const onSelect = vi.fn();
    await enterManually('10.99.0.13:9000', onSelect);
    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(onSelect.mock.calls[0][0]).toEqual({ hostname: '10.99.0.13', storeUrl: STORE_URL, port: 9000 });
  });
  it('initial scan finds the :8080 Engine the page was served from (idea#184)', async () => {
    stubFetch(['idea02:8080']);
    render(() => <ConnectionManagement onComplete={() => undefined} onDiscoverySelect={() => undefined} />);
    for (const h of ['idea02']) {
      expect(await screen.findByTestId(`connect-engine-${h}`, {}, { timeout: 8000 })).toBeInTheDocument();
    }
  }, 15000);
});
