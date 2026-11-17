/**
 * console#230 option A: the stored Engine.tempBackups field (Axle's Engine PR,
 * provisional deleteTempBackup command) drives the teacher leftover line, the
 * Engine's own-disk space line and the operator list with "Remove backup".
 * The #242 op-args path stays as the fallback when the field is absent.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render, cleanup, screen, fireEvent } from '@solidjs/testing-library';
import UpdateAppControl from '../src/components/UpdateAppControl';
import TempBackupsSection, { INCOMPLETE_TEXT, TEMP_BACKUPS_LABEL, updateRunningHint } from '../src/components/TempBackupsSection';
import { buildDeleteTempBackupCommand, setSendCommandFn } from '../src/store/commands';
import {
  canRemoveTempBackup, removeTempBackupConfirmText, tempBackupBytesText, stampTime, tempBackupAppTitle, tempBackupKey, tempBackupWhen,
  tempBackupsForInstance, tempBackupsOf, tempBackupsTotalBytes,
} from '../src/store/tempBackups';
import { leftoverFromTempBackups, leftoverTempBackupFor, leftoverTempBackupRaw, leftoverTempBackupText, resetDismissed } from '../src/store/updateApp';
import { backupDateText } from '../src/store/restoreConfirm';
import type { CommandLogState } from '../src/store/commandLog';
import type { App, Disk, Engine, Instance, Operation, Store, TempBackupEntry } from '../src/types/store';

const T = 1_700_000_000_000;
const GiB = 1024 ** 3;
const S1 = '20261117T080000Z';
const S0 = '20261110T070000Z';
const P1 = `/.idea-temp-backups/i1/${S1}`;
const P0 = `/.idea-temp-backups/i1/${S0}`;

const SINGLE = "A backup made before the update is still on idea03's own disk and takes about 2.5 GB. Ask for help to remove it when you no longer need it.";
const PLURAL = "Backups made before updates are still on idea03's own disk and take about 3.5 GB. Ask for help to remove them when you no longer need them.";
const KEPT = "IDEA kept the backup it made before the update on idea03's own disk, in case Kolibri needs it. Ask for help before removing it.";

const entry = (extra: Partial<TempBackupEntry> = {}): TempBackupEntry => ({ instanceId: 'i1', stamp: S1, path: P1, sizeBytes: 2.5 * GiB, complete: true, ...extra });
const engine = (tempBackups?: TempBackupEntry[]): Engine => ({
  id: 'ENG1', hostname: 'idea03', version: '1', hostOS: 'Linux', created: T, lastBooted: T, lastRun: Date.now(),
  lastHalted: null, commands: [], capabilities: ['updateApp'] as Engine['capabilities'], capabilitiesBootedAt: T,
  ...(tempBackups ? { tempBackups } : {}),
} as Engine);
const app = (id: string, version: string): App => ({
  id, name: 'kolibri', version, title: 'Kolibri', description: null, url: null, category: 'education', icon: null, author: null,
} as App);
const inst = (): Instance => ({
  id: 'i1', instanceOf: 'kolibri-1.0.0', name: 'kolibri', status: 'Running', port: 8080, serviceImages: [], created: T,
  lastBackup: null, lastStarted: T, storedOn: 'D1', statusCondition: null, currentStep: null, totalSteps: null,
  stepLabel: null, metrics: null, previousAppId: 'kolibri-0.15.5',
} as Instance);
const op = (args: Record<string, string>, extra: Partial<Operation> = {}): Operation => ({
  id: 'op1', kind: 'updateApp', args: { instanceId: 'i1', ...args }, cause: 'console-command' as Operation['cause'], subject: null,
  engineId: 'ENG1', status: 'Done', progressPercent: null, currentStep: 5, totalSteps: 6, stepLabel: 'Health',
  startedAt: T, completedAt: T + 60_000, error: null, ...extra,
});
const mkStore = (eng: Engine, ops: Operation[] = [], disks: Record<string, Disk> = {}): Store => ({
  engineDB: { ENG1: eng },
  diskDB: { D1: { id: 'D1', name: 'Apps disk', dockedTo: 'ENG1', diskTypes: ['app'] } as unknown as Disk, ...disks },
  appDB: { 'kolibri-0.15.5': app('kolibri-0.15.5', '0.15.5'), 'kolibri-1.0.0': app('kolibri-1.0.0', '1.0.0') },
  instanceDB: { i1: inst() }, userDB: {}, operationDB: Object.fromEntries(ops.map((o) => [o.id, o])),
} as unknown as Store);
const noLog = () => null as CommandLogState;

const renderControl = (s: Store) => render(() => (
  <UpdateAppControl instance={() => s.instanceDB.i1} engine={() => s.engineDB.ENG1} store={() => s} commandLog={noLog} appTitle={() => 'Kolibri'} />
));

beforeEach(() => { localStorage.clear(); resetDismissed(); });
afterEach(() => cleanup());

describe('Engine.tempBackups accessors', () => {
  it('undefined on an older Engine, [] when none are left', () => {
    expect(tempBackupsOf(engine())).toBeUndefined();
    expect(tempBackupsForInstance(engine(), 'i1')).toBeUndefined();
    expect(tempBackupsTotalBytes(engine())).toBeUndefined();
    expect(tempBackupsOf(engine([]))).toEqual([]);
    expect(tempBackupsTotalBytes(engine([]))).toBe(0);
  });
  it('newest first, per instance, drops malformed entries, sums sizes', () => {
    const e = engine([
      entry({ stamp: S0, path: P0, sizeBytes: GiB }),
      entry(),
      entry({ instanceId: 'i2', stamp: S1, sizeBytes: GiB }),
      { instanceId: '', stamp: S1 } as TempBackupEntry,
    ]);
    expect(tempBackupsOf(e)!.map(tempBackupKey)).toEqual(['i1:20261117T080000Z', 'i2:20261117T080000Z', 'i1:20261110T070000Z']);
    expect(tempBackupsForInstance(e, 'i1')!.map((b) => b.stamp)).toEqual([S1, S0]);
    expect(tempBackupsTotalBytes(e)).toBe(4.5 * GiB);
  });
  it('stamp time and teacher date', () => {
    expect(stampTime(S1)).toBe(Date.UTC(2026, 10, 17, 8, 0, 0));
    expect(stampTime('nope')).toBeNull();
    expect(tempBackupWhen(entry())).toBe(backupDateText(Date.UTC(2026, 10, 17, 8, 0, 0)));
    expect(tempBackupWhen(entry({ stamp: 'x' }))).toBe('an unknown date');
  });
  it('sizes match the teacher line (1024³ GB)', () => {
    expect(tempBackupBytesText(2.5 * GiB)).toBe('2.5 GB');
    expect(tempBackupBytesText(1024)).toBe('less than 0.1 GB');
    expect(tempBackupBytesText(0)).toBe('0 GB');
  });
  it('only a complete backup can be removed', () => {
    expect(canRemoveTempBackup(entry())).toBe(true);
    expect(canRemoveTempBackup(entry({ complete: false }))).toBe(false);
  });
  it('app title, else the instance name, else a plain fallback', () => {
    const s = mkStore(engine());
    expect(tempBackupAppTitle(s, 'i1')).toBe('Kolibri');
    expect(tempBackupAppTitle(s, 'gone')).toBe('An app that is no longer on this Pi');
  });
  it('provisional command syntax: deleteTempBackup <instanceId> <stamp>', () => {
    expect(buildDeleteTempBackupCommand('i1', S1)).toBe(`deleteTempBackup i1 ${S1}`);
  });
});

describe('leftover line from Engine.tempBackups', () => {
  it('the field wins over the op args; fallback to op args only when the field is undefined', () => {
    const o = op({ tempBackup: P1, tempBackupStamp: S1, tempBackupState: 'delete-failed' });
    expect(leftoverTempBackupFor(engine([]), 'i1', o)).toBeNull();
    expect(leftoverTempBackupFor(engine(), 'i1', o)?.state).toBe('delete-failed');
    expect(leftoverTempBackupFor(engine(), 'i1', null)).toBeNull();
    const lb = leftoverTempBackupFor(engine([entry()]), 'i1', null)!;
    expect(lb).toMatchObject({ state: 'delete-failed', path: P1, sizeBytes: 2.5 * GiB, warning: null, count: 1 });
    expect(leftoverTempBackupText(lb, 'Kolibri', 'idea03')).toBe(SINGLE);
  });
  it('nothing while an update runs (its own backup is in the list)', () => {
    expect(leftoverFromTempBackups([entry()], op({}, { status: 'Running', completedAt: null }))).toBeNull();
  });
  it('kept on purpose after a failed update with the same stamp', () => {
    const lb = leftoverFromTempBackups([entry()], op({ tempBackup: P1, tempBackupStamp: S1, tempBackupState: 'kept' }, { status: 'Failed' }))!;
    expect(lb.state).toBe('kept');
    expect(leftoverTempBackupText(lb, 'Kolibri', 'idea03')).toBe(KEPT);
    expect(leftoverFromTempBackups([entry()], op({ tempBackupStamp: S0, tempBackupState: 'kept' }, { status: 'Failed' }))!.state).toBe('delete-failed');
  });
  it('the Engine warning of the matching op goes behind Technical details', () => {
    const lb = leftoverFromTempBackups([entry()], op({ tempBackupStamp: S1, tempBackupState: 'delete-failed', tempBackupWarning: 'rm: busy' }))!;
    expect(leftoverTempBackupRaw(lb)).toBe('rm: busy');
  });
  it('two backups: plural sentence with the summed size, both paths in the raw text', () => {
    const lb = leftoverFromTempBackups([entry(), entry({ stamp: S0, path: P0, sizeBytes: GiB })], null)!;
    expect(leftoverTempBackupText(lb, 'Kolibri', 'idea03')).toBe(PLURAL);
    expect(leftoverTempBackupRaw(lb)).toContain(P0);
    expect(PLURAL).not.toMatch(/idea-temp-backups|tempBackup|temporary/);
  });
  it('UpdateAppControl shows the line from the field even after the op was archived', () => {
    renderControl(mkStore(engine([entry()])));
    const el = screen.getByTestId('update-leftover-backup-i1');
    expect(el.querySelector('.tech-details__plain')?.textContent).toBe(SINGLE);
    expect(el.querySelector('.tech-details__raw')?.textContent).toContain(P1);
  });
  it('UpdateAppControl shows nothing when the field says none are left, even with delete-failed op args', () => {
    renderControl(mkStore(engine([]), [op({ tempBackup: P1, tempBackupStamp: S1, tempBackupState: 'delete-failed' })]));
    expect(screen.queryByTestId('update-leftover-backup-i1')).toBeNull();
  });
});

describe('TempBackupsSection (operator view)', () => {
  const show = (s: Store) => render(() => <TempBackupsSection engineId="ENG1" store={() => s} commandLogStore={noLog} />);
  const K = `i1:${S1}`;

  it('renders nothing on an older Engine or when no backup is left', () => {
    show(mkStore(engine()));
    expect(screen.queryByTestId('temp-backups-ENG1')).toBeNull();
    cleanup();
    show(mkStore(engine([])));
    expect(screen.queryByTestId('temp-backups-ENG1')).toBeNull();
  });
  it('disk space: free space of the system disk and the backups total', () => {
    const sys = { SYS: { id: 'SYS', name: 'system', dockedTo: 'ENG1', diskTypes: ['system'], sizeBytes: 64 * GiB, freeBytes: 10 * GiB } as unknown as Disk };
    show(mkStore(engine([entry(), entry({ stamp: S0, path: P0, sizeBytes: GiB, complete: false })]), [], sys));
    expect(screen.getByText(TEMP_BACKUPS_LABEL)).toBeTruthy();
    expect(screen.getByTestId('temp-backups-total-ENG1').textContent).toBe('3.5 GB');
    expect(screen.getByTestId('temp-backups-free-ENG1').textContent).toBe('10.0 GB free of 64.0 GB');
  });
  it('a row per backup: app, when, size, complete; the path only behind Technical details', () => {
    show(mkStore(engine([entry()])));
    expect(screen.getByTestId(`temp-backup-app-${K}`).textContent).toBe('Kolibri');
    expect(screen.getByTestId(`temp-backup-meta-${K}`).textContent).toBe(`Made ${tempBackupWhen(entry())} · 2.5 GB`);
    const st = screen.getByTestId(`temp-backup-state-${K}`);
    expect(st.querySelector('.tech-details__plain')?.textContent).toBe('Complete');
    expect(st.querySelector('.tech-details__raw')?.textContent).toBe(P1);
  });
  it('no Remove backup for an incomplete backup', () => {
    show(mkStore(engine([entry({ complete: false })])));
    expect(screen.getByTestId(`temp-backup-state-${K}`).querySelector('.tech-details__plain')?.textContent).toBe(INCOMPLETE_TEXT);
    expect(screen.queryByTestId(`temp-backup-remove-${K}`)).toBeNull();
  });
  it('Remove backup confirms first, then sends the provisional command; Cancel sends nothing', () => {
    const send = vi.fn();
    setSendCommandFn(send);
    show(mkStore(engine([entry()])));
    fireEvent.click(screen.getByTestId(`temp-backup-remove-${K}`));
    expect(screen.getByTestId(`temp-backup-confirm-text-${K}`).textContent)
      .toBe(removeTempBackupConfirmText('Kolibri', tempBackupWhen(entry()), '2.5 GB'));
    fireEvent.click(screen.getByTestId(`temp-backup-cancel-${K}`));
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId(`temp-backup-remove-${K}`));
    fireEvent.click(screen.getByTestId(`temp-backup-confirm-${K}`));
    expect(send).toHaveBeenCalledWith('ENG1', `deleteTempBackup i1 ${S1}`);
  });
  it('keeps a confirm open across store refreshes, clears the row when deleted', () => {
    const [s, setS] = createSignal(mkStore(engine([entry()])));
    render(() => <TempBackupsSection engineId="ENG1" store={s} commandLogStore={noLog} />);
    fireEvent.click(screen.getByTestId(`temp-backup-remove-${K}`));
    setS(mkStore(engine([entry()])));
    expect(screen.getByTestId(`temp-backup-confirm-${K}`)).toBeTruthy();
    setS(mkStore(engine([])));
    expect(screen.queryByTestId(`temp-backup-${K}`)).toBeNull();
  });
  it('Remove backup is disabled while that app is updating', () => {
    show(mkStore(engine([entry()]), [op({}, { status: 'Running', completedAt: null })]));
    expect((screen.getByTestId(`temp-backup-remove-${K}`) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId(`temp-backup-hint-${K}`).textContent).toBe(updateRunningHint('Kolibri'));
  });
});
