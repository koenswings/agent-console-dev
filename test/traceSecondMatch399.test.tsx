/**
 * engine#399 follow-up to #206: a second match value. An instance sent by NAME is
 * matched by id on a traceInstanceId Engine (instanceName on an older one), and the
 * sent name also matches:
 * (a) a name that did not resolve on a new Engine (instanceId = the raw name, instanceName null);
 * (b) a refusal before execution (positional tokens; a multi-word name is split on spaces).
 * The instance's disk sent (diskId / sourceDiskId) must be present too, so namesakes on other disks never match.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import { createRoot, createSignal } from 'solid-js';
import { setSendCommandFn } from '../src/store/commands';
import { COMMAND_RESULT_TIMEOUT_MS, createCommandResult, findCommandOutcome, traceMatchesArg } from '../src/store/commandResult';
import { traceInstanceMatch, TRACE_INSTANCE_ID_CAPABILITY } from '../src/store/traceInstance';
import { createDragCopyMove } from '../src/store/dragCopyMove';
import InstanceRow from '../src/components/InstanceRow';
import MobileAppList from '../src/components/MobileAppList';
import { MOCK_IDS, MOCK_STORE } from '../src/mock/mockStore';
import type { CommandLogState } from '../src/store/commandLog';
import type { CommandLogStore, CommandTrace } from '../src/types/commandLog';
import type { Engine, Status, Store } from '../src/types/store';

const KOLIBRI = MOCK_IDS.INST_KOLIBRI_ID; // on DISK_1 (ENGINE_1)
const NEXTCLOUD = MOCK_IDS.INST_NEXTCLOUD_ID; // on DISK_2 (ENGINE_2)
const E1 = MOCK_IDS.ENGINE_1_ID;
const E2 = MOCK_IDS.ENGINE_2_ID;
const D1 = MOCK_IDS.DISK_1_ID;
const D2 = MOCK_IDS.DISK_2_ID;
const D3 = MOCK_IDS.DISK_3_ID;
const SPACED = 'My Kolibri App';
const SPACED_TOKENS = SPACED.split(' ');

const withCap = (e: Engine): Engine => ({
  ...e, capabilities: [...(e.capabilities ?? []), TRACE_INSTANCE_ID_CAPABILITY], capabilitiesBootedAt: e.lastBooted,
} as Engine);
const oldEngine = (e: Engine): Engine => ({
  ...e, capabilities: (e.capabilities ?? []).filter((c) => c !== TRACE_INSTANCE_ID_CAPABILITY),
} as Engine);
const storeFor = (fresh: boolean, over: { kolibriName?: string; nextcloudName?: string; status?: Status } = {}): Store => {
  const pick = fresh ? withCap : oldEngine;
  const k = MOCK_STORE.instanceDB[KOLIBRI];
  const n = MOCK_STORE.instanceDB[NEXTCLOUD];
  return {
    ...MOCK_STORE,
    operationDB: {},
    engineDB: { ...MOCK_STORE.engineDB, [E1]: pick(MOCK_STORE.engineDB[E1]), [E2]: pick(MOCK_STORE.engineDB[E2]) },
    instanceDB: {
      ...MOCK_STORE.instanceDB,
      [KOLIBRI]: { ...k, name: over.kolibriName ?? k.name, status: over.status ?? k.status },
      [NEXTCLOUD]: { ...n, name: over.nextcloudName ?? n.name },
    },
  };
};

const trace = (id: string, over: Partial<CommandTrace>): CommandTrace => ({
  traceId: id, command: 'startInstance', args: {}, startedAt: 0, completedAt: 0,
  status: 'error', errorMessage: 'refused', logs: [], ...over,
});
const log = (...traces: CommandTrace[]): CommandLogStore => ({
  traces: Object.fromEntries(traces.map((t) => [t.traceId, t])),
  recentTraceIds: traces.map((t) => t.traceId),
});
const positional = (...tokens: string[]) => JSON.stringify(tokens);

/** Match a trace the way a reader does (helper + traceMatchesArg). */
const matches = (fresh: boolean, t: CommandTrace, instanceId: string, sent: string, disk: string, engineId = E1) => {
  const m = traceInstanceMatch(storeFor(fresh), engineId, instanceId, sent, disk);
  return traceMatchesArg(t, m.argKey, m.argValue, 'key', m.altMatch);
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setSendCommandFn(() => {});
});

// ---------------------------------------------------------------------------
describe('(a) a name that did not resolve', () => {
  const unresolvedStart = (name: string, disk: string, instanceName: string | null = null) =>
    trace('t', { args: { instanceId: name, diskId: disk, options: [], instanceName } });

  it('new Engine: start / stop (instanceId = the raw name, instanceName null) match', () => {
    expect(matches(true, unresolvedStart('kolibri', D1), KOLIBRI, 'kolibri', D1)).toBe(true);
    expect(matches(true, trace('t', { command: 'stopInstance', args: { instanceId: 'kolibri', diskId: D1, instanceName: null } }), KOLIBRI, 'kolibri', D1)).toBe(true);
  });

  it('new Engine: copy / move match', () => {
    for (const command of ['copyApp', 'moveApp']) {
      const t = trace('t', { command, args: { instanceId: 'nextcloud', sourceDiskId: D2, targetDiskId: D1, instanceName: null } });
      expect(matches(true, t, NEXTCLOUD, 'nextcloud', D2, E2)).toBe(true);
    }
  });

  it('new Engine: without the second value (#206) the same trace is missed', () => {
    const m = traceInstanceMatch(storeFor(true), E1, KOLIBRI, 'kolibri', D1);
    expect(traceMatchesArg(unresolvedStart('kolibri', D1), m.argKey, m.argValue)).toBe(false);
  });

  it('old Engine: an unresolved name is still under instanceName (as before)', () => {
    expect(matches(false, trace('t', { args: { instanceName: 'kolibri', diskId: D1 } }), KOLIBRI, 'kolibri', D1)).toBe(true);
  });

  it('negative: the same name refused on another disk (a namesake) is not ours', () => {
    expect(matches(true, unresolvedStart('kolibri', D3), KOLIBRI, 'kolibri', D1)).toBe(false);
    expect(matches(false, trace('t', { args: positional('kolibri', D3) }), KOLIBRI, 'kolibri', D1)).toBe(false);
  });

  it('negative: a resolved namesake (its own id) is not ours', () => {
    expect(matches(true, trace('t', { args: { instanceId: 'other-id', diskId: D1, instanceName: 'kolibri' } }), KOLIBRI, 'kolibri', D1)).toBe(false);
  });

  it('negative: another instance whose id equals our name (resolved, instanceName set) is not ours', () => {
    expect(matches(true, trace('t', { args: { instanceId: 'kolibri', diskId: D1, instanceName: 'Some Other App' } }), KOLIBRI, 'kolibri', D1)).toBe(false);
  });

  it('commandResult: an unresolved start shows the refusal on a new Engine, and the old shape on an old one', () => {
    for (const fresh of [true, false]) {
      vi.useFakeTimers();
      const t = createRoot((dispose) => {
        const [cls, setCls] = createSignal<CommandLogState>(log());
        const r = createCommandResult({ commandLog: cls, command: 'startInstance' });
        return { r, setCls, dispose };
      });
      const m = traceInstanceMatch(storeFor(fresh), E1, KOLIBRI, 'kolibri', D1);
      t.r.start(m.argValue, () => {}, { argKey: m.argKey, altMatch: m.altMatch });
      t.setCls(log(fresh
        ? trace('t', { args: { instanceId: 'kolibri', diskId: D1, options: [], instanceName: null }, errorMessage: "Instance 'kolibri' not found" })
        : trace('t', { args: { instanceName: 'kolibri', diskId: D1, options: [] }, errorMessage: "Instance 'kolibri' not found" })));
      vi.advanceTimersByTime(COMMAND_RESULT_TIMEOUT_MS + 1);
      expect(t.r.state()).toEqual({ kind: 'error', message: "Instance 'kolibri' not found" });
      vi.useRealTimers();
      t.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
describe('(b) a refusal before execution (positional tokens)', () => {
  for (const fresh of [true, false]) {
    const engine = fresh ? 'new Engine' : 'old Engine';

    it(`${engine}: a one-word name in the tokens matches (copy / move)`, () => {
      for (const command of ['copyApp', 'moveApp']) {
        const t = trace('t', { command, args: positional('nextcloud', D2, D1, 'extra'), errorMessage: 'Error: Too many arguments' });
        expect(matches(fresh, t, NEXTCLOUD, 'nextcloud', D2, E2)).toBe(true);
      }
    });

    it(`${engine}: a multi-word name arrives split on spaces and matches as a run`, () => {
      const t = trace('t', { command: 'moveApp', args: positional(...SPACED_TOKENS, D2, D1), errorMessage: 'Error: Too many arguments' });
      expect(matches(fresh, t, NEXTCLOUD, SPACED, D2, E2)).toBe(true);
      // stopInstance has a fixed arity too
      const s = trace('t', { command: 'stopInstance', args: positional(...SPACED_TOKENS, D1) });
      expect(matches(fresh, s, KOLIBRI, SPACED, D1)).toBe(true);
    });

    it(`${engine}: negative — other words, other order, a missing word or another disk`, () => {
      const mk = (...tokens: string[]) => trace('t', { command: 'moveApp', args: positional(...tokens) });
      expect(matches(fresh, mk('My', 'Kolibri', 'Apps', D2, D1), NEXTCLOUD, SPACED, D2, E2)).toBe(false);
      expect(matches(fresh, mk('Kolibri', 'My', 'App', D2, D1), NEXTCLOUD, SPACED, D2, E2)).toBe(false);
      expect(matches(fresh, mk('My', 'App', D2, D1), NEXTCLOUD, SPACED, D2, E2)).toBe(false);
      expect(matches(fresh, mk(...SPACED_TOKENS, D3, D1), NEXTCLOUD, SPACED, D2, E2)).toBe(false);
      expect(matches(fresh, mk('nextcloud', D3, D1), NEXTCLOUD, 'nextcloud', D2, E2)).toBe(false);
    });

    it(`${engine}: negative — a namesake moving from another disk TO our disk`, () => {
      const t = trace('t', { command: 'moveApp', args: positional(...SPACED_TOKENS, D3, D2) });
      expect(matches(fresh, t, NEXTCLOUD, SPACED, D2, E2)).toBe(false);
      const named = fresh
        ? { instanceId: 'nextcloud', sourceDiskId: D3, targetDiskId: D2, instanceName: null }
        : { instanceName: 'nextcloud', sourceDiskId: D3, targetDiskId: D2 };
      expect(matches(fresh, trace('t', { command: 'moveApp', args: named }), NEXTCLOUD, 'nextcloud', D2, E2)).toBe(false);
    });

    it(`${engine}: startInstance (variadic options) puts a multi-word name across named args; still matched`, () => {
      // `startInstance My Kolibri App DISK1`: instanceId 'My', diskId 'Kolibri', options ['App', DISK1]
      const args = fresh
        ? { instanceId: 'My', diskId: 'Kolibri', options: ['App', D1], instanceName: null }
        : { instanceName: 'My', diskId: 'Kolibri', options: ['App', D1] };
      expect(matches(fresh, trace('t', { args }), KOLIBRI, SPACED, D1)).toBe(true);
      const elsewhere = { ...args, options: ['App', D3] };
      expect(matches(fresh, trace('t', { args: elsewhere }), KOLIBRI, SPACED, D1)).toBe(false);
    });
  }

  it('new Engine: the id-only match (#206) missed the positional refusal; old Engine: name matching caught it', () => {
    const t = trace('t', { command: 'copyApp', args: positional('nextcloud', D2, D1, 'x') });
    const fresh = traceInstanceMatch(storeFor(true), E2, NEXTCLOUD, 'nextcloud', D2);
    expect(findCommandOutcome(log(t), new Set(), 'copyApp', fresh.argKey, fresh.argValue)).toBeNull();
    expect(findCommandOutcome(log(t), new Set(), 'copyApp', fresh.argKey, fresh.argValue, 'key', fresh.altMatch))
      .toEqual({ kind: 'error', message: 'refused' });
  });

  it('a refusal holding only the name ("Insufficient arguments") still matches on both Engines', () => {
    for (const fresh of [true, false]) {
      expect(matches(fresh, trace('t', { args: positional('kolibri') }), KOLIBRI, 'kolibri', D1)).toBe(true);
      expect(matches(fresh, trace('t', { args: positional(...SPACED_TOKENS) }), KOLIBRI, SPACED, D1)).toBe(true);
    }
  });

  it('old Engine, named args: a namesake on another disk no longer matches the name', () => {
    expect(matches(false, trace('t', { args: { instanceName: 'kolibri', diskId: D3 } }), KOLIBRI, 'kolibri', D1)).toBe(false);
    expect(matches(false, trace('t', { args: { instanceName: 'kolibri', diskId: D1 } }), KOLIBRI, 'kolibri', D1)).toBe(true);
  });

  it('backup / restore send the id: no second value', () => {
    expect(traceInstanceMatch(storeFor(true), E1, KOLIBRI, KOLIBRI, D1).altMatch).toBeUndefined();
    expect(traceInstanceMatch(storeFor(false), E1, KOLIBRI, KOLIBRI, D1).altMatch).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe('InstanceRow start / stop', () => {
  const setup = (fresh: boolean, status: Status, name = 'kolibri') => {
    const store = storeFor(fresh, { kolibriName: name, status });
    const [cls, setCls] = createSignal<CommandLogState>(log());
    const send = vi.fn();
    setSendCommandFn(send);
    render(() => (
      <InstanceRow
        instanceId={KOLIBRI}
        instance={() => store.instanceDB[KOLIBRI]}
        app={() => store.appDB[store.instanceDB[KOLIBRI].instanceOf]}
        engine={() => store.engineDB[E1]}
        store={() => store}
        commandLogStore={cls}
      />
    ));
    return { setCls, send };
  };
  const alert = () => screen.queryByTestId(`instance-cmd-${KOLIBRI}-error`);

  it('(a) new Engine: an unresolved start shows the refusal, not a timeout', () => {
    vi.useFakeTimers();
    const { setCls } = setup(true, 'Stopped');
    fireEvent.click(screen.getByTestId(`start-instance-${KOLIBRI}`));
    setCls(log(trace('t', { args: { instanceId: 'kolibri', diskId: D1, options: [], instanceName: null }, errorMessage: "Instance 'kolibri' not found" })));
    vi.advanceTimersByTime(COMMAND_RESULT_TIMEOUT_MS + 1);
    expect(alert()?.textContent).toContain('not found');
    expect(screen.queryByTestId(`instance-cmd-${KOLIBRI}-timeout`)).not.toBeInTheDocument();
  });

  it('(a) old Engine: the same refusal (instanceName = the name) is shown', () => {
    const { setCls } = setup(false, 'Stopped');
    fireEvent.click(screen.getByTestId(`start-instance-${KOLIBRI}`));
    setCls(log(trace('t', { args: { instanceName: 'kolibri', diskId: D1, options: [] }, errorMessage: "Instance 'kolibri' not found" })));
    expect(alert()?.textContent).toContain('not found');
  });

  for (const fresh of [true, false]) {
    it(`(b) ${fresh ? 'new' : 'old'} Engine: a multi-word stop refused before execution is shown`, () => {
      const { setCls, send } = setup(fresh, 'Running', SPACED);
      fireEvent.click(screen.getByTestId(`stop-instance-${KOLIBRI}`));
      expect(send).toHaveBeenCalledWith(E1, `stopInstance ${SPACED} ${D1}`);
      setCls(log(trace('t', { command: 'stopInstance', args: positional(...SPACED_TOKENS, D1), errorMessage: 'Error: Too many arguments' })));
      expect(alert()).toBeInTheDocument();
    });
  }

  it('negative (new Engine): a namesake refused on another disk, or resolved to another id, is not shown', () => {
    const { setCls } = setup(true, 'Stopped');
    fireEvent.click(screen.getByTestId(`start-instance-${KOLIBRI}`));
    setCls(log(
      trace('a', { args: { instanceId: 'kolibri', diskId: D3, options: [], instanceName: null } }),
      trace('b', { args: { instanceId: 'other-id', diskId: D1, options: [], instanceName: 'kolibri' } }),
      trace('c', { args: positional('kolibri', D3, 'x') }),
    ));
    expect(alert()).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('MobileAppList start', () => {
  for (const fresh of [true, false]) {
    it(`(a) ${fresh ? 'new' : 'old'} Engine: an unresolved start refusal is shown on the card`, () => {
      const store = storeFor(fresh, { status: 'Stopped' });
      const [cls, setCls] = createSignal<CommandLogState>(log());
      setSendCommandFn(vi.fn());
      render(() => <MobileAppList store={() => store} commandLogStore={cls} />);
      const card = screen.getByText('kolibri').closest('.mobile-app-card') as HTMLElement;
      const startBtn = Array.from(card.querySelectorAll('button')).find((b) => /Start/.test(b.textContent ?? '')) as HTMLElement;
      fireEvent.click(startBtn);
      setCls(log(trace('t', {
        args: fresh ? { instanceId: 'kolibri', diskId: D1, options: [], instanceName: null } : { instanceName: 'kolibri', diskId: D1, options: [] },
        errorMessage: "Instance 'kolibri' not found",
      })));
      expect(screen.getByTestId(`mobile-instance-cmd-${KOLIBRI}-error`).textContent).toContain('not found');
    });
  }
});

// ---------------------------------------------------------------------------
describe('drag copy / move', () => {
  const setup = (fresh: boolean, name = 'nextcloud') => createRoot((dispose) => {
    const store = storeFor(fresh, { nextcloudName: name });
    const [cls, setCls] = createSignal<CommandLogState>(log());
    const send = vi.fn();
    setSendCommandFn(send);
    const ctl = createDragCopyMove(() => store, cls);
    return { ctl, setCls, send, dispose };
  });
  const drop = (ctl: ReturnType<typeof createDragCopyMove>, op: 'copy' | 'move', name = 'nextcloud') => {
    ctl.handleDrop({ instanceId: NEXTCLOUD, instanceName: name, sourceDiskId: D2, sourceDiskName: 'src' }, D1);
    ctl.choose(op);
  };

  it('(a) new Engine: an unresolved copy is caught', () => {
    const t = setup(true);
    drop(t.ctl, 'copy');
    t.setCls(log(trace('t', { command: 'copyApp', args: { instanceId: 'nextcloud', sourceDiskId: D2, targetDiskId: D1, instanceName: null } })));
    expect(t.ctl.result.state()).toMatchObject({ kind: 'error' });
    t.dispose();
  });

  for (const fresh of [true, false]) {
    it(`(b) ${fresh ? 'new' : 'old'} Engine: a multi-word move refused before execution is caught`, () => {
      const t = setup(fresh, SPACED);
      drop(t.ctl, 'move', SPACED);
      expect(t.send).toHaveBeenCalledWith(E2, `moveApp ${SPACED} ${D2} ${D1}`);
      t.setCls(log(trace('t', { command: 'moveApp', args: positional(...SPACED_TOKENS, D2, D1), errorMessage: 'Error: Too many arguments' })));
      expect(t.ctl.result.state()).toMatchObject({ kind: 'error' });
      t.dispose();
    });

    it(`negative ${fresh ? 'new' : 'old'} Engine: a namesake's refusal on other disks is ignored`, () => {
      const t = setup(fresh, SPACED);
      drop(t.ctl, 'move', SPACED);
      t.setCls(log(
        trace('a', { command: 'moveApp', args: positional(...SPACED_TOKENS, D3, D1) }),
        trace('b', { command: 'moveApp', args: { instanceId: SPACED, sourceDiskId: D3, targetDiskId: D1, instanceName: null } }),
      ));
      expect(t.ctl.result.state().kind).not.toBe('error');
      t.dispose();
    });
  }
});
