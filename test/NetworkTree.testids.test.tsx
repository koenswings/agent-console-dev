/**
 * idea#166 — NetworkTree exposes id-keyed data-testid attributes.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import NetworkTree from '../src/components/NetworkTree';
import { MOCK_FILES_STORE, FILES_IDS as I } from '../src/mock/filesFixtures';

afterEach(() => cleanup());

const renderTree = () =>
  render(() => (
    <NetworkTree
      store={() => MOCK_FILES_STORE}
      selection={{ type: 'network', id: '' }}
      onSelect={() => {}}
      dragData={() => null}
      onDrop={() => {}}
    />
  ));

describe('NetworkTree data-testid (idea#166)', () => {
  it('marks the tree, engines and disks by id', () => {
    const { container } = renderTree();
    expect(container.querySelector('[data-testid="network-tree"]')).not.toBeNull();
    expect(container.querySelector(`[data-testid="engine-${I.ENGINE_A}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-testid="disk-${I.FA_APP}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-testid="disk-${I.FA_FILES}"]`)).not.toBeNull();
  });

  it('marks unformatted candidates by candidateId', () => {
    const { container } = renderTree();
    expect(container.querySelector(`[data-testid="candidate-${I.CAND_INTENSO}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-testid="eject-${I.FA_APP}"]`)).not.toBeNull();
  });
});
