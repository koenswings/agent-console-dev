/**
 * idea#214: "Available in" rows are keyed by instance ID (no index use).
 * A reorder keeps each row's DOM node; the separator follows the new order.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import type { Disk, Store } from '../src/types/store';

type Inst = { instanceId: string; label: string };
const h = vi.hoisted(() => ({ list: null as null | (() => Inst[]) }));

vi.mock('../src/store/diskRoles', async (orig) => {
  const mod = await orig<typeof import('../src/store/diskRoles')>();
  return {
    ...mod,
    filesNotMountedReason: () => null,
    filesAvailability: () => ({ kind: 'mounted', instances: h.list!() }),
    lowSpaceWarning: () => null,
  };
});

import FilesSection from '../src/components/FilesSection';

afterEach(cleanup);

const A = { instanceId: 'inst-a', label: 'Nextcloud (a)' };
const B = { instanceId: 'inst-b', label: 'Kolibri (b)' };
const C = { instanceId: 'inst-c', label: 'Wiki (c)' };

describe('FilesSection "Available in" list (idea#214)', () => {
  it('keeps row DOM nodes on reorder and recomputes separators', () => {
    const [list, setList] = createSignal<Inst[]>([A, B, C]);
    h.list = list;
    const disk = { id: 'd1', name: 'Files', filesConfig: null, dockedTo: null, diskTypes: ['files'] } as unknown as Disk;
    const { container } = render(() => <FilesSection disk={() => disk} store={() => ({} as Store)} />);
    const row = (id: string) => container.querySelector(`[data-instance-id="${id}"]`) as HTMLElement;
    const before = { a: row('inst-a'), b: row('inst-b'), c: row('inst-c') };
    const text = () => container.querySelector('.files-section__availability')!.textContent;
    expect(text()).toBe('Available in: Nextcloud (a), Kolibri (b), Wiki (c)');

    setList([C, A, B]);
    expect(row('inst-a')).toBe(before.a);
    expect(row('inst-b')).toBe(before.b);
    expect(row('inst-c')).toBe(before.c);
    expect(text()).toBe('Available in: Wiki (c), Nextcloud (a), Kolibri (b)');

    setList([B]);
    expect(row('inst-b')).toBe(before.b);
    expect(text()).toBe('Available in: Kolibri (b)');
  });
});
