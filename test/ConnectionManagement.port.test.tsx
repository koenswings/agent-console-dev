/**
 * idea#100 — manual `host:port` entry passes the port on to onDiscoverySelect,
 * so App.tsx can persist it; a plain hostname passes no port.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import ConnectionManagement from '../src/components/ConnectionManagement';
import type { DiscoveryResult } from '../src/store/discovery';

const STORE_URL = 'automerge:store123';

/** Only `http://<reachable>/api/store-url` answers; every other probe fails. */
function stubFetch(reachable: string) {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === `http://${reachable}/api/store-url`) {
      return new Response(JSON.stringify({ url: STORE_URL }), { status: 200 });
    }
    throw new Error('unreachable');
  }));
}

async function enterManually(value: string, onSelect: (r: DiscoveryResult) => void) {
  render(() => <ConnectionManagement onComplete={() => undefined} onDiscoverySelect={onSelect} />);
  fireEvent.click(await screen.findByText(/Enter hostname manually/));
  const input = screen.getByPlaceholderText(/host:8080/);
  fireEvent.input(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ConnectionManagement manual host:port', () => {
  it('keeps the entered port on the selected result', async () => {
    stubFetch('idea02:8080');
    const onSelect = vi.fn();
    await enterManually('idea02:8080', onSelect);
    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(onSelect.mock.calls[0][0]).toEqual({ hostname: 'idea02', storeUrl: STORE_URL, port: 8080 });
  });

  it('plain hostname yields no port', async () => {
    stubFetch('192.168.1.10:80');
    const onSelect = vi.fn();
    await enterManually('192.168.1.10', onSelect);
    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(onSelect.mock.calls[0][0]).toEqual({ hostname: '192.168.1.10', storeUrl: STORE_URL });
  });
});
