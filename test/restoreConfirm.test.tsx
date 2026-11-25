import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@solidjs/testing-library';
import RestorePanel from '../src/components/RestorePanel';
import { setSendCommandFn } from '../src/store/commands';
import {
  backupDateText, isSameDiskRestore, oldDiskGone, otherDiskButton, otherDiskPoints, otherDiskQuestion, otherDiskSummary, restoreOutcome, sameDiskConfirm,
} from '../src/store/restoreConfirm';
import type { CommandLogStore } from '../src/types/commandLog';
import type { Disk, Instance, Store } from '../src/types/store';

const T = 1_700_000_000_000;
const disk = (id: string, name: string, types: string[], extra: Partial<Disk> = {}): Disk =>
  ({ id, name, device: 'sda', created: T, lastDocked: T, dockedTo: 'ENG1', diskTypes: types, ...extra } as Disk);
const inst: Instance = {
  id: 'i1', instanceOf: 'kolibri-1', name: 'Kolibri', status: 'Running', port: 1, serviceImages: [], created: T,
  lastBackup: T, lastStarted: T, storedOn: 'APPS', statusCondition: null, currentStep: null, totalSteps: null, stepLabel: null, metrics: null,
};
const backup = disk('BK', 'Backup', ['backup'], { backupConfig: { mode: 'on-demand', links: ['i1'] } } as Partial<Disk>);
const store = {
  engineDB: {}, appDB: {}, userDB: {}, operationDB: {}, instanceDB: { i1: inst },
  diskDB: { BK: backup, APPS: disk('APPS', 'Old SSD', ['app']), NEW: disk('NEW', 'New SSD', ['empty']) },
} as unknown as Store;
const date = backupDateText(T);
const w = { app: 'Kolibri', date, target: 'New SSD', current: 'Old SSD' };

afterEach(() => cleanup());

describe('restore confirm wording (agent-engine-dev#191)', () => {
  it('same disk', () => {
    expect(sameDiskConfirm(w)).toBe(`Restore Kolibri from the backup of ${date}? The app will be stopped and its data replaced with the backup. Changes made since ${date} will be lost.`);
  });
  it('different disk: question, three points, button, summary', () => {
    expect(otherDiskQuestion(w)).toBe(`Restore Kolibri from the backup of ${date} onto New SSD?`);
    expect(otherDiskPoints(w)).toEqual([
      'The running copy of Kolibri on Old SSD will be stopped.',
      'From now on, Kolibri will run from New SSD.',
      'The old copy on Old SSD is not deleted. It stays there until you remove it.',
    ]);
    expect(otherDiskButton('New SSD')).toBe('Restore to New SSD');
    expect(otherDiskSummary(w)).toBe(`Kolibri restored from ${date} and now running from New SSD. The old copy on Old SSD was kept.`);
  });
  it('same-disk detection uses storedOn', () => {
    expect(isSameDiskRestore(inst, 'APPS')).toBe(true);
    expect(isSameDiskRestore(inst, 'NEW')).toBe(false);
  });
});

describe('RestorePanel confirm', () => {
  const panel = (log?: () => CommandLogStore) => render(() => (
    <RestorePanel disk={() => backup} store={() => store} engineId={() => 'ENG1'} commandLogStore={log} />
  ));
  const pick = (r: ReturnType<typeof panel>, id: string) => {
    fireEvent.change(r.getByTestId('restore-target-i1'), { target: { value: id } });
    fireEvent.click(r.getByTestId('restore-btn-i1'));
  };
  it('different disk shows Axle\'s text and "Restore to <target>"', () => {
    const r = panel();
    pick(r, 'NEW');
    expect(r.getByTestId('restore-confirm-text-i1').textContent).toBe(otherDiskQuestion(w));
    const items = [...r.getByTestId('restore-confirm-points-i1').querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toEqual(otherDiskPoints(w));
    expect(r.getByTestId('restore-confirm-i1').textContent).toBe('Restore to New SSD');
    expect(r.container.querySelectorAll('.restore-panel__confirm strong').length).toBeGreaterThanOrEqual(3);
  });
  it('same disk shows the overwrite text and no points', () => {
    const r = panel();
    pick(r, 'APPS');
    expect(r.getByTestId('restore-confirm-text-i1').textContent).toBe(sameDiskConfirm(w));
    expect(r.queryByTestId('restore-confirm-points-i1')).toBeNull();
    expect(r.getByTestId('restore-confirm-i1').textContent).toBe('Restore');
  });
  // #255: the success line follows the instance's real status once it is on the target.
  const restoreAndFinish = async (opts: { oldDisk?: Partial<Disk>; before?: Partial<Instance>; after: Partial<Instance> }) => {
    const send = vi.fn();
    setSendCommandFn(send);
    const { createSignal } = await import('solid-js');
    const base = {
      ...store,
      instanceDB: { i1: { ...inst, ...opts.before } },
      diskDB: { ...store.diskDB, APPS: disk('APPS', 'Old SSD', ['app'], opts.oldDisk) },
    } as unknown as Store;
    const [st, setSt] = createSignal<Store>(base);
    const [log, setLog] = createSignal<CommandLogStore>({ traces: {}, recentTraceIds: [] } as unknown as CommandLogStore);
    const r = render(() => (
      <RestorePanel disk={() => backup} store={st} engineId={() => 'ENG1'} commandLogStore={log} />
    ));
    pick(r, 'NEW');
    fireEvent.click(r.getByTestId('restore-confirm-i1'));
    expect(send).toHaveBeenCalledWith('ENG1', 'restoreApp i1 NEW');
    setLog({ traces: { t1: { traceId: 't1', command: 'restoreApp', args: { instanceName: 'i1', targetDiskId: 'NEW' }, status: 'ok', startedAt: T, logs: [] } }, recentTraceIds: ['t1'] } as unknown as CommandLogStore);
    // The store has not re-homed the instance yet: no line from the old status.
    expect(r.queryByTestId('restore-summary-i1')).toBeNull();
    setSt({ ...base, instanceDB: { i1: { ...base.instanceDB.i1, storedOn: 'NEW', ...opts.after } } } as unknown as Store);
    return r;
  };
  it('after a successful restore to another disk with the app running, says it runs from the new disk', async () => {
    const r = await restoreAndFinish({ after: { status: 'Running' } });
    expect(r.getByTestId('restore-summary-i1').textContent).toBe(otherDiskSummary(w, 'running'));
    expect(r.getByTestId('restore-summary-i1').textContent).toBe(`Kolibri restored from ${date} and now running from New SSD. The old copy on Old SSD was kept.`);
  });
  it('after a breakdown restore (old disk gone), says it stays stopped and to press Start', async () => {
    const r = await restoreAndFinish({ oldDisk: { dockedTo: null, device: null } as Partial<Disk>, before: { status: 'Undocked' }, after: { status: 'Stopped' } });
    expect(r.getByTestId('restore-summary-i1').textContent).toBe(
      `Kolibri is restored from ${date} to New SSD but stays stopped because its old disk is gone. Press Start when you're ready.`,
    );
  });
  it('an app that was stopped before stays stopped, as it was', async () => {
    const r = await restoreAndFinish({ before: { status: 'Stopped' }, after: { status: 'Docked' } });
    expect(r.getByTestId('restore-summary-i1').textContent).toBe(otherDiskSummary(w, 'stopped'));
  });
});

describe('restore outcome (#255)', () => {
  it('reads the live status once the instance is on the target', () => {
    expect(restoreOutcome({ status: 'Running', storedOn: 'APPS' } as Instance, 'NEW', false)).toBeNull();
    expect(restoreOutcome(undefined, 'NEW', false)).toBeNull();
    expect(restoreOutcome({ status: 'Running', storedOn: 'NEW' } as Instance, 'NEW', true)).toBe('running');
    expect(restoreOutcome({ status: 'Starting', storedOn: 'NEW' } as Instance, 'NEW', false)).toBe('starting');
    expect(restoreOutcome({ status: 'Error', storedOn: 'NEW' } as Instance, 'NEW', false)).toBe('starting');
    expect(restoreOutcome({ status: 'Stopped', storedOn: 'NEW' } as Instance, 'NEW', true)).toBe('stopped-disk-gone');
    expect(restoreOutcome({ status: 'Undocked', storedOn: 'NEW' } as Instance, 'NEW', true)).toBe('stopped-disk-gone');
    expect(restoreOutcome({ status: 'Stopped', storedOn: 'NEW' } as Instance, 'NEW', false)).toBe('stopped');
  });
  it('old disk gone: missing from the store or not docked', () => {
    expect(oldDiskGone(store, inst)).toBe(false);
    const gone = { ...store, diskDB: { ...store.diskDB, APPS: disk('APPS', 'Old SSD', ['app'], { dockedTo: null } as Partial<Disk>) } } as unknown as Store;
    expect(oldDiskGone(gone, inst)).toBe(true);
    expect(oldDiskGone(store, { ...inst, storedOn: 'NOPE' } as Instance)).toBe(true);
  });
  it('wording for each case', () => {
    expect(otherDiskSummary(w, 'starting')).toBe(`Kolibri restored from ${date} onto New SSD and is starting. The old copy on Old SSD was kept.`);
    expect(otherDiskSummary(w, 'stopped')).toBe(`Kolibri is restored from ${date} to New SSD and stays stopped, as it was before. Press Start when you're ready. The old copy on Old SSD was kept.`);
  });
});
