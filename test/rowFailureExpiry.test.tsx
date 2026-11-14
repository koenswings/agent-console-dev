/**
 * idea#498 follow-up to #201: the failed-op message on an app's row clears on
 * a newer finished op, expires 24 h after the failure, and hides when dismissed.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import InstanceRow from '../src/components/InstanceRow';
import { MOCK_FILES_STORE, FILES_IDS as I } from '../src/mock/filesFixtures';
import { tickLiveNow } from '../src/store/live';
import { dismissOp } from '../src/store/dismissedOps';
import { ROW_FAILURE_TTL_MS, latestRowFailure, opFinishedAt } from '../src/store/rowFailure';
import type { App, Engine, Instance, Operation, OperationKind, OperationStatus, Store } from '../src/types/store';

afterEach(() => { cleanup(); tickLiveNow(); });

const T0 = 1_800_000_000_000;
const INST = I.INST_NC_A;
/** An Engine id with no record and no hb, so the expiry uses the Console clock tick. */
const NO_CLOCK_ENGINE = 'ENGINE_NO_CLOCK';

const op = (id: string, kind: OperationKind, status: OperationStatus, completedAt: number | null, startedAt = (completedAt ?? T0) - 1_000, engineId = NO_CLOCK_ENGINE): Operation => ({
  id, kind, args: { instanceId: INST }, cause: 'user', subject: { type: 'instance', id: INST },
  engineId, status, progressPercent: null, currentStep: null, totalSteps: null, stepLabel: null,
  startedAt, completedAt, error: status === 'Failed' ? `${id} broke` : null,
} as Operation);

const storeWith = (ops: Operation[], patch: Partial<Store> = {}): Store => ({
  ...MOCK_FILES_STORE,
  operationDB: Object.fromEntries(ops.map((o) => [o.id, o])),
  ...patch,
} as Store);

const renderRow = (store: Store) => {
  const instance = () => store.instanceDB[INST] as Instance;
  const app = () => store.appDB[instance().instanceOf] as App;
  const engine = () => store.engineDB[I.ENGINE_A] as Engine;
  return render(() => <InstanceRow instanceId={INST} instance={instance} app={app} engine={engine} store={() => store} />);
};
const rowFailure = (c: HTMLElement) => c.querySelector('.instance-row__progress--failed')?.textContent ?? null;

describe('row failure message expiry (idea#498)', () => {
  it('a recent failure still shows', () => {
    tickLiveNow(T0 + 60_000);
    const { container } = renderRow(storeWith([op('opA', 'backupApp', 'Failed', T0)]));
    expect(rowFailure(container)).toContain('opA broke');
  });

  it('a newer Done op of any kind clears it', () => {
    tickLiveNow(T0 + 60_000);
    const { container } = renderRow(storeWith([
      op('opA', 'backupApp', 'Failed', T0),
      op('opB', 'startApp', 'Done', T0 + 10_000),
    ]));
    expect(rowFailure(container)).toBeNull();
  });

  it('a newer Cancelled op clears it; an older Done op does not', () => {
    tickLiveNow(T0 + 60_000);
    const a = renderRow(storeWith([op('opA', 'backupApp', 'Failed', T0), op('opC', 'stopApp', 'Cancelled', T0 + 1)]));
    expect(rowFailure(a.container)).toBeNull();
    cleanup();
    const b = renderRow(storeWith([op('opA', 'backupApp', 'Failed', T0), op('opD', 'startApp', 'Done', T0 - 1)]));
    expect(rowFailure(b.container)).toContain('opA broke');
  });

  it('a newer Failed op replaces it', () => {
    tickLiveNow(T0 + 60_000);
    const { container } = renderRow(storeWith([
      op('opA', 'backupApp', 'Failed', T0),
      op('opB', 'restoreApp', 'Failed', T0 + 5_000),
    ]));
    const text = rowFailure(container);
    expect(text).toContain('opB broke');
    expect(text).not.toContain('opA broke');
  });

  it('an op with no finish time compares by its start time', () => {
    const late = op('opL', 'startApp', 'Done', null, T0 + 5_000);
    expect(opFinishedAt(late)).toBe(T0 + 5_000);
    const s = storeWith([op('opA', 'backupApp', 'Failed', T0), late]);
    expect(latestRowFailure(s, INST, () => true)).toBeNull();
  });

  it('hides 24 h after the failure (fake clock on the shared tick)', () => {
    tickLiveNow(T0 + ROW_FAILURE_TTL_MS - 5_000);
    const { container } = renderRow(storeWith([op('opA', 'backupApp', 'Failed', T0)]));
    expect(rowFailure(container)).toContain('opA broke');
    tickLiveNow(T0 + ROW_FAILURE_TTL_MS);
    expect(rowFailure(container)).toBeNull();
  });

  it('measures the 24 h on the op Engine clock when known, not the Console clock', () => {
    // Console clock is 2 days ahead; the Engine (stored lastRun, no hb) says only 1 h passed.
    tickLiveNow(T0 + 2 * ROW_FAILURE_TTL_MS);
    const engineDB = { ...MOCK_FILES_STORE.engineDB, [I.ENGINE_A]: { ...MOCK_FILES_STORE.engineDB[I.ENGINE_A], lastRun: T0 + 3_600_000 } };
    const { container } = renderRow(storeWith([op('opA', 'backupApp', 'Failed', T0, T0 - 1_000, I.ENGINE_A)], { engineDB } as Partial<Store>));
    expect(rowFailure(container)).toContain('opA broke');
  });

  it('hides when the user dismissed that op card locally', () => {
    tickLiveNow(T0 + 60_000);
    const { container } = renderRow(storeWith([op('opA', 'backupApp', 'Failed', T0)]));
    expect(rowFailure(container)).toContain('opA broke');
    dismissOp('opA');
    expect(rowFailure(container)).toBeNull();
  });
});
