import { describe, it, expect } from 'vitest';
import { render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import NetworkTree from '../src/components/NetworkTree';
import { MOCK_STORE } from '../src/mock/mockStore';
import type { Store } from '../src/types/store';

const tree = (store: () => Store | null) =>
  render(() => (
    <NetworkTree
      store={store}
      selection={{ type: 'network', id: '' }}
      onSelect={() => {}}
      dragData={() => null}
      onDrop={() => {}}
    />
  ));

describe('NetworkTree loading state (issue #151)', () => {
  it('a null store shows network-loading, not an empty engine list', () => {
    const { getByTestId, container } = tree(() => null);
    const el = getByTestId('network-loading');
    expect(el.textContent).toContain('Connecting to the network…');
    expect(el.getAttribute('role')).toBe('status');
    expect(container.querySelectorAll('[data-testid^="engine-"]').length).toBe(0);
  });

  it('a loaded store shows the engines and no network-loading', () => {
    const { queryByTestId, container } = tree(() => MOCK_STORE);
    expect(queryByTestId('network-loading')).toBeNull();
    expect(container.querySelectorAll('[data-testid^="engine-"]').length).toBeGreaterThan(0);
    expect(container.textContent).toContain('appdocker01');
  });

  it('switches back to loading when the store is reset to null (reconnect), then to engines', () => {
    const [store, setStore] = createSignal<Store | null>(MOCK_STORE);
    const { queryByTestId } = tree(store);
    expect(queryByTestId('network-loading')).toBeNull();
    setStore(null);
    expect(queryByTestId('network-loading')).not.toBeNull();
    setStore(MOCK_STORE);
    expect(queryByTestId('network-loading')).toBeNull();
  });
});
