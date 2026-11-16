/**
 * idea#403 / agent-engine-dev#404: an App with x-app.backup.method 'none' never gets
 * lastBackup; its Instance.lastResult is {method: 'none', result: 'OK'}. The major-update
 * gate needs no backup for it, and RestorePanel shows the neutral method-none line and
 * offers no restore. stop / hook instances without a lastBackup are unchanged.
 * Instance.backupMethod (when set) decides; unset falls back to lastResult.method.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import UpdateAppControl from '../src/components/UpdateAppControl';
import RestorePanel from '../src/components/RestorePanel';
import { setSendCommandFn } from '../src/store/commands';
import { majorNeedsBackup, resetDismissed, BACKUP_MAX_AGE_MS, NEEDS_BACKUP_TEXT } from '../src/store/updateApp';
import { isBackupMethodNone, METHOD_NONE_COPY, SCHEDULED_BACKUPS_CAPABILITY } from '../src/store/backupStatus';
import { MOCK_IDS, MOCK_STORE } from '../src/mock/mockStore';
import type { CommandLogState } from '../src/store/commandLog';
import type { CommandLogStore } from '../src/types/commandLog';
import type { App, Disk, Engine, Instance, Store } from '../src/types/store';

const T = Date.now();
const NONE_RESULT = { time: T - 1000, method: 'none', result: 'OK' };
const STOP_RESULT = { time: T - 1000, method: 'stop', result: 'FAILED' };
const HOOK_RESULT = { time: T - 1000, method: 'hook', result: 'FAILED' };

beforeEach(() => { localStorage.clear(); resetDismissed(); });
afterEach(() => { cleanup(); setSendCommandFn(() => {}); });

// ---------------------------------------------------------------------------
describe('isBackupMethodNone', () => {
  it('true only for lastResult.method none', () => {
    expect(isBackupMethodNone({ lastResult: NONE_RESULT })).toBe(true);
    expect(isBackupMethodNone({ lastResult: STOP_RESULT })).toBe(false);
    expect(isBackupMethodNone({ lastResult: HOOK_RESULT })).toBe(false);
    expect(isBackupMethodNone({ lastResult: { time: T, method: null, result: 'OK' } })).toBe(false);
    // The store has no App/compose backup method: a none App that never ran a backup is not known yet.
    expect(isBackupMethodNone({ lastResult: null })).toBe(false);
    expect(isBackupMethodNone({})).toBe(false);
    expect(isBackupMethodNone(null)).toBe(false);
  });
});

describe('isBackupMethodNone with Instance.backupMethod (agent-engine-dev#404)', () => {
  it("backupMethod 'none' with no lastResult: none (a fresh none App is covered)", () => {
    expect(isBackupMethodNone({ backupMethod: 'none' })).toBe(true);
    expect(isBackupMethodNone({ backupMethod: 'none', lastResult: null })).toBe(true);
  });
  it("backupMethod 'stop' / 'hook' wins over an older lastResult none (the method changed)", () => {
    expect(isBackupMethodNone({ backupMethod: 'stop', lastResult: NONE_RESULT })).toBe(false);
    expect(isBackupMethodNone({ backupMethod: 'hook', lastResult: NONE_RESULT })).toBe(false);
  });
  it('backupMethod none wins over an older stop result', () => {
    expect(isBackupMethodNone({ backupMethod: 'none', lastResult: STOP_RESULT })).toBe(true);
  });
  it('unset backupMethod (older Engine, invalid spec) falls back to lastResult', () => {
    expect(isBackupMethodNone({ backupMethod: undefined, lastResult: NONE_RESULT })).toBe(true);
    expect(isBackupMethodNone({ backupMethod: undefined, lastResult: STOP_RESULT })).toBe(false);
    expect(isBackupMethodNone({ backupMethod: undefined, lastResult: null })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('majorNeedsBackup', () => {
  const now = 10 * BACKUP_MAX_AGE_MS;
  it('method none: a major needs no backup', () => {
    expect(majorNeedsBackup({ major: true }, null, now, true)).toBe(false);
    expect(majorNeedsBackup({ major: true }, now - BACKUP_MAX_AGE_MS - 1, now, true)).toBe(false);
  });
  it('negative: stop / hook (default) with no lastBackup still need one', () => {
    expect(majorNeedsBackup({ major: true }, null, now)).toBe(true);
    expect(majorNeedsBackup({ major: true }, null, now, false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('UpdateAppControl', () => {
  const engine = (): Engine => ({
    id: 'ENG1', hostname: 'idea04', version: '1', hostOS: 'Linux', created: T, lastBooted: T, lastRun: T,
    lastHalted: null, commands: [], capabilities: ['updateApp', 'updateAppFetch'], capabilitiesBootedAt: T,
  } as unknown as Engine);
  const app = (id: string, version: string): App => ({
    id, name: 'kiwix', version, title: 'Kiwix', description: null, url: null, category: 'education', icon: null, author: null,
  } as App);
  const inst = (extra: Record<string, unknown>): Instance => ({
    id: 'i1', instanceOf: 'kiwix-0.15.5', name: 'kiwix', status: 'Running', port: 8080, serviceImages: [], created: T,
    lastBackup: null, lastStarted: T, storedOn: 'D1', statusCondition: null, currentStep: null, totalSteps: null,
    stepLabel: null, metrics: null, ...extra,
  } as Instance);
  const store = (i: Instance): Store => ({
    engineDB: { ENG1: engine() },
    diskDB: { D1: { id: 'D1', name: 'Apps disk', dockedTo: 'ENG1' } as Disk },
    appDB: {
      'kiwix-0.15.5': app('kiwix-0.15.5', '0.15.5'),
      'kiwix-0.15.6': app('kiwix-0.15.6', '0.15.6'),
      'kiwix-1.0.0': app('kiwix-1.0.0', '1.0.0'),
    },
    instanceDB: { i1: i }, userDB: {}, operationDB: {},
  } as unknown as Store);
  const setup = (i: Instance) => {
    const s = store(i);
    const [cls, setCls] = createSignal<CommandLogState>({ traces: {}, recentTraceIds: [] } as unknown as CommandLogState);
    const send = vi.fn();
    setSendCommandFn(send);
    render(() => (
      <UpdateAppControl instance={() => s.instanceDB.i1} engine={() => s.engineDB.ENG1} store={() => s} commandLog={cls} appTitle={() => 'Kiwix'} />
    ));
    return { setCls, send };
  };
  const refuse = (setCls: (c: CommandLogState) => void) => {
    const log: CommandLogStore = {
      traces: { t: { traceId: 't', command: 'updateApp', args: { instanceId: 'i1' }, startedAt: T, completedAt: T, status: 'error', errorMessage: 'NEEDS_BACKUP: Dock a Backup Disk linked to this instance', logs: [] } },
      recentTraceIds: ['t'],
    };
    setCls(log);
  };
  const confirmBtn = () => screen.getByTestId('update-confirm-btn-i1') as HTMLButtonElement;

  it('method none, major, no lastBackup: Update enabled, no backup hint', () => {
    setup(inst({ lastResult: NONE_RESULT, updateAvailable: { appId: 'kiwix-1.0.0' } }));
    fireEvent.click(screen.getByTestId('update-badge-i1'));
    expect(confirmBtn().disabled).toBe(false);
    expect(screen.queryByTestId('update-confirm-needs-backup-i1')).toBeNull();
    expect(screen.getByTestId('update-confirm-i1').textContent).not.toContain('makes a backup');
  });

  it("fresh none App (backupMethod 'none', no lastResult), major: Update enabled", () => {
    setup(inst({ backupMethod: 'none', updateAvailable: { appId: 'kiwix-1.0.0' } }));
    fireEvent.click(screen.getByTestId('update-badge-i1'));
    expect(confirmBtn().disabled).toBe(false);
    expect(screen.queryByTestId('update-confirm-needs-backup-i1')).toBeNull();
  });

  // engine#469: a missing backup no longer blocks Update; the Engine makes it first and the
  // confirm says so. The none App gets no such line.
  const BACKUP_FIRST = 'IDEA makes a backup of Kiwix first, so it takes a little longer.';
  it("negative: backupMethod 'stop' with an older lastResult none, major: the backup is made first", () => {
    setup(inst({ backupMethod: 'stop', lastResult: NONE_RESULT, updateAvailable: { appId: 'kiwix-1.0.0' } }));
    fireEvent.click(screen.getByTestId('update-badge-i1'));
    expect(confirmBtn().disabled).toBe(false);
    expect(screen.getByTestId('update-confirm-i1').textContent).toContain(BACKUP_FIRST);
    expect(screen.queryByTestId('update-confirm-needs-backup-i1')).toBeNull();
  });

  for (const [label, lastResult] of [['stop', STOP_RESULT], ['hook', HOOK_RESULT], ['never run', null]] as const) {
    it(`negative (${label}), major, no lastBackup: Update enabled, the confirm says the backup is made first`, () => {
      setup(inst({ lastResult, updateAvailable: { appId: 'kiwix-1.0.0' } }));
      fireEvent.click(screen.getByTestId('update-badge-i1'));
      expect(confirmBtn().disabled).toBe(false);
      expect(screen.getByTestId('update-confirm-i1').textContent).toContain(BACKUP_FIRST);
    });
  }

  it('method none: an Engine NEEDS_BACKUP refusal does not lock the badge; the error is still shown', () => {
    const { setCls, send } = setup(inst({ lastResult: NONE_RESULT, updateAvailable: { appId: 'kiwix-1.0.0' } }));
    fireEvent.click(screen.getByTestId('update-badge-i1'));
    fireEvent.click(confirmBtn());
    expect(send).toHaveBeenCalledOnce();
    refuse(setCls);
    expect(screen.getByTestId('update-error-i1')).toBeInTheDocument();
    const badge = screen.getByTestId('update-badge-i1') as HTMLButtonElement;
    expect(badge.disabled).toBe(false);
    expect(screen.queryByTestId('update-needs-backup-i1')).toBeNull();
  });

  it('negative (stop): the same refusal locks the badge with the backup hint', () => {
    const { setCls } = setup(inst({ lastResult: STOP_RESULT, updateAvailable: { appId: 'kiwix-0.15.6' } }));
    fireEvent.click(screen.getByTestId('update-badge-i1'));
    fireEvent.click(confirmBtn());
    refuse(setCls);
    expect((screen.getByTestId('update-badge-i1') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('update-needs-backup-i1').textContent).toBe(NEEDS_BACKUP_TEXT);
  });
});

// ---------------------------------------------------------------------------
describe('RestorePanel', () => {
  const KOLIBRI = MOCK_IDS.INST_KOLIBRI_ID; // linked to the mock Backup Disk (DISK_4)
  const panel = (extra: Partial<Instance>, statusFlag = false) => {
    const e = MOCK_STORE.engineDB[MOCK_IDS.ENGINE_1_ID];
    const engine: Engine = statusFlag
      ? { ...e, capabilities: [...(e.capabilities ?? []), SCHEDULED_BACKUPS_CAPABILITY], capabilitiesBootedAt: e.lastBooted } as Engine
      : e;
    const store: Store = {
      ...MOCK_STORE,
      operationDB: {},
      engineDB: { ...MOCK_STORE.engineDB, [engine.id]: engine },
      instanceDB: { ...MOCK_STORE.instanceDB, [KOLIBRI]: { ...MOCK_STORE.instanceDB[KOLIBRI], ...extra } },
    };
    render(() => (
      <RestorePanel disk={() => store.diskDB[MOCK_IDS.DISK_4_ID]} store={() => store} engineId={() => MOCK_IDS.ENGINE_1_ID} />
    ));
  };
  const backupLine = () => screen.getByTestId(`restore-instance-backup-${KOLIBRI}`).textContent;

  it('method none: the neutral line instead of "Never backed up", and no restore', () => {
    panel({ lastBackup: null, lastResult: NONE_RESULT });
    expect(backupLine()).toBe(METHOD_NONE_COPY);
    expect(screen.queryByText('Never backed up')).toBeNull();
    expect(screen.queryByTestId(`restore-btn-${KOLIBRI}`)).toBeNull();
    expect(screen.queryByTestId(`restore-target-${KOLIBRI}`)).toBeNull();
  });

  it('method none with the backup status lines on: the sentence is shown once', () => {
    panel({ lastBackup: null, lastResult: NONE_RESULT }, true);
    expect(screen.getAllByText(METHOD_NONE_COPY)).toHaveLength(1);
    expect(screen.queryByTestId(`restore-btn-${KOLIBRI}`)).toBeNull();
  });

  for (const [label, lastResult] of [['stop', STOP_RESULT], ['hook', HOOK_RESULT], ['never run', null]] as const) {
    it(`negative (${label}) with no lastBackup: still "Never backed up", restore still offered`, () => {
      panel({ lastBackup: null, lastResult });
      expect(backupLine()).toBe('Never backed up');
      expect(screen.getByTestId(`restore-btn-${KOLIBRI}`)).toBeInTheDocument();
    });
  }

  it("fresh none App (backupMethod 'none', no lastResult): the neutral line, no restore", () => {
    panel({ lastBackup: null, lastResult: null, backupMethod: 'none' });
    expect(backupLine()).toBe(METHOD_NONE_COPY);
    expect(screen.queryByTestId(`restore-btn-${KOLIBRI}`)).toBeNull();
  });

  it("negative: backupMethod 'stop' with an older lastResult none: 'Never backed up', restore offered", () => {
    panel({ lastBackup: null, lastResult: NONE_RESULT, backupMethod: 'stop' });
    expect(backupLine()).toBe('Never backed up');
    expect(screen.getByTestId(`restore-btn-${KOLIBRI}`)).toBeInTheDocument();
  });

  it("backupMethod 'none' with a real older archive (lastBackup): date and restore kept", () => {
    panel({ lastBackup: T - 86_400_000, lastResult: null, backupMethod: 'none' });
    expect(backupLine()).toMatch(/^Last backup: /);
    expect(screen.getByTestId(`restore-btn-${KOLIBRI}`)).toBeInTheDocument();
  });

  it('a none instance that still has an older lastBackup keeps its date and restore', () => {
    panel({ lastBackup: T - 86_400_000, lastResult: NONE_RESULT });
    expect(backupLine()).toMatch(/^Last backup: /);
    expect(screen.getByTestId(`restore-btn-${KOLIBRI}`)).toBeInTheDocument();
  });
});
