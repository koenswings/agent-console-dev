/**
 * idea#193 — read-only USB sticks in the Console: row, builder link, erase,
 * the two step-5 hints, and the demo-mode fixtures.
 */
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@solidjs/testing-library';
import NetworkTree from '../src/components/NetworkTree';
import UnformattedDiskView from '../src/components/UnformattedDiskView';
import { MOCK_STORE, MOCK_IDS, APP_CHANNEL_BUILDER_ID } from '../src/mock/mockStore';
import { resolveDemoMode } from '../src/store/demoMode';
import {
  BUILDER_LINK_TEXT,
  HINT_BUILDER_STOPPED,
  HINT_NO_BUILDER,
  STICK_FS_LINE,
  STICK_TEAMS_LINE,
  channelBuilderOn,
  stickBuilderState,
  stickRowLabel,
} from '../src/store/usbSticks';
import type { Selection } from '../src/components/NetworkTree';
import type { Instance, Status, Store, UsbStickPublic } from '../src/types/store';

const E1 = MOCK_IDS.ENGINE_1_ID;
const E2 = MOCK_IDS.ENGINE_2_ID;
const STICK = MOCK_IDS.MARY_STICK_ID;
const CAND = MOCK_IDS.MARY_CAND_ID;

const clone = (): Store => structuredClone(MOCK_STORE) as Store;
const stickOf = (s: Store): UsbStickPublic => s.engineDB[E1].usbSticks![0];
const withBuilder = (status: Status | null): Store => {
  const s = clone();
  if (status === null) delete s.instanceDB[MOCK_IDS.INST_CHANNEL_BUILDER_ID];
  else (s.instanceDB[MOCK_IDS.INST_CHANNEL_BUILDER_ID] as Instance).status = status;
  return s;
};
const tree = (store: Store, onSelect: (s: Selection) => void = () => {}) =>
  render(() => (
    <NetworkTree
      store={() => store}
      selection={{ type: 'network', id: '' }}
      onSelect={onSelect}
      dragData={() => null}
      onDrop={() => {}}
    />
  ));

describe('USB stick row (idea#193 §5)', () => {
  it('shows "USB stick: MARY-STICK (read-only, 3.2 GB)" and the teachers line, not an unformatted row', () => {
    const { getByTestId, queryByTestId } = tree(clone());
    const row = getByTestId(`usb-stick-${STICK}`);
    expect(getByTestId('usb-stick-label').textContent).toBe('USB stick: MARY-STICK (read-only, 3.2 GB)');
    expect(row.textContent).toContain(STICK_TEAMS_LINE);
    expect(row.textContent).toContain('read-only');
    expect(row.textContent).not.toContain('unformatted');
    expect(queryByTestId(`candidate-${CAND}`)).toBeNull();
    expect(row.getAttribute('data-engine-id')).toBe(E1);
  });

  it('an unformatted disk that is not a stick still shows as unformatted', () => {
    const s = clone();
    s.engineDB[E1].usbSticks = [];
    const { getByTestId, queryByTestId } = tree(s);
    expect(getByTestId(`candidate-${CAND}`).textContent).toContain('unformatted');
    expect(queryByTestId(`usb-stick-${STICK}`)).toBeNull();
  });

  it('clicking the row selects the erase candidate (Erase stays reachable)', () => {
    const calls: Selection[] = [];
    const { getByTestId } = tree(clone(), (x) => calls.push(x));
    fireEvent.click(getByTestId(`usb-stick-${STICK}`));
    expect(calls).toEqual([{ type: 'unformatted', id: CAND, engineId: E1 }]);
  });

  it('Erase this disk… stays available on the stick; "contents unknown" is replaced by the FAT32/exFAT line', () => {
    const s = clone();
    s.engineDB[E1].capabilities = ['diskIdArgs', 'eraseDisk', 'filesDisk'];
    const { getByText, queryByText, getByTestId, container } = render(() => (
      <UnformattedDiskView engineId={E1} candidateId={CAND} store={() => s} onSelect={() => {}} />
    ));
    const erase = getByText('Erase this disk…') as HTMLButtonElement;
    expect(erase.disabled).toBe(false);
    expect(getByTestId('usb-stick-fs-line').textContent).toBe(STICK_FS_LINE);
    expect(container.textContent).not.toContain('Contents unknown');
    expect(container.textContent).toContain('USB stick: MARY-STICK (read-only, 3.2 GB)');
    fireEvent.click(erase);
    // The erase dialog replaced the action buttons (normal erase flow, unchanged).
    expect(queryByText('Erase this disk…')).toBeNull();
  });

  it('a stick the Engine did not list for erase still shows, without selecting anything', () => {
    const s = clone();
    s.engineDB[E1].unformattedDisks = [];
    const calls: Selection[] = [];
    const { getByTestId } = tree(s, (x) => calls.push(x));
    fireEvent.click(getByTestId(`usb-stick-${STICK}`));
    expect(calls).toEqual([]);
  });

  it('stickRowLabel strips the "USB: " prefix and formats the size', () => {
    expect(stickRowLabel(stickOf(clone()))).toBe('USB stick: MARY-STICK (read-only, 3.2 GB)');
  });
});

describe('Channel builder link (idea#193 §8.3)', () => {
  it('links to the running builder on this Pi (port 8090), opens in a new tab', () => {
    const { getByTestId, queryByTestId } = tree(clone());
    const a = getByTestId('usb-stick-builder-link') as HTMLAnchorElement;
    expect(a.textContent).toBe(BUILDER_LINK_TEXT);
    expect(a.getAttribute('href')).toMatch(/^http:\/\/[^/]+:8090$/);
    expect(a.getAttribute('target')).toBe('_blank');
    expect(queryByTestId('usb-stick-hint')).toBeNull();
  });

  it('a builder docked on another Pi does not count', () => {
    const s = clone();
    s.diskDB[MOCK_IDS.DISK_6_ID].dockedTo = E2;
    expect(channelBuilderOn(s, E1)).toBeUndefined();
    const { queryByTestId } = tree(s);
    expect(queryByTestId('usb-stick-builder-link')).toBeNull();
  });
});

describe('Step 5 hints (idea#193 §8.2a)', () => {
  it('no builder on this Pi + kolibri folder → "No channel builder on this Pi…"', () => {
    const { getByTestId, queryByTestId } = tree(withBuilder(null));
    const h = getByTestId('usb-stick-hint');
    expect(h.textContent).toBe(HINT_NO_BUILDER);
    expect(h.textContent).toBe('No channel builder on this Pi: dock the disk with the channel builder app to build automatically');
    expect(queryByTestId('usb-stick-builder-link')).toBeNull();
  });

  it.each(['Stopped', 'Pauzed'] as Status[])('builder %s + kolibri folder → "stopped by an operator"', (st) => {
    const { getByTestId, queryByTestId } = tree(withBuilder(st));
    expect(getByTestId('usb-stick-hint').textContent).toBe(
      'Channel builder was stopped by an operator; start it to build from this stick',
    );
    expect(HINT_BUILDER_STOPPED).toContain('stopped by an operator');
    expect(queryByTestId('usb-stick-builder-link')).toBeNull();
  });

  it.each(['Docked', 'Starting', 'Error'] as Status[])('builder %s (the Engine starts it) → no hint', (st) => {
    const s = withBuilder(st);
    expect(stickBuilderState(s, E1, stickOf(s)).kind).toBe('other');
    const { queryByTestId } = tree(s);
    expect(queryByTestId('usb-stick-hint')).toBeNull();
  });

  it('a stick without a kolibri folder never shows either hint', () => {
    for (const st of [null, 'Stopped'] as (Status | null)[]) {
      const s = withBuilder(st);
      s.engineDB[E1].usbSticks![0].hasKolibriFolder = false;
      expect(stickBuilderState(s, E1, stickOf(s)).kind).toBe('none');
      const { queryByTestId, unmount } = tree(s);
      expect(queryByTestId('usb-stick-hint')).toBeNull();
      unmount();
    }
  });

  it('hasKolibriFolder absent (older Engine) is treated as no kolibri folder', () => {
    const s = withBuilder(null);
    delete s.engineDB[E1].usbSticks![0].hasKolibriFolder;
    expect(stickBuilderState(s, E1, stickOf(s)).kind).toBe('none');
  });
});

describe('Demo mode (idea#193 §8.4, step 5b)', () => {
  it('the demo store has the channel builder app, its disk on Engine 1 and a Running instance on 8090', () => {
    const app = MOCK_STORE.appDB[APP_CHANNEL_BUILDER_ID];
    expect(APP_CHANNEL_BUILDER_ID).toBe('kolibri-channel-builder-1.0');
    expect(app?.name).toBe('kolibri-channel-builder');
    const disk = MOCK_STORE.diskDB[MOCK_IDS.DISK_6_ID];
    expect(disk).toMatchObject({ name: 'channel-builder-disk', diskTypes: ['app'], dockedTo: E1 });
    const inst = MOCK_STORE.instanceDB['channel-builder-inst-001'];
    expect(inst).toMatchObject({ instanceOf: APP_CHANNEL_BUILDER_ID, status: 'Running', port: 8090, storedOn: MOCK_IDS.DISK_6_ID });
    expect(channelBuilderOn(MOCK_STORE, E1)?.id).toBe('channel-builder-inst-001');
  });

  it('the demo store has the stick "USB: MARY-STICK" on Engine 1, exFAT, read-only, with a kolibri folder', () => {
    const st = MOCK_STORE.engineDB[E1].usbSticks ?? [];
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({ displayName: 'USB: MARY-STICK', fsType: 'exfat', readOnly: true, hasKolibriFolder: true });
    expect(MOCK_STORE.engineDB[E1].unformattedDisks?.some((u) => u.device === st[0].device)).toBe(true);
  });

  it('production web never uses the demo/mock store, even with stored demoMode or ?demo=1', () => {
    for (const storedDemo of [true, false]) {
      for (const searchParams of ['', '?demo=1', '?demo=true']) {
        expect(resolveDemoMode({ productionWeb: true, storedDemo, searchParams }).isDemo).toBe(false);
      }
    }
    expect(resolveDemoMode({ productionWeb: true, storedDemo: true }).persistFalse).toBe(true);
    expect(resolveDemoMode({ productionWeb: false, storedDemo: true }).isDemo).toBe(true);
  });
});
