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

describe('NetworkTree eject — sends the disk ID (idea#152)', () => {
  let sent: ReturnType<typeof vi.fn>;
  beforeEach(() => { sent = vi.fn(); setSendCommandFn(sent); });
  afterEach(() => cleanup());

  it('sends ejectDisk <id> for the docked disk, not its (duplicated) name', () => {
    const { container } = renderTree(() => makeLog([]));
    expect(container.querySelectorAll('.tree-item--disk')).toHaveLength(2);
    fireEvent.click(ejectButton(container));
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
    fireEvent.click(ejectButton(container));
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
    fireEvent.click(ejectButton(container));
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
    fireEvent.click(ejectButton(container));
    setLog(makeLog([ejectTrace({ status: 'error', errorMessage: 'boom' })]));
    fireEvent.click(notice(container)!);
    expect(notice(container)).toBeNull();
  });

  it('clears the error on the next eject attempt', () => {
    const [log, setLog] = createSignal<CommandLogState>(makeLog([]));
    const { container } = renderTree(log);
    fireEvent.click(ejectButton(container));
    setLog(makeLog([ejectTrace({ status: 'error', errorMessage: 'boom' })]));
    expect(notice(container)).not.toBeNull();
    fireEvent.click(ejectButton(container));
    expect(notice(container)).toBeNull();
  });

  it('shows nothing when the eject succeeds', () => {
    const [log, setLog] = createSignal<CommandLogState>(makeLog([PRIOR_TRACE]));
    const { container } = renderTree(log);
    fireEvent.click(ejectButton(container));
    setLog(makeLog([PRIOR_TRACE, ejectTrace({ status: 'ok' })]));
    expect(notice(container)).toBeNull();
    vi.advanceTimersByTime(EJECT_TIMEOUT_MS + 1000);
    expect(notice(container)).toBeNull();
  });

  it('shows a gentle no-response note after 15 s without a trace', () => {
    const [log] = createSignal<CommandLogState>(makeLog([]));
    const { container } = renderTree(log);
    fireEvent.click(ejectButton(container));
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
    fireEvent.click(ejectButton(container));
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
