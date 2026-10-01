/**
 * idea#152 — eject by disk ID and surface eject failures inline.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import NetworkTree from '../src/components/NetworkTree';
import { setSendCommandFn } from '../src/store/commands';
import { EJECT_TIMEOUT_MS, findEjectOutcome, traceIdSnapshot } from '../src/store/ejectResult';
import { MOCK_STORE } from '../src/mock/mockStore';
import type { CommandLogState } from '../src/store/commandLog';
import type { CommandLogStore, CommandTrace } from '../src/types/commandLog';
import type { Disk, Store } from '../src/types/store';

// ── Fixture: idea03 "system-boot" case ──────────────────────────────────────
// Two records share the name `system-boot`: a stale undocked one (listed
// first, so a name lookup would hit it) and the live docked one on sdb1.
const ENGINE_ID = 'ENGINE_IDEA03';
const STALE_ID = 'DISK_STALE_BOOT';
const LIVE_ID = 'DISK_LIVE_BOOT';

const staleDisk: Disk = {
  id: STALE_ID,
  name: 'system-boot',
  device: null,
  created: 1,
  lastDocked: 1,
  dockedTo: ENGINE_ID,
  diskTypes: [],
  backupConfig: null,
};
const liveDisk: Disk = {
  id: LIVE_ID,
  name: 'system-boot',
  device: 'sdb1',
  created: 2,
  lastDocked: 2,
  dockedTo: ENGINE_ID,
  diskTypes: [],
  backupConfig: null,
};

const fixtureStore: Store = {
  ...MOCK_STORE,
  engineDB: {
    [ENGINE_ID]: {
      id: ENGINE_ID,
      hostname: 'idea03',
      version: '1.2.0',
      hostOS: 'Linux',
      created: 1,
      lastBooted: 1,
      lastRun: Date.now(),
      lastHalted: null,
      commands: [],
    },
  } as Store['engineDB'],
  diskDB: { [STALE_ID]: staleDisk, [LIVE_ID]: liveDisk } as Store['diskDB'],
  instanceDB: {},
  operationDB: {},
};

const PRIOR_TRACE: CommandTrace = {
  traceId: 'trace-prior',
  command: 'ejectDisk',
  args: JSON.stringify({ diskId: LIVE_ID }),
  startedAt: 1,
  completedAt: 2,
  status: 'error',
  errorMessage: 'old failure from before the click',
  logs: [],
};

const makeLog = (traces: CommandTrace[]): CommandLogStore => ({
  traces: Object.fromEntries(traces.map((t) => [t.traceId, t])),
  recentTraceIds: traces.map((t) => t.traceId),
});

const ejectTrace = (over: Partial<CommandTrace>): CommandTrace => ({
  traceId: 'trace-new',
  command: 'ejectDisk',
  args: JSON.stringify({ diskId: LIVE_ID }),
  startedAt: Date.now(),
  completedAt: Date.now(),
  status: 'ok',
  errorMessage: null,
  logs: [],
  ...over,
});

const renderTree = (log: () => CommandLogState) =>
  render(() => (
    <NetworkTree
      store={() => fixtureStore}
      selection={{ type: 'network', id: '' }}
      onSelect={() => {}}
      dragData={() => null}
      onDrop={() => {}}
      commandLogStore={log}
    />
  ));

const ejectButton = (container: HTMLElement): HTMLButtonElement => {
  const btns = container.querySelectorAll<HTMLButtonElement>('.tree-item__eject-btn');
  // Only the docked record (device non-null) gets an eject button
  expect(btns).toHaveLength(1);
  return btns[0];
};

const notice = (container: HTMLElement) => container.querySelector('.tree-item__eject-notice');


const confirmEjectOk = (container: HTMLElement): void => {
  const ok = container.querySelector<HTMLButtonElement>('[data-testid="eject-confirm-ok"]');
  if (!ok) throw new Error('eject-confirm-ok missing after eject click');
  fireEvent.click(ok);
};

/** Eject button now always opens confirm — confirm to send ejectDisk. */
const ejectAndConfirm = (container: HTMLElement): void => {
  fireEvent.click(ejectButton(container));
  confirmEjectOk(container);
};


describe('NetworkTree eject — sends the disk ID (idea#152)', () => {
  let sent: ReturnType<typeof vi.fn>;
  beforeEach(() => { sent = vi.fn(); setSendCommandFn(sent); });
  afterEach(() => cleanup());

  it('sends ejectDisk <id> for the docked disk, not its (duplicated) name', () => {
    const { container } = renderTree(() => makeLog([]));
    expect(container.querySelectorAll('.tree-item--disk')).toHaveLength(2);
    ejectAndConfirm(container);
    expect(sent).toHaveBeenCalledOnce();
    expect(sent).toHaveBeenCalledWith(ENGINE_ID, `ejectDisk ${LIVE_ID}`);
    expect(sent).not.toHaveBeenCalledWith(ENGINE_ID, 'ejectDisk system-boot');
    expect(sent).not.toHaveBeenCalledWith(ENGINE_ID, `ejectDisk ${STALE_ID}`);
  });
});

describe('NetworkTree eject — inline error surface (idea#152)', () => {
  beforeEach(() => { vi.useFakeTimers(); setSendCommandFn(vi.fn()); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('shows the Engine error message with the disk name when eject fails', () => {
    const [log, setLog] = createSignal<CommandLogState>(makeLog([PRIOR_TRACE]));
    const { container } = renderTree(log);
    ejectAndConfirm(container);
    // A pre-existing error trace (in the baseline) must not be reported
    expect(notice(container)).toBeNull();

    setLog(makeLog([PRIOR_TRACE, ejectTrace({ status: 'running', completedAt: null })]));
    expect(notice(container)).toBeNull();

    setLog(makeLog([PRIOR_TRACE, ejectTrace({
      status: 'error',
      errorMessage: "Disk 'system-boot' is not currently docked.",
    })]));
    const n = notice(container);
    expect(n).not.toBeNull();
    expect(n!.getAttribute('role')).toBe('alert');
    expect(n!.textContent).toContain('system-boot');
    expect(n!.textContent).toContain('not currently docked');

    // Does not turn into a timeout note later
    vi.advanceTimersByTime(EJECT_TIMEOUT_MS + 1000);
    expect(notice(container)!.textContent).toContain('not currently docked');
  });

  it('shows an error when the trace closes ok but logged an error line (current Engine)', () => {
    const [log, setLog] = createSignal<CommandLogState>(makeLog([]));
    const { container } = renderTree(log);
    ejectAndConfirm(container);
    setLog(makeLog([ejectTrace({
      status: 'ok',
      logs: [{ level: 'error', message: "\u001b[31mDisk name 'system-boot' is ambiguous.\u001b[39m", timestamp: 1 }],
    })]));
    const text = notice(container)?.textContent ?? '';
    expect(text).toContain("Disk name 'system-boot' is ambiguous.");
    expect(text).not.toContain('\u001b');
  });

  it('dismisses the error on click', () => {
    const [log, setLog] = createSignal<CommandLogState>(makeLog([]));
    const { container } = renderTree(log);
    ejectAndConfirm(container);
    setLog(makeLog([ejectTrace({ status: 'error', errorMessage: 'boom' })]));
    fireEvent.click(notice(container)!);
    expect(notice(container)).toBeNull();
  });

  it('clears the error on the next eject attempt', () => {
    const [log, setLog] = createSignal<CommandLogState>(makeLog([]));
    const { container } = renderTree(log);
    ejectAndConfirm(container);
    setLog(makeLog([ejectTrace({ status: 'error', errorMessage: 'boom' })]));
    expect(notice(container)).not.toBeNull();
    ejectAndConfirm(container);
    expect(notice(container)).toBeNull();
  });

  it('shows nothing when the eject succeeds', () => {
    const [log, setLog] = createSignal<CommandLogState>(makeLog([PRIOR_TRACE]));
    const { container } = renderTree(log);
    ejectAndConfirm(container);
    setLog(makeLog([PRIOR_TRACE, ejectTrace({ status: 'ok' })]));
    expect(notice(container)).toBeNull();
    vi.advanceTimersByTime(EJECT_TIMEOUT_MS + 1000);
    expect(notice(container)).toBeNull();
  });

  it('shows a gentle no-response note after 15 s without a trace', () => {
    const [log] = createSignal<CommandLogState>(makeLog([]));
    const { container } = renderTree(log);
    ejectAndConfirm(container);
    vi.advanceTimersByTime(EJECT_TIMEOUT_MS - 1);
    expect(notice(container)).toBeNull();
    vi.advanceTimersByTime(1);
    const n = notice(container);
    expect(n).not.toBeNull();
    expect(n!.textContent).toContain('No response from the Engine');
    expect(n!.getAttribute('role')).toBe('status');
  });

  it('ignores ejectDisk traces for a different disk', () => {
    const [log, setLog] = createSignal<CommandLogState>(makeLog([]));
    const { container } = renderTree(log);
    ejectAndConfirm(container);
    setLog(makeLog([ejectTrace({ args: JSON.stringify({ diskId: STALE_ID }), status: 'error', errorMessage: 'nope' })]));
    expect(notice(container)).toBeNull();
  });
});

describe('findEjectOutcome', () => {
  it('returns null when the command log is not loaded or errored', () => {
    expect(findEjectOutcome(null, new Set(), LIVE_ID)).toBeNull();
    expect(findEjectOutcome({ error: true, url: 'x', status: 500 }, new Set(), LIVE_ID)).toBeNull();
  });

  it('accepts object args as well as JSON-string args', () => {
    const log = makeLog([ejectTrace({ args: { diskId: LIVE_ID }, status: 'ok' })]);
    expect(findEjectOutcome(log, new Set(), LIVE_ID)).toEqual({ kind: 'ok' });
  });

  it('skips traces already in the baseline', () => {
    const log = makeLog([PRIOR_TRACE]);
    expect(findEjectOutcome(log, traceIdSnapshot(log), LIVE_ID)).toBeNull();
  });
});

// ── System disk gate ────────────────────────────────────────────────────────
describe('NetworkTree eject — system disk (idea#152)', () => {
  afterEach(() => cleanup());

  it('shows no eject button for a disk with diskTypes [system] and a device', () => {
    const systemDisk: Disk = {
      ...liveDisk,
      id: 'DISK_SYSTEM',
      name: 'System Disk',
      device: 'sda2',
      diskTypes: ['system'],
    };
    const store: Store = { ...fixtureStore, diskDB: { [systemDisk.id]: systemDisk } as Store['diskDB'] };
    const { container } = render(() => (
      <NetworkTree
        store={() => store}
        selection={{ type: 'network', id: '' }}
        onSelect={() => {}}
        dragData={() => null}
        onDrop={() => {}}
      />
    ));
    const row = container.querySelector('[data-disk-id="DISK_SYSTEM"]');
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain('System Disk');
    expect(row!.querySelector('.tree-item__eject-btn')).toBeNull();
  });
});

// ── Undock → re-dock of the same disk ID ───────────────────────────────────
// Mirrors the Engine: undock sets dockedTo = null and device = null on the
// same diskDB record (usbDeviceMonitor); re-dock (createOrUpdateDisk) sets
// dockedTo/device again on the same disk ID. Each update is a new store
// snapshot, as the Automerge 'change' listener delivers.
describe('NetworkTree — undock then re-dock the same disk ID (idea#152)', () => {
  const liveOnly: Store = { ...fixtureStore, diskDB: { [LIVE_ID]: liveDisk } as Store['diskDB'] };

  const withLive = (s: Store, patch: Partial<Disk>): Store => ({
    ...s,
    diskDB: { ...s.diskDB, [LIVE_ID]: { ...s.diskDB[LIVE_ID], ...patch } } as Store['diskDB'],
  });
  const UNDOCKED: Partial<Disk> = { dockedTo: null, device: null };
  const REDOCKED: Partial<Disk> = { dockedTo: ENGINE_ID, device: 'sdb1', lastDocked: 3 };

  const setup = (initial: Store = liveOnly) => {
    const [store, setStore] = createSignal<Store | null>(initial);
    const [log, setLog] = createSignal<CommandLogState>(makeLog([]));
    const sent = vi.fn();
    setSendCommandFn(sent);
    const utils = render(() => (
      <NetworkTree
        store={store}
        selection={{ type: 'network', id: '' }}
        onSelect={() => {}}
        dragData={() => null}
        onDrop={() => {}}
        commandLogStore={log}
      />
    ));
    const rows = () => utils.container.querySelectorAll(`[data-disk-id="${LIVE_ID}"]`);
    const liveEjectBtn = () => rows()[0]?.querySelector<HTMLButtonElement>('.tree-item__eject-btn') ?? null;
    return { ...utils, store, setStore, setLog, sent, rows, liveEjectBtn };
  };

  const expectExactlyOneRowWithEject = (t: ReturnType<typeof setup>) => {
    expect(t.rows()).toHaveLength(1);
    expect(t.liveEjectBtn()).not.toBeNull();
    expect(t.container.querySelector('.tree-item__eject-notice')).toBeNull();
  };

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('row disappears on undock and comes back exactly once on re-dock', () => {
    const t = setup();
    expectExactlyOneRowWithEject(t);
    t.setStore(withLive(t.store()!, UNDOCKED));
    expect(t.rows()).toHaveLength(0);
    t.setStore(withLive(t.store()!, REDOCKED));
    expectExactlyOneRowWithEject(t);
  });

  it('after a button eject that succeeds, re-dock brings the row back once with no stale notice', () => {
    const t = setup();
    fireEvent.click(t.liveEjectBtn()!);
    confirmEjectOk(t.container);
    expect(t.sent).toHaveBeenCalledWith(ENGINE_ID, `ejectDisk ${LIVE_ID}`);
    // Engine undocks and closes the trace ok
    t.setStore(withLive(t.store()!, UNDOCKED));
    t.setLog(makeLog([ejectTrace({ status: 'ok' })]));
    expect(t.rows()).toHaveLength(0);
    // Re-plug within the 15 s pending window
    vi.advanceTimersByTime(5_000);
    t.setStore(withLive(t.store()!, REDOCKED));
    expectExactlyOneRowWithEject(t);
    // The old pending timer must not surface a note on the new row
    vi.advanceTimersByTime(EJECT_TIMEOUT_MS * 2);
    expectExactlyOneRowWithEject(t);
  });

  it('re-dock while the eject is still pending (no trace seen) shows the row once, no timeout note', () => {
    const t = setup();
    fireEvent.click(t.liveEjectBtn()!);
    confirmEjectOk(t.container);
    t.setStore(withLive(t.store()!, UNDOCKED));
    expect(t.rows()).toHaveLength(0);
    t.setStore(withLive(t.store()!, REDOCKED));
    vi.advanceTimersByTime(EJECT_TIMEOUT_MS * 2);
    expectExactlyOneRowWithEject(t);
  });

  it('re-dock after the no-response note was showing gives a fresh row once', () => {
    const t = setup();
    fireEvent.click(t.liveEjectBtn()!);
    confirmEjectOk(t.container);
    vi.advanceTimersByTime(EJECT_TIMEOUT_MS);
    expect(t.container.querySelector('.tree-item__eject-notice')?.textContent).toContain('No response');
    t.setStore(withLive(t.store()!, UNDOCKED));
    expect(t.rows()).toHaveLength(0);
    expect(t.container.querySelector('.tree-item__eject-notice')).toBeNull();
    t.setStore(withLive(t.store()!, REDOCKED));
    expectExactlyOneRowWithEject(t);
  });

  it('if undock clears only device (dockedTo kept), the button hides and returns on re-dock', () => {
    const t = setup();
    fireEvent.click(t.liveEjectBtn()!);
    confirmEjectOk(t.container);
    t.setStore(withLive(t.store()!, { device: null }));
    t.setLog(makeLog([ejectTrace({ status: 'ok' })]));
    expect(t.rows()).toHaveLength(1);
    expect(t.liveEjectBtn()).toBeNull();
    t.setStore(withLive(t.store()!, { device: 'sdb1' }));
    expectExactlyOneRowWithEject(t);
  });

  it('re-dock with a stale same-name record present still shows the live row once', () => {
    const t = setup(fixtureStore);
    fireEvent.click(t.liveEjectBtn()!);
    confirmEjectOk(t.container);
    t.setStore(withLive(t.store()!, UNDOCKED));
    t.setLog(makeLog([ejectTrace({ status: 'ok' })]));
    t.setStore(withLive(t.store()!, REDOCKED));
    vi.advanceTimersByTime(EJECT_TIMEOUT_MS * 2);
    expectExactlyOneRowWithEject(t);
    // Stale record keeps its own (button-less) row; no duplicate of either ID
    expect(t.container.querySelectorAll(`[data-disk-id="${STALE_ID}"]`)).toHaveLength(1);
    expect(t.container.querySelectorAll('.tree-item--disk')).toHaveLength(2);
  });

  it('repeated eject/re-dock cycles never duplicate the row', () => {
    const t = setup();
    for (let i = 0; i < 3; i++) {
      fireEvent.click(t.liveEjectBtn()!);
    confirmEjectOk(t.container);
      t.setStore(withLive(t.store()!, UNDOCKED));
      t.setLog(makeLog([ejectTrace({ traceId: `trace-cycle-${i}`, status: 'ok' })]));
      expect(t.rows()).toHaveLength(0);
      t.setStore(withLive(t.store()!, REDOCKED));
      expectExactlyOneRowWithEject(t);
    }
  });
});

// ── Engine older than #134 (idea#129 Lead decision) ─────────────────────────
// Eject is not gated by 'diskIdArgs': it always sends the disk ID. An Engine
// from before agent-engine-dev#134 looks the argument up by name, so it
// refuses the ID; the refusal shows inline and nothing is ejected.
describe('NetworkTree eject — Engine older than #134, no capabilities (idea#129)', () => {
  const preEngine = fixtureStore.engineDB[ENGINE_ID];
  const NOT_FOUND = `Disk '${LIVE_ID}' not found.`;

  beforeEach(() => { expect(preEngine.capabilities).toBeUndefined(); });
  afterEach(() => cleanup());

  const setup = (disks: Disk[]) => {
    const [store] = createSignal<Store | null>({
      ...fixtureStore,
      diskDB: Object.fromEntries(disks.map((d) => [d.id, d])) as Store['diskDB'],
    });
    const [log, setLog] = createSignal<CommandLogState>(makeLog([]));
    const sent = vi.fn();
    setSendCommandFn(sent);
    const utils = render(() => (
      <NetworkTree
        store={store}
        selection={{ type: 'network', id: '' }}
        onSelect={() => {}}
        dragData={() => null}
        onDrop={() => {}}
        commandLogStore={log}
      />
    ));
    return { ...utils, store, setLog, sent };
  };

  it.each([
    ['unique name', [liveDisk]],
    ['shared name (idea03 system-boot)', [staleDisk, liveDisk]],
  ])('sends ejectDisk <diskId>, never the name, and is not greyed out (%s)', (_label, disks) => {
    const t = setup(disks);
    const btn = ejectButton(t.container);
    expect(btn).not.toBeDisabled();
    expect(btn.getAttribute('title')).toBe('Eject system-boot');
    fireEvent.click(btn);
    confirmEjectOk(t.container);
    expect(t.sent).toHaveBeenCalledOnce();
    expect(t.sent).toHaveBeenCalledWith(ENGINE_ID, `ejectDisk ${LIVE_ID}`);
    expect(t.sent).not.toHaveBeenCalledWith(ENGINE_ID, 'ejectDisk system-boot');
  });

  it.each([
    ["an 'error' trace", ejectTrace({ status: 'error', errorMessage: NOT_FOUND })],
    ["an 'ok' trace with an error line", ejectTrace({
      status: 'ok',
      logs: [{ level: 'error', message: `\u001b[31m${NOT_FOUND}\u001b[39m`, timestamp: 1 }],
    })],
  ])('refusal as %s shows inline under the row; the disk stays docked', (_label, trace) => {
    const t = setup([liveDisk]);
    ejectAndConfirm(t.container);
    expect(t.sent).toHaveBeenCalledWith(ENGINE_ID, `ejectDisk ${LIVE_ID}`);
    // The old Engine refuses; it does not touch the store
    t.setLog(makeLog([trace]));

    const row = t.container.querySelector(`[data-disk-id="${LIVE_ID}"]`);
    expect(row).not.toBeNull();
    const n = notice(t.container);
    expect(n).not.toBeNull();
    expect(n!.getAttribute('role')).toBe('alert');
    expect(n!.textContent).toContain(`Couldn't eject system-boot`);
    expect(n!.textContent).toContain(NOT_FOUND);
    // The notice sits directly under the disk row
    expect(row!.nextElementSibling).toBe(n);

    // Still present and docked: nothing was ejected
    const d = t.store()!.diskDB[LIVE_ID];
    expect(d.dockedTo).toBe(ENGINE_ID);
    expect(d.device).toBe('sdb1');
    expect(t.container.querySelectorAll(`[data-disk-id="${LIVE_ID}"]`)).toHaveLength(1);
    expect(ejectButton(t.container)).not.toBeDisabled();
  });
});
