/**
 * RoleBadges — one badge per disk role in the fixed order app, backup, files
 * (files-disk.md §8, idea#132). Used in the network tree row and the disk
 * header.
 */
import { For, createMemo, type Component } from 'solid-js';
import { diskBadges, type DiskBadge } from '../store/diskRoles';
import type { Disk, Store } from '../types/store';

interface RoleBadgesProps {
  disk: () => Disk | undefined;
  store: () => Store | null;
}

const sameList = (a: DiskBadge[], b: DiskBadge[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

const RoleBadges: Component<RoleBadgesProps> = (props) => {
  const badges = createMemo(
    (): DiskBadge[] => {
      const d = props.disk();
      return d ? diskBadges(d, props.store()) : [];
    },
    [],
    { equals: sameList }
  );
  return (
    <For each={badges()}>
      {(badge) => (
        <span class={`tree-item__type-badge tree-item__type-badge--${badge}`} data-role={badge}>
          {badge}
        </span>
      )}
    </For>
  );
};

export default RoleBadges;
