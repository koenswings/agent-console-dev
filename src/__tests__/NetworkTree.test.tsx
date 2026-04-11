import { describe, it, expect } from 'vitest';
import { render } from '@solidjs/testing-library';
import NetworkTree from '../components/NetworkTree';
import { MOCK_STORE, MOCK_IDS } from '../mock/mockStore';
import type { Selection } from '../components/NetworkTree';

const defaultSelection: Selection = { type: 'network', id: '' };

describe('NetworkTree component', () => {
  it('renders without throwing', () => {
    expect(() =>
      render(() => (
        <NetworkTree
          store={() => MOCK_STORE}
          selection={defaultSelection}
          onSelect={() => {}}
        />
      ))
    ).not.toThrow();
  });

  it('shows an "All instances" item at the top', () => {
    const { container } = render(() => (
      <NetworkTree
        store={() => MOCK_STORE}
        selection={defaultSelection}
        onSelect={() => {}}
      />
    ));
    expect(container.textContent).toContain('All instances');
  });

  it('renders both engines from the mock store', () => {
    const { container } = render(() => (
      <NetworkTree
        store={() => MOCK_STORE}
        selection={defaultSelection}
        onSelect={() => {}}
      />
    ));
    expect(container.textContent).toContain('appdocker01');
    expect(container.textContent).toContain('appdocker02');
  });

  it('renders the correct number of engine nodes (2)', () => {
    const { container } = render(() => (
      <NetworkTree
        store={() => MOCK_STORE}
        selection={defaultSelection}
        onSelect={() => {}}
      />
    ));
    const engineItems = container.querySelectorAll('.tree-item--engine');
    expect(engineItems).toHaveLength(2);
  });

  it('renders all 4 disks as sub-nodes', () => {
    const { container } = render(() => (
      <NetworkTree
        store={() => MOCK_STORE}
        selection={defaultSelection}
        onSelect={() => {}}
      />
    ));
    const diskItems = container.querySelectorAll('.tree-item--disk');
    expect(diskItems).toHaveLength(4);
  });

  it('shows disk names', () => {
    const { container } = render(() => (
      <NetworkTree
        store={() => MOCK_STORE}
        selection={defaultSelection}
        onSelect={() => {}}
      />
    ));
    expect(container.textContent).toContain('kolibri-disk');
    expect(container.textContent).toContain('nextcloud-disk');
    expect(container.textContent).toContain('wikipedia-disk');
    expect(container.textContent).toContain('backup-disk');
  });

  it('shows online badges for online engines', () => {
    const { container } = render(() => (
      <NetworkTree
        store={() => MOCK_STORE}
        selection={defaultSelection}
        onSelect={() => {}}
      />
    ));
    const onlineBadges = container.querySelectorAll('.tree-item__badge--online');
    // Both mock engines are online (lastRun within 2 minutes)
    expect(onlineBadges.length).toBeGreaterThanOrEqual(2);
  });

  it('applies selected class to the network item when type is network', () => {
    const { container } = render(() => (
      <NetworkTree
        store={() => MOCK_STORE}
        selection={{ type: 'network', id: '' }}
        onSelect={() => {}}
      />
    ));
    const networkItem = container.querySelector('.tree-item--network');
    expect(networkItem).toHaveClass('tree-item--selected');
  });

  it('applies selected class to an engine item when that engine is selected', () => {
    const { container } = render(() => (
      <NetworkTree
        store={() => MOCK_STORE}
        selection={{ type: 'engine', id: MOCK_IDS.ENGINE_1_ID }}
        onSelect={() => {}}
      />
    ));
    const engineItems = container.querySelectorAll('.tree-item--engine');
    const selected = Array.from(engineItems).find((el) =>
      el.classList.contains('tree-item--selected')
    );
    expect(selected).toBeTruthy();
  });

  it('calls onSelect when an engine is clicked', () => {
    const calls: Selection[] = [];
    const { container } = render(() => (
      <NetworkTree
        store={() => MOCK_STORE}
        selection={defaultSelection}
        onSelect={(s) => calls.push(s)}
      />
    ));
    const firstEngine = container.querySelector('.tree-item--engine') as HTMLElement;
    firstEngine?.click();
    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe('engine');
  });

  it('calls onSelect when a disk is clicked', () => {
    const calls: Selection[] = [];
    const { container } = render(() => (
      <NetworkTree
        store={() => MOCK_STORE}
        selection={defaultSelection}
        onSelect={(s) => calls.push(s)}
      />
    ));
    const firstDisk = container.querySelector('.tree-item--disk') as HTMLElement;
    firstDisk?.click();
    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe('disk');
  });

  it('renders without store (null)', () => {
    const { container } = render(() => (
      <NetworkTree
        store={() => null}
        selection={defaultSelection}
        onSelect={() => {}}
      />
    ));
    expect(container.textContent).toContain('All instances');
    expect(container.querySelectorAll('.tree-item--engine')).toHaveLength(0);
  });
});
