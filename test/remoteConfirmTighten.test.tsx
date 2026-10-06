/**
 * r30 caveat 3: no false greens from store confirmation.
 *
 * Only an operation / instance CREATED after the send confirms (id unseen at
 * send time, matching attributes, Engine-clock fresh; never compared with the
 * Console clock), and start/stop only confirm on a status transition observed
 * after the send (or a NEW startApp/stopApp op Done).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { setSendCommandFn } from '../src/store/commands';
import {
  ENGINE_CLOCK_SLACK_MS,
  confirmInstalled,
  confirmInstanceStatus,
  confirmNewOperation,
  confirmRebooted,
  instanceStoredOn,
  lastBackupAdvanced,
  newInstanceOnDisk,
} from '../src/store/remoteConfirm';
import RestorePanel from '../src/components/RestorePanel';
import { MOCK_IDS, MOCK_STORE } from '../src/mock/mockStore';
import type { Instance, Operation, Status, Store } from '../src/types/store';

const E2 = MOCK_IDS.ENGINE_2_ID;
const NEXTCLOUD = MOCK_IDS.INST_NEXTCLOUD_ID; // app nextcloud, on DISK002 (E2)
const KOLIBRI = MOCK_IDS.INST_KOLIBRI_ID;
const TARGET = MOCK_IDS.DISK_3_ID; // also on E2
const MIN = 60_000;

const base = (): Store => ({ ...MOCK_STORE, operationDB: {} });
const engineClock = (s: Store) => Number(s.engineDB[E2].lastRun);
const withEngineClock = (s: Store, lastRun: number): Store => ({
  ...s, engineDB: { ...s.engineDB, [E2]: { ...s.engineDB[E2], lastRun } },
});
const withInstance = (s: Store, id: string, over: Partial<Instance>): Store => ({
  ...s,
  instanceDB: { ...s.instanceDB, [id]: { ...(s.instanceDB[id] ?? s.instanceDB[NEXTCLOUD]), id, ...over } as Instance },
});
const op = (id: string, over: Partial<Operation>): Operation => ({
  id, kind: 'copyApp', args: { instanceId: NEXTCLOUD, targetDiskId: TARGET }, cause: 'console-command',
  subject: { type: 'instance', id: NEXTCLOUD }, engineId: E2, status: 'Running', progressPercent: null,
  currentStep: null, totalSteps: null, stepLabel: null, startedAt: Date.now(), completedAt: null, error: null,
  ...over,
} as Operation);
const withOp = (s: Store, o: Operation): Store => ({ ...s, operationDB: { ...s.operationDB, [o.id]: o } });

afterEach(() => {
  cleanup();
  setSendCommandFn(() => {});
});

// ---------------------------------------------------------------------------
describe('confirmNewOperation: only an op created after the send', () => {
  it('a pre-existing op does not confirm, even when it finishes after the send', () => {
    const [s, setS] = createSignal(withOp(base(), op('old', { status: 'Running' })));
    const check = confirmNewOperation(s, 'copyApp', NEXTCLOUD, { engineId: E2, args: { targetDiskId: TARGET } });
    expect(check()).toBeNull();
    setS(withOp(s(), op('old', { status: 'Done' })));
    expect(check()).toBeNull();
    setS(withOp(s(), op('old', { status: 'Failed', error: 'old failure' })));
    expect(check()).toBeNull();
  });

  it('a newly created op confirms (Done → ok, Failed → red)', () => {
    const [s, setS] = createSignal(base());
    const check = confirmNewOperation(s, 'copyApp', NEXTCLOUD, { engineId: E2, args: { targetDiskId: TARGET } });
    setS(withOp(s(), op('new', { status: 'Running' })));
    expect(check()).toBeNull();
    setS(withOp(s(), op('new', { status: 'Done' })));
    expect(check()).toBe('ok');
    setS(withOp(s(), op('new', { status: 'Failed', error: 'rsync failed' })));
    expect(check()).toEqual({ error: 'rsync failed' });
  });

  it('a new op for another target disk, instance, kind or a non-command cause does not confirm', () => {
    const [s, setS] = createSignal(base());
    const check = confirmNewOperation(s, 'copyApp', NEXTCLOUD, { engineId: E2, args: { targetDiskId: TARGET } });
    setS(withOp(s(), op('a', { status: 'Done', args: { instanceId: NEXTCLOUD, targetDiskId: MOCK_IDS.DISK_1_ID } })));
    setS(withOp(s(), op('b', { status: 'Done', args: { instanceId: KOLIBRI, targetDiskId: TARGET } })));
    setS(withOp(s(), op('c', { status: 'Done', kind: 'moveApp' })));
    setS(withOp(s(), op('d', { status: 'Done', cause: 'disk-docked' })));
    expect(check()).toBeNull();
  });

  it('backupApp: an automatic backup (cause disk-docked) after the send does not confirm; ours does', () => {
    const [s, setS] = createSignal(base());
    const check = confirmNewOperation(s, 'backupApp', NEXTCLOUD, { engineId: E2, args: { backupDiskId: MOCK_IDS.DISK_4_ID } });
    setS(withOp(s(), op('auto', { kind: 'backupApp', status: 'Done', cause: 'disk-docked', args: { instanceId: NEXTCLOUD, backupDiskId: MOCK_IDS.DISK_4_ID } })));
    expect(check()).toBeNull();
    setS(withOp(s(), op('ours', { kind: 'backupApp', status: 'Done', args: { instanceId: NEXTCLOUD, backupDiskId: MOCK_IDS.DISK_4_ID } })));
    expect(check()).toBe('ok');
  });

  it('clock skew: compares with the SAME Engine\'s clock only, never the Console\'s', () => {
    // Engine clock 3 days behind the Console (Pi without RTC/NTP): a fresh op still confirms.
    const behind = Date.now() - 3 * 24 * 60 * MIN;
    const [s, setS] = createSignal(withEngineClock(base(), behind));
    const check = confirmNewOperation(s, 'copyApp', NEXTCLOUD, { engineId: E2, args: { targetDiskId: TARGET } });
    setS(withOp(s(), op('new', { status: 'Done', startedAt: behind + 1000 })));
    expect(check()).toBe('ok');
  });

  it('clock skew: an unseen op stamped long before the Engine\'s clock at send does not confirm; small lag does', () => {
    const [s, setS] = createSignal(base());
    const clock = engineClock(s());
    const check = confirmNewOperation(s, 'copyApp', NEXTCLOUD, { engineId: E2, args: { targetDiskId: TARGET } });
    setS(withOp(s(), op('late-replicated', { status: 'Done', startedAt: clock - ENGINE_CLOCK_SLACK_MS - MIN })));
    expect(check()).toBeNull();
    setS(withOp(s(), op('jitter', { status: 'Done', startedAt: clock - MIN })));
    expect(check()).toBe('ok');
  });

  it('no Engine clock known → the id snapshot alone decides', () => {
    const [s, setS] = createSignal(withEngineClock(base(), 0));
    const check = confirmNewOperation(s, 'copyApp', NEXTCLOUD, { engineId: E2, args: { targetDiskId: TARGET } });
    setS(withOp(s(), op('new', { status: 'Done', startedAt: 1 })));
    expect(check()).toBe('ok');
  });

  it('the fallback only counts when no op matched and is itself "created after send" based', () => {
    const [s, setS] = createSignal(withInstance(base(), 'pre-copy', { storedOn: TARGET, created: Date.now() }));
    const check = confirmNewOperation(s, 'copyApp', NEXTCLOUD, {
      engineId: E2, args: { targetDiskId: TARGET },
      fallbackOk: newInstanceOnDisk(s, TARGET, { instanceOf: String(s().instanceDB[NEXTCLOUD].instanceOf), name: 'nextcloud', engineId: E2 }),
    });
    expect(check()).toBeNull(); // 'pre-copy' existed at send
    setS(withInstance(s(), 'fresh-copy', { storedOn: TARGET, created: engineClock(s()) + 1000 }));
    expect(check()).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
describe('newInstanceOnDisk (copyApp fallback)', () => {
  const app = () => String(MOCK_STORE.instanceDB[NEXTCLOUD].instanceOf);

  it('a pre-existing instance of the same app and name on the target does not confirm, even if it moves there later', () => {
    const [s, setS] = createSignal(withInstance(base(), 'existing', { storedOn: TARGET, created: Date.now() }));
    const found = newInstanceOnDisk(s, TARGET, { instanceOf: app(), name: 'nextcloud', engineId: E2 });
    expect(found()).toBe(false);
    setS(withInstance(s(), NEXTCLOUD, { storedOn: TARGET })); // the source moved there: not a copy
    expect(found()).toBe(false);
  });

  it('a newly created instance with the same app and name confirms; another app or name does not', () => {
    const [s, setS] = createSignal(base());
    const found = newInstanceOnDisk(s, TARGET, { instanceOf: app(), name: 'nextcloud', engineId: E2 });
    setS(withInstance(s(), 'other-name', { storedOn: TARGET, name: 'nextcloud-2', created: Date.now() }));
    setS(withInstance(s(), 'other-app', { storedOn: TARGET, instanceOf: 'kolibri-1.0', created: Date.now() }));
    setS(withInstance(s(), 'other-disk', { storedOn: MOCK_IDS.DISK_1_ID, created: Date.now() }));
    expect(found()).toBe(false);
    setS(withInstance(s(), 'the-copy', { storedOn: TARGET, created: Date.now() }));
    expect(found()).toBe(true);
  });

  it('an unseen instance whose Engine-clock created stamp predates the send by far does not confirm', () => {
    const [s, setS] = createSignal(base());
    const found = newInstanceOnDisk(s, TARGET, { instanceOf: app(), name: 'nextcloud', engineId: E2 });
    setS(withInstance(s(), 'stale', { storedOn: TARGET, created: engineClock(s()) - 60 * MIN }));
    expect(found()).toBe(false);
  });
});

describe('instanceStoredOn (moveApp fallback)', () => {
  it('already on the target at send → never confirms', () => {
    const [s, setS] = createSignal(withInstance(base(), NEXTCLOUD, { storedOn: TARGET }));
    const moved = instanceStoredOn(s, NEXTCLOUD, TARGET);
    expect(moved()).toBe(false);
    setS(withInstance(s(), NEXTCLOUD, { status: 'Running' }));
    expect(moved()).toBe(false);
  });
  it('storedOn changes to the target after the send → confirms', () => {
    const [s, setS] = createSignal(base());
    const moved = instanceStoredOn(s, NEXTCLOUD, TARGET);
    expect(moved()).toBe(false);
    setS(withInstance(s(), NEXTCLOUD, { storedOn: TARGET }));
    expect(moved()).toBe(true);
  });
});

describe('confirmInstalled (installApp / lesson install)', () => {
  it('a pre-existing instance of the app on the disk does not confirm; a newly created one does', () => {
    const [s, setS] = createSignal(withInstance(base(), 'old-lesson', { storedOn: TARGET, instanceOf: 'kolibri-1.0', name: 'grade5a', created: Date.now() }));
    const check = confirmInstalled(s, TARGET, 'kolibri-1.0', E2);
    expect(check()).toBeNull();
    setS(withInstance(s(), 'old-lesson', { status: 'Running' }));
    expect(check()).toBeNull();
    setS(withInstance(s(), 'new-other-app', { storedOn: TARGET, instanceOf: 'nextcloud-1.0', created: Date.now() }));
    expect(check()).toBeNull();
    setS(withInstance(s(), 'new-lesson', { storedOn: TARGET, instanceOf: 'kolibri-1.0', name: 'grade5a', created: Date.now() }));
    expect(check()).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
describe('confirmInstanceStatus: start/stop need a transition after the send', () => {
  const setup = (status: Status) => createSignal(withInstance(base(), NEXTCLOUD, { status }));

  it('start: already Running at send, no transition → never confirms', () => {
    const [s, setS] = setup('Running');
    const check = confirmInstanceStatus(s, NEXTCLOUD, ['Running'], 'startApp');
    expect(check()).toBeNull();
    setS(withInstance(s(), NEXTCLOUD, { lastStarted: Date.now() })); // unrelated update
    expect(check()).toBeNull();
  });

  it('stop: already Stopped at send, no transition → never confirms', () => {
    const [s, setS] = setup('Stopped');
    const check = confirmInstanceStatus(s, NEXTCLOUD, ['Stopped', 'Docked'], 'stopApp');
    expect(check()).toBeNull();
    setS(withInstance(s(), NEXTCLOUD, { statusCondition: null }));
    expect(check()).toBeNull();
  });

  it('start: Stopped → Running confirms', () => {
    const [s, setS] = setup('Stopped');
    const check = confirmInstanceStatus(s, NEXTCLOUD, ['Running'], 'startApp');
    setS(withInstance(s(), NEXTCLOUD, { status: 'Starting' }));
    expect(check()).toBeNull();
    setS(withInstance(s(), NEXTCLOUD, { status: 'Running' }));
    expect(check()).toBe('ok');
  });

  it('start: Running → Starting → Running (seen leaving, then back) confirms', () => {
    const [s, setS] = setup('Running');
    const check = confirmInstanceStatus(s, NEXTCLOUD, ['Running'], 'startApp');
    setS(withInstance(s(), NEXTCLOUD, { status: 'Starting' }));
    expect(check()).toBeNull();
    setS(withInstance(s(), NEXTCLOUD, { status: 'Running' }));
    expect(check()).toBe('ok');
  });

  it('stop: Running → Stopped confirms', () => {
    const [s, setS] = setup('Running');
    const check = confirmInstanceStatus(s, NEXTCLOUD, ['Stopped', 'Docked'], 'stopApp');
    setS(withInstance(s(), NEXTCLOUD, { status: 'Stopped' }));
    expect(check()).toBe('ok');
  });

  it('a NEW startApp op Done confirms even if the Starting step was never observed; a pre-existing one does not', () => {
    const startOp = (id: string, status: Operation['status']) =>
      op(id, { kind: 'startApp', status, args: { instanceId: NEXTCLOUD, diskId: MOCK_IDS.DISK_2_ID } });
    const [s, setS] = createSignal(withOp(withInstance(base(), NEXTCLOUD, { status: 'Running' }), startOp('old', 'Done')));
    const check = confirmInstanceStatus(s, NEXTCLOUD, ['Running'], 'startApp');
    expect(check()).toBeNull();
    setS(withOp(s(), startOp('new', 'Running')));
    expect(check()).toBeNull();
    setS(withOp(s(), startOp('new', 'Done')));
    expect(check()).toBe('ok');
  });

  it('a NEW stopApp op Failed is red', () => {
    const [s, setS] = setup('Running');
    const check = confirmInstanceStatus(s, NEXTCLOUD, ['Stopped', 'Docked'], 'stopApp');
    setS(withOp(s(), op('stop', { kind: 'stopApp', status: 'Failed', error: 'compose down failed', args: { instanceId: NEXTCLOUD } })));
    expect(check()).toEqual({ error: 'compose down failed' });
  });
});

describe('other transitions', () => {
  it('lastBackupAdvanced needs lastBackup to move forward after the send', () => {
    const [s, setS] = createSignal(withInstance(base(), NEXTCLOUD, { lastBackup: 1000 }));
    const adv = lastBackupAdvanced(s, NEXTCLOUD);
    expect(adv()).toBe(false);
    setS(withInstance(s(), NEXTCLOUD, { lastBackup: 2000 }));
    expect(adv()).toBe(true);
  });

  it('confirmRebooted: unchanged lastBooted does not confirm; any change (even backwards, no RTC) does', () => {
    const [s, setS] = createSignal(base());
    const check = confirmRebooted(s, E2);
    expect(check()).toBeNull();
    const b = Number(s().engineDB[E2].lastBooted);
    setS({ ...s(), engineDB: { ...s().engineDB, [E2]: { ...s().engineDB[E2], lastBooted: b - 10 * MIN } } });
    expect(check()).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
describe('RestorePanel (remote): a restore op that existed before the click does not confirm', () => {
  it('stays "Sent to"; a new restoreApp op for the chosen disk then confirms', () => {
    const send = vi.fn();
    setSendCommandFn(send);
    const done = (id: string, disk: string) => op(id, {
      kind: 'restoreApp', status: 'Done', args: { instanceId: KOLIBRI, targetDiskId: disk },
      subject: { type: 'instance', id: KOLIBRI },
    });
    const [store, setStore] = createSignal<Store>(withOp(base(), done('earlier', MOCK_IDS.DISK_2_ID)));
    render(() => (
      <RestorePanel
        disk={() => store().diskDB[MOCK_IDS.DISK_4_ID]}
        store={store}
        engineId={() => E2}
      />
    ));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: MOCK_IDS.DISK_2_ID } });
    fireEvent.click(screen.getByRole('button', { name: /^restore$/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm restore/i }));
    expect(send).toHaveBeenCalledWith(E2, `restoreApp ${KOLIBRI} ${MOCK_IDS.DISK_2_ID}`);
    // unrelated store churn: the pre-existing Done op must not confirm
    setStore(withOp(store(), done('earlier', MOCK_IDS.DISK_2_ID)));
    expect(screen.getByTestId(`restore-feedback-${KOLIBRI}-sent`)).toBeInTheDocument();
    // a new restore op to a different disk does not confirm either
    setStore(withOp(store(), done('elsewhere', MOCK_IDS.DISK_3_ID)));
    expect(screen.getByTestId(`restore-feedback-${KOLIBRI}-sent`)).toBeInTheDocument();
    setStore(withOp(store(), done('ours', MOCK_IDS.DISK_2_ID)));
    expect(screen.queryByTestId(`restore-feedback-${KOLIBRI}-sent`)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
