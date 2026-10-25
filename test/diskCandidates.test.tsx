/**
 * idea#303 point 3 — disk roles selector and the one-entry-per-disk UI.
 * Engine shape is pending Axle's confirmation on idea#303.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import ClientCardsSection from '../src/components/ClientCardsSection';
import { setSendCommandFn } from '../src/store/commands';
import { MOCK_STORE, MOCK_IDS } from '../src/mock/mockStore';
import { diskRoleEntries, diskRolesSource, flashCopy } from '../src/store/diskCandidates';
import { ERROR_TEXT, errorText, initialisableDisks } from '../src/store/clientCards';
import type { CommandLogStore } from '../src/types/commandLog';
import type { CommandLogState } from '../src/store/commandLog';
import type { CommandTrace } from '../src/types/commandLog';
import type { ClientCard, DiskCandidate, DiskKind, Engine, NewDisk, Store, UnformattedDisk } from '../src/types/store';

const E = MOCK_IDS.ENGINE_1_ID;
const T = 1_000;
const BASE_CAPS = ['diskIdArgs', 'eraseDisk', 'unknownDiskReadOnly', 'clientCards', 'flashCard', 'clientImages'];

const nd = (id: string, kind?: DiskKind, over: Partial<NewDisk> = {}): NewDisk => ({
  candidateId: id, device: 'sda', byId: `usb-${id}`, sizeBytes: 64e9, model: `M-${id}`, serial: null,
  removable: kind !== 'ssd', readerId: null, partitions: [], contents: { kind: 'empty' } as NewDisk['contents'],
  mountedReadOnly: false, firstSeen: T, ...(kind ? { kind } : {}), ...over,
});
const cc = (id: string, kind?: DiskKind, over: Partial<ClientCard> = {}): ClientCard => ({
  candidateId: id, sizeBytes: 64e9, model: `M-${id}`, readerId: null, contents: { kind: 'empty' } as ClientCard['contents'],
  flashable: true, refusal: null, ...(kind ? { kind } : {}), ...over,
});
const uf = (id: string): UnformattedDisk => ({ candidateId: id, device: 'sda', sizeBytes: 64e9, model: null, fsType: 'vfat', label: 'X' });

const eng = (caps: string[], over: Partial<Engine> = {}): Engine => ({
  ...(MOCK_STORE.engineDB[E] as Engine),
  capabilities: caps, capabilitiesBootedAt: T, lastBooted: T,
  newDisks: [], clientCards: [], unformattedDisks: [], cardReaders: [], ...over,
});
const v2 = (over: Partial<Engine>) => eng([...BASE_CAPS, 'diskRolesV2'], over);

describe('diskRoleEntries (diskRolesV2 merge)', () => {
  it('a stick in newDisks and clientCards gives one entry with both actions', () => {
    const r = diskRoleEntries(v2({ newDisks: [nd('s', 'stick')], clientCards: [cc('s', 'stick')] }));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ candidateId: 's', actions: ['makeIdeaDisk', 'makeClientDisk'], needsErase: false, kind: 'stick' });
  });
  it('an SSD gives one entry with both actions and the USB-boot flash copy', () => {
    const r = diskRoleEntries(v2({ newDisks: [nd('d', 'ssd')], clientCards: [cc('d', 'ssd')] }));
    expect(r).toHaveLength(1);
    expect(r[0].actions).toEqual(['makeIdeaDisk', 'makeClientDisk']);
    expect(flashCopy(r[0].kind)).toMatch(/booting a classroom computer from USB/);
  });
  it('an SD card in a reader is flash only, even if listed in newDisks', () => {
    expect(diskRoleEntries(v2({ clientCards: [cc('c', 'sdReader', { readerId: 'r' })] }))[0].actions).toEqual(['makeClientDisk']);
    expect(diskRoleEntries(v2({ newDisks: [nd('c', 'sdReader')], clientCards: [cc('c', 'sdReader')] }))[0].actions).toEqual(['makeClientDisk']);
  });
  it('a non-ext4 stick needs Erase first for Make IDEA disk', () => {
    const r = diskRoleEntries(v2({ newDisks: [nd('s', 'stick')], clientCards: [cc('s', 'stick')], unformattedDisks: [uf('s')] }));
    expect(r[0]).toMatchObject({ needsErase: true, actions: ['makeIdeaDisk', 'makeClientDisk'] });
  });
  it('a disk in only one list gets only that action', () => {
    const r = diskRoleEntries(v2({ newDisks: [nd('a')], clientCards: [cc('b')] }));
    expect(r.map((e) => [e.candidateId, e.actions])).toEqual([['a', ['makeIdeaDisk']], ['b', ['makeClientDisk']]]);
  });
  it('a stale capability stamp counts as an old Engine', () => {
    expect(diskRolesSource(v2({ capabilitiesBootedAt: T - 1 }))).toBe('legacy');
  });
});

describe('diskRoleEntries (old Engine without the flag)', () => {
  it('keeps today’s behaviour: Initialise list = newDisks minus clientCards ids', () => {
    const e = eng(BASE_CAPS, { newDisks: [nd('s'), nd('x')], clientCards: [cc('s')], unformattedDisks: [uf('x')] });
    expect(diskRolesSource(e)).toBe('legacy');
    const r = diskRoleEntries(e);
    expect(r.filter((x) => x.actions[0] === 'makeIdeaDisk').map((x) => x.candidateId)).toEqual(initialisableDisks(e).map((d) => d.candidateId));
    expect(r).toEqual([
      expect.objectContaining({ candidateId: 'x', actions: ['makeIdeaDisk'], needsErase: true }),
      expect.objectContaining({ candidateId: 's', actions: ['makeClientDisk'] }),
    ]);
  });
});

const dc = (id: string, kind: DiskCandidate['kind'], actions: DiskCandidate['actions'], removable = true): DiskCandidate => ({
  candidateId: id, kind, device: 'sda', sizeBytes: 1e9, model: null, serial: null, removable, readerId: null,
  partitions: [], contents: { kind: 'empty' } as DiskCandidate['contents'], actions, flashRefusal: null, mountedReadOnly: false, firstSeen: T,
});
const CAND_CAPS = [...BASE_CAPS, 'diskCandidates'];

describe('diskRoleEntries (Engine #247 diskCandidates)', () => {
  it('an OS-rootfs disk (actions flash only) gets only Make classroom computer disk, even though it is in newDisks', () => {
    const r = diskRoleEntries(eng(CAND_CAPS, { diskCandidates: [dc('o', 'usbDisk', ['flash'])], newDisks: [nd('o')], clientCards: [cc('o')] }));
    expect(r).toEqual([expect.objectContaining({ candidateId: 'o', actions: ['makeClientDisk'], needsErase: false })]);
  });
  it('a disk with no actions gets no buttons', () => {
    expect(diskRoleEntries(eng(CAND_CAPS, { diskCandidates: [dc('n', 'usbDisk', [])] }))[0].actions).toEqual([]);
  });
  it('OS_ROOTFS has a friendly text', () => {
    expect(errorText('OS_ROOTFS: sdk2 holds an operating system')).toBe(ERROR_TEXT.OS_ROOTFS);
    expect(ERROR_TEXT.OS_ROOTFS).toMatch(/can't become an IDEA disk.*classroom computer disk/);
  });
});

describe('diskRoleEntries (Axle’s diskCandidates proposal)', () => {
  it('maps actions, erase-first and kind', () => {
    const r = diskRoleEntries(eng([...BASE_CAPS, 'diskCandidates', 'diskRolesV2'], { diskCandidates: [
      dc('s', 'usbDisk', ['erase', 'flash']), dc('d', 'usbDisk', ['initialise', 'flash'], false), dc('c', 'sdCard', ['flash']),
    ] }));
    expect(r.map((e) => [e.candidateId, e.actions, e.needsErase, e.kind])).toEqual([
      ['s', ['makeIdeaDisk', 'makeClientDisk'], true, 'stick'],
      ['d', ['makeIdeaDisk', 'makeClientDisk'], false, 'ssd'],
      ['c', ['makeClientDisk'], false, 'sdReader'],
    ]);
  });
});

// ── Component ───────────────────────────────────────────────────────────────
let sent: ReturnType<typeof vi.fn>;
beforeEach(() => { sent = vi.fn(); setSendCommandFn(sent); });
afterEach(cleanup);

let setLog: (l: CommandLogState) => void = () => undefined;
const mount = (over: Partial<Engine>, caps = [...BASE_CAPS, 'diskRolesV2']) => {
  const s = structuredClone(MOCK_STORE) as Store;
  s.engineDB[E] = { ...eng(caps, over), clientImages: s.engineDB[E].clientImages } as Engine;
  const [st] = createSignal<Store | null>(s);
  const [cls, setCls] = createSignal<CommandLogState>({ traces: {}, recentTraceIds: [] });
  setLog = setCls;
  return render(() => <ClientCardsSection engineId={E} store={st} commandLogStore={cls} />).container;
};
const errTrace = (id: string, msg: string): CommandLogStore => {
  const t: CommandTrace = { traceId: 'i1', command: 'initialiseDisk', args: { candidateId: id, role: 'empty' }, startedAt: Date.now(),
    completedAt: Date.now(), status: 'error', errorMessage: msg, logs: [] } as CommandTrace;
  return { traces: { i1: t }, recentTraceIds: ['i1'] };
};
const q = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null;

describe('ClientCardsSection with disk roles', () => {
  it('a stick shows one entry with both buttons', () => {
    const c = mount({ newDisks: [nd('s', 'stick')], clientCards: [cc('s', 'stick')] });
    expect(c.querySelectorAll('[data-testid^="disk-role-s"]').length).toBeGreaterThan(0);
    expect(c.querySelectorAll('.disk-role')).toHaveLength(1);
    expect(q(c, 'disk-role-idea-s')!.textContent).toBe('Make IDEA disk');
    expect(q(c, 'disk-role-flash-s')!.textContent).toBe('Make classroom computer disk');
    expect(q(c, 'new-disk-s')).toBeNull();
    expect(q(c, 'client-card-s')).toBeNull();
  });
  it('an SSD shows both buttons and the USB-boot copy', () => {
    const c = mount({ newDisks: [nd('d', 'ssd')], clientCards: [cc('d', 'ssd')] });
    expect(c.querySelectorAll('.disk-role')).toHaveLength(1);
    expect(q(c, 'disk-role-idea-d')).not.toBeNull();
    expect(q(c, 'disk-role-flash-d')).not.toBeNull();
    expect(q(c, 'disk-role-flash-copy-d')!.textContent).toMatch(/booting a classroom computer from USB/);
  });
  it('an SD card in a reader is flash only', () => {
    const c = mount({ clientCards: [cc('c', 'sdReader')] });
    expect(q(c, 'disk-role-idea-c')).toBeNull();
    expect(q(c, 'disk-role-flash-c')).not.toBeNull();
  });
  it('Make IDEA disk opens the existing Initialise form and sends nothing by itself', () => {
    const c = mount({ newDisks: [nd('s', 'stick')], clientCards: [cc('s', 'stick')] });
    fireEvent.click(q(c, 'disk-role-idea-s')!);
    expect(q(c, 'new-disk-initialise-s')).not.toBeNull();
    expect(sent).not.toHaveBeenCalled();
    fireEvent.click(q(c, 'new-disk-initialise-s')!);
    expect(sent).toHaveBeenCalledWith(E, 'initialiseDisk s empty');
  });
  it('Make IDEA disk on a non-ext4 disk opens the existing Erase confirmation first', () => {
    const c = mount({ newDisks: [nd('s', 'stick')], clientCards: [cc('s', 'stick')], unformattedDisks: [uf('s')] });
    fireEvent.click(q(c, 'disk-role-idea-s')!);
    expect(q(c, 'new-disk-initialise-s')).toBeNull();
    expect(c.querySelector('[data-testid^="erase-"]')).not.toBeNull();
    // The existing dialog only reads (summariseDisk); no erase/initialise without confirming.
    expect(sent.mock.calls.map((x) => String(x[1]).split(' ')[0])).toEqual(['summariseDisk']);
  });
  it('Make classroom computer disk opens the existing Flash dialog and sends nothing by itself', () => {
    const c = mount({ newDisks: [nd('s', 'stick')], clientCards: [cc('s', 'stick')] });
    fireEvent.click(q(c, 'disk-role-flash-s')!);
    expect(c.querySelector('[data-testid^="flash-"]')).not.toBeNull();
    expect(sent).not.toHaveBeenCalled();
  });
  it('Engine #247: an OS-rootfs disk shows only Make classroom computer disk', () => {
    const c = mount({ diskCandidates: [dc('o', 'usbDisk', ['flash'])], newDisks: [nd('o')], clientCards: [cc('o')] }, CAND_CAPS);
    expect(c.querySelectorAll('.disk-role')).toHaveLength(1);
    expect(q(c, 'disk-role-idea-o')).toBeNull();
    expect(q(c, 'disk-role-flash-o')).not.toBeNull();
  });
  it('Engine #247: an OS_ROOTFS refusal from initialiseDisk shows the friendly text', () => {
    const c = mount({ diskCandidates: [dc('s', 'usbDisk', ['initialise', 'flash'])], newDisks: [nd('s')], clientCards: [cc('s')] }, CAND_CAPS);
    fireEvent.click(q(c, 'disk-role-idea-s')!);
    fireEvent.click(q(c, 'new-disk-initialise-s')!);
    expect(sent).toHaveBeenCalledWith(E, 'initialiseDisk s empty');
    setLog(errTrace('s', 'OS_ROOTFS: sdk2 holds an operating system; flash it instead'));
    expect(q(c, 'new-disk-feedback-s-error')!.textContent).toContain(ERROR_TEXT.OS_ROOTFS);
  });
  it('an old Engine keeps the two lists', () => {
    const c = mount({ newDisks: [nd('s'), nd('x')], clientCards: [cc('s')] }, BASE_CAPS);
    expect(c.querySelectorAll('.disk-role')).toHaveLength(0);
    expect(q(c, 'client-card-s')).not.toBeNull();
    expect(q(c, 'new-disk-x')).not.toBeNull();
    expect(q(c, 'new-disk-s')).toBeNull();
  });
});
