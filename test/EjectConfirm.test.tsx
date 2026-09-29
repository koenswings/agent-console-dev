/**
 * idea#157 — tree: stuck-unmount warning under the Engine row (all disk
 * types); eject on a combined disk confirms first and lists what is affected.
 * The Files section's Eject confirms the same way.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import NetworkTree from '../src/components/NetworkTree';
import DiskView from '../src/components/DiskView';
import { setSendCommandFn } from '../src/store/commands';
import { MOCK_FILES_STORE, FILES_IDS as I } from '../src/mock/filesFixtures';
import type { CommandLogState } from '../src/store/commandLog';
import type { Disk, Store } from '../src/types/store';

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

const withDisk = (s: Store, id: string, patch: Partial<Disk>): Store => ({
  ...s,
  diskDB: { ...s.diskDB, [id]: { ...s.diskDB[id], ...patch } },
});

const row = (c: HTMLElement, id: string) => c.querySelector(`[data-disk-id="${id}"]`)!;
const ejectBtn = (c: HTMLElement, id: string) =>
  row(c, id).querySelector<HTMLButtonElement>('.tree-item__eject-btn')!;
const dialog = (c: HTMLElement) => c.querySelector('[role="dialog"].eject-confirm');
const items = (c: HTMLElement, kind: string) =>
  Array.from(c.querySelectorAll(`.eject-confirm__list--${kind} li`)).map((li) => li.textContent);
const button = (el: Element, name: string) =>
  Array.from(el.querySelectorAll('button')).find((b) => b.textContent === name)!;
const warnings = (c: HTMLElement) => Array.from(c.querySelectorAll('.tree-item__unmount-warning'));

let sent: ReturnType<typeof vi.fn>;
beforeEach(() => { sent = vi.fn(); setSendCommandFn(sent); });
afterEach(() => cleanup());

describe('NetworkTree — stuck-unmount warning on the Engine row (idea#157)', () => {
  it('shows the warning for each stuck disk on its Engine, docked or not', () => {
    const { container } = renderTree();
    const w = warnings(container);
    expect(w.map((x) => x.getAttribute('data-unmount-disk-id')).sort()).toEqual([I.FA_GONE, I.FA_UNMOUNT].sort());
    for (const x of w) {
      expect(x.getAttribute('data-engine-id')).toBe(I.ENGINE_A);
      expect(x.getAttribute('role')).toBe('alert');
    }
    expect(w.find((x) => x.getAttribute('data-unmount-disk-id') === I.FA_UNMOUNT)!.textContent)
      .toBe("Stuck Files couldn't be unmounted cleanly. Restart this Pi.");
    expect(w.find((x) => x.getAttribute('data-unmount-disk-id') === I.FA_GONE)!.textContent)
      .toBe("Old Stick couldn't be unmounted cleanly. Restart this Pi.");
  });

  it('shows it for an App Disk too, under the right Engine', () => {
    const store = withDisk(MOCK_FILES_STORE, I.FB_APP, {
      unmountError: { engineId: I.ENGINE_B, mountPoint: '/disks/sdb1', fsUuid: 'u', message: 'busy' },
    });
    const { container } = renderTree(store);
    const w = warnings(container).find((x) => x.getAttribute('data-unmount-disk-id') === I.FB_APP)!;
    expect(w.getAttribute('data-engine-id')).toBe(I.ENGINE_B);
    expect(w.textContent).toBe(`${store.diskDB[I.FB_APP].name} couldn't be unmounted cleanly. Restart this Pi.`);
    // Placed before Engine B's disk rows, after the Engine B row
    expect(w.compareDocumentPosition(row(container, I.FB_APP)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row(container, I.FA_APP).compareDocumentPosition(w) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no warning when no disk has an unmount error', () => {
    const store = withDisk(withDisk(MOCK_FILES_STORE, I.FA_UNMOUNT, { unmountError: null }), I.FA_GONE, { unmountError: null });
    const { container } = renderTree(store);
    expect(warnings(container)).toHaveLength(0);
  });
});

describe('NetworkTree — eject confirmation on combined disks (idea#157)', () => {
  it('opens the confirmation without sending, listing roles and everything affected', () => {
    const { container } = renderTree();
    fireEvent.click(ejectBtn(container, I.FA_ABF));
    expect(sent).not.toHaveBeenCalled();
    const dlg = dialog(container)!;
    expect(dlg).not.toBeNull();
    expect(dlg.querySelector('.eject-confirm__title')!.textContent)
      .toBe(`Eject ${MOCK_FILES_STORE.diskDB[I.FA_ABF].name}? It is an App Disk, a Backup Disk and a Files Disk.`);
    expect(items(container, 'stopping')).toEqual(['Kolibri (wiki-01)']);
    expect(items(container, 'files')).toEqual(['Nextcloud (nextcloud-01) loses Shared']);
    expect(items(container, 'backups')).toEqual(['Kolibri (kolibri-01)']);
  });

  it('Cancel closes it and sends nothing', () => {
    const { container } = renderTree();
    fireEvent.click(ejectBtn(container, I.FA_APP_FILES));
    fireEvent.click(button(dialog(container)!, 'Cancel'));
    expect(dialog(container)).toBeNull();
    expect(sent).not.toHaveBeenCalled();
  });

  it('Eject sends ejectDisk <id> and closes it', () => {
    const { container } = renderTree();
    fireEvent.click(ejectBtn(container, I.FA_APP_FILES));
    expect(items(container, 'stopping')).toEqual(['Nextcloud (nextcloud-01)']);
    expect(container.querySelector('.eject-confirm__list--files')).toBeNull();
    fireEvent.click(button(dialog(container)!, 'Eject'));
    expect(dialog(container)).toBeNull();
    expect(sent).toHaveBeenCalledOnce();
    expect(sent).toHaveBeenCalledWith(I.ENGINE_A, `ejectDisk ${I.FA_APP_FILES}`);
  });

  it('a single-role disk ejects immediately, without the confirmation', () => {
    const { container } = renderTree();
    fireEvent.click(ejectBtn(container, I.FA_FILES));
    expect(dialog(container)).toBeNull();
    expect(sent).toHaveBeenCalledWith(I.ENGINE_A, `ejectDisk ${I.FA_FILES}`);
  });
});

describe('FilesSection — Eject confirms on a combined disk (idea#157)', () => {
  const renderView = (diskId: string) => {
    const [store] = createSignal<Store | null>(MOCK_FILES_STORE);
    const [cls] = createSignal<CommandLogState>({ traces: {}, recentTraceIds: [] });
    return render(() => <DiskView diskId={diskId} store={store} commandLogStore={cls} />);
  };
  const filesEject = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('.files-section__eject')!;

  it('asks first on a combined disk, then sends on Eject', () => {
    const { container } = renderView(I.FA_ABF);
    fireEvent.click(filesEject(container));
    expect(sent).not.toHaveBeenCalled();
    expect(items(container, 'backups')).toEqual(['Kolibri (kolibri-01)']);
    fireEvent.click(button(dialog(container)!, 'Eject'));
    expect(sent).toHaveBeenCalledWith(I.ENGINE_A, `ejectDisk ${I.FA_ABF}`);
  });

  it('Cancel sends nothing', () => {
    const { container } = renderView(I.FA_APP_FILES);
    fireEvent.click(filesEject(container));
    fireEvent.click(button(dialog(container)!, 'Cancel'));
    expect(dialog(container)).toBeNull();
    expect(sent).not.toHaveBeenCalled();
  });

  it('ejects a Files-only disk straight away', () => {
    const { container } = renderView(I.FA_FILES);
    fireEvent.click(filesEject(container));
    expect(dialog(container)).toBeNull();
    expect(sent).toHaveBeenCalledWith(I.ENGINE_A, `ejectDisk ${I.FA_FILES}`);
  });
});
