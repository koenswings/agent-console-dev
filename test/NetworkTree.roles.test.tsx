/**
 * idea#132 — tree row: one badge per role in fixed order; eject shown on
 * combined disks and hidden only on a pure Backup Disk.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import NetworkTree from '../src/components/NetworkTree';
import { MOCK_FILES_STORE, FILES_IDS as I } from '../src/mock/filesFixtures';
import type { Store } from '../src/types/store';

const renderTree = (store: Store = MOCK_FILES_STORE) =>
  render(() => (
    <NetworkTree
      store={() => store}
      selection={{ type: 'network', id: '' }}
      onSelect={() => {}}
      dragData={() => null}
      onDrop={() => {}}
    />
  ));

const row = (c: HTMLElement, id: string) => c.querySelector(`[data-disk-id="${id}"]`)!;
const rowBadges = (c: HTMLElement, id: string) =>
  Array.from(row(c, id).querySelectorAll('[data-role]')).map((b) => b.getAttribute('data-role'));
const hasEject = (c: HTMLElement, id: string) => row(c, id).querySelector('.tree-item__eject-btn') !== null;

afterEach(() => cleanup());

describe('NetworkTree — role badges (idea#132)', () => {
  it('shows every role in the fixed order app, backup, files', () => {
    const { container } = renderTree();
    expect(rowBadges(container, I.FA_ABF)).toEqual(['app', 'backup', 'files']);
    expect(rowBadges(container, I.FA_APP_FILES)).toEqual(['app', 'files']);
    expect(rowBadges(container, I.FA_FILES)).toEqual(['files']);
    expect(rowBadges(container, I.FA_BACKUP)).toEqual(['backup']);
  });

  it('keeps the fixed order when diskTypes lists roles in another order', () => {
    const store: Store = {
      ...MOCK_FILES_STORE,
      diskDB: { ...MOCK_FILES_STORE.diskDB, [I.FA_ABF]: { ...MOCK_FILES_STORE.diskDB[I.FA_ABF], diskTypes: ['files', 'backup', 'app'] } },
    };
    const { container } = renderTree(store);
    expect(rowBadges(container, I.FA_ABF)).toEqual(['app', 'backup', 'files']);
  });
});

describe('NetworkTree — canEject on combined disks (idea#132)', () => {
  it('hidden on a pure Backup Disk', () => {
    const { container } = renderTree();
    expect(hasEject(container, I.FA_BACKUP)).toBe(false);
  });

  it('shown on combined disks, including ones with the backup role', () => {
    const { container } = renderTree();
    expect(hasEject(container, I.FA_ABF)).toBe(true);
    expect(hasEject(container, I.FA_APP_FILES)).toBe(true);
    expect(hasEject(container, I.FA_FILES)).toBe(true);
  });

  it('shown on Backup + Files', () => {
    const store: Store = {
      ...MOCK_FILES_STORE,
      diskDB: { ...MOCK_FILES_STORE.diskDB, [I.FA_BACKUP]: { ...MOCK_FILES_STORE.diskDB[I.FA_BACKUP], diskTypes: ['backup', 'files'] } },
    };
    const { container } = renderTree(store);
    expect(hasEject(container, I.FA_BACKUP)).toBe(true);
  });
});
