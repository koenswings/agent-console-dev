/**
 * console#230: a temporary pre-update backup still on the Engine's own disk
 * (agent-engine-dev#472 op args tempBackupState delete-failed / kept) gets a plain
 * teacher line under the update outcome; the raw path is behind Technical details.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createSignal } from 'solid-js';
import { render, cleanup, screen } from '@solidjs/testing-library';
import UpdateAppControl from '../src/components/UpdateAppControl';
import {
  leftoverTempBackupOf, leftoverTempBackupRaw, leftoverTempBackupText, resetDismissed, stripTempBackupKept, updateOutcome,
  type RefusalCtx,
} from '../src/store/updateApp';
import type { CommandLogState } from '../src/store/commandLog';
import type { App, Disk, Engine, Instance, Operation, Store } from '../src/types/store';
import type { CommandLogStore, CommandTrace } from '../src/types/commandLog';

const T = 1_700_000_000_000;
const GiB = 1024 ** 3;
const PATH = '/.idea-temp-backups/i1/20261117T080000Z';
const WARNING = `temporary backup ${PATH} could not be removed: rm: cannot remove: Device or resource busy; free space by deleting it`;

const DELETE_FAILED_SIZE = "A backup made before the update is still on idea03's own disk and takes about 2.5 GB. Ask for help to remove it when you no longer need it.";
const DELETE_FAILED_NO_SIZE = "A backup made before the update is still on idea03's own disk and takes up space. Ask for help to remove it when you no longer need it.";
const KEPT = "IDEA kept the backup it made before the update on idea03's own disk, in case Kolibri needs it. Ask for help before removing it.";

const engine = (): Engine => ({
  id: 'ENG1', hostname: 'idea03', version: '1', hostOS: 'Linux', created: T, lastBooted: T, lastRun: Date.now(),
  lastHalted: null, commands: [], capabilities: ['updateApp'] as Engine['capabilities'], capabilitiesBootedAt: T,
} as Engine);
const app = (id: string, version: string): App => ({
  id, name: 'kolibri', version, title: 'Kolibri', description: null, url: null, category: 'education', icon: null, author: null,
} as App);
const inst = (extra: Record<string, unknown> = {}): Instance => ({
  id: 'i1', instanceOf: 'kolibri-1.0.0', name: 'kolibri', status: 'Running', port: 8080, serviceImages: [], created: T,
  lastBackup: null, lastStarted: T, storedOn: 'D1', statusCondition: null, currentStep: null, totalSteps: null,
  stepLabel: null, metrics: null, previousAppId: 'kolibri-0.15.5', ...extra,
} as Instance);
const op = (args: Record<string, string>, extra: Partial<Operation> = {}): Operation => ({
  id: 'op1', kind: 'updateApp', args: { instanceId: 'i1', ...args }, cause: 'console-command' as Operation['cause'], subject: null,
  engineId: 'ENG1', status: 'Done', progressPercent: null, currentStep: 5, totalSteps: 6, stepLabel: 'Health',
  startedAt: T, completedAt: T + 60_000, error: null, ...extra,
});
const tbArgs = (state: string, extra: Record<string, string> = {}) => ({ tempBackup: PATH, tempBackupStamp: '20261117T080000Z', tempBackupState: state, ...extra });
const mkStore = (ops: Operation[]): Store => ({
  engineDB: { ENG1: engine() },
  diskDB: { D1: { id: 'D1', name: 'Apps disk', dockedTo: 'ENG1' } as Disk },
  appDB: { 'kolibri-0.15.5': app('kolibri-0.15.5', '0.15.5'), 'kolibri-1.0.0': app('kolibri-1.0.0', '1.0.0') },
  instanceDB: { i1: inst() }, userDB: {}, operationDB: Object.fromEntries(ops.map((o) => [o.id, o])),
} as unknown as Store);
const okTrace = (result: unknown): CommandTrace => ({
  traceId: 't1', command: 'updateApp', args: { instanceId: 'i1' }, startedAt: T, completedAt: T + 60_000,
  status: 'ok', errorMessage: null, logs: [], result: JSON.stringify(result),
} as unknown as CommandTrace);

const setup = (ops: Operation[], traces: CommandTrace[] = []) => {
  const s = mkStore(ops);
  const log: CommandLogStore = { traces: Object.fromEntries(traces.map((t) => [t.traceId, t])), recentTraceIds: traces.map((t) => t.traceId) };
  const [cls] = createSignal<CommandLogState>(log as unknown as CommandLogState);
  render(() => (
    <UpdateAppControl instance={() => s.instanceDB.i1} engine={() => s.engineDB.ENG1} store={() => s} commandLog={cls} appTitle={() => 'Kolibri'} />
  ));
};

beforeEach(() => { localStorage.clear(); resetDismissed(); });
afterEach(() => cleanup());

describe('leftoverTempBackupOf (console#230)', () => {
  it('delete-failed on a Done op, with the Engine warning and the trace size', () => {
    const lb = leftoverTempBackupOf(op(tbArgs('delete-failed', { tempBackupWarning: WARNING })),
      JSON.stringify({ tempBackup: { path: PATH, sizeBytes: 2.5 * GiB, deleted: false } }));
    expect(lb).toEqual({ state: 'delete-failed', path: PATH, sizeBytes: 2.5 * GiB, warning: WARNING });
  });
  it('delete-failed without a trace, or with a trace for another backup: no size', () => {
    expect(leftoverTempBackupOf(op(tbArgs('delete-failed')))?.sizeBytes).toBeNull();
    expect(leftoverTempBackupOf(op(tbArgs('delete-failed')), { tempBackup: { path: '/other', sizeBytes: GiB, deleted: false } })?.sizeBytes).toBeNull();
    expect(leftoverTempBackupOf(op(tbArgs('delete-failed')), 'not json')?.sizeBytes).toBeNull();
  });
  it('kept on a Failed op', () => {
    expect(leftoverTempBackupOf(op(tbArgs('kept'), { status: 'Failed' }))).toEqual({ state: 'kept', path: PATH, sizeBytes: null, warning: null });
  });
  it('nothing for deleted, created, no state, a running op, or a state on the wrong outcome', () => {
    expect(leftoverTempBackupOf(op(tbArgs('deleted')))).toBeNull();
    expect(leftoverTempBackupOf(op(tbArgs('created')))).toBeNull();
    expect(leftoverTempBackupOf(op({}))).toBeNull();
    expect(leftoverTempBackupOf(op(tbArgs('created'), { status: 'Running', completedAt: null }))).toBeNull();
    expect(leftoverTempBackupOf(op(tbArgs('kept'), { status: 'Running', completedAt: null }))).toBeNull();
    expect(leftoverTempBackupOf(op(tbArgs('kept')))).toBeNull();
    expect(leftoverTempBackupOf(op(tbArgs('delete-failed'), { status: 'Failed' }))).toBeNull();
    expect(leftoverTempBackupOf(null)).toBeNull();
  });
});

describe('leftoverTempBackupText (console#230)', () => {
  const base = { path: PATH, warning: null };
  it('delete-failed with and without the size', () => {
    expect(leftoverTempBackupText({ ...base, state: 'delete-failed', sizeBytes: 2.5 * GiB }, 'Kolibri', 'idea03')).toBe(DELETE_FAILED_SIZE);
    expect(leftoverTempBackupText({ ...base, state: 'delete-failed', sizeBytes: null }, 'Kolibri', 'idea03')).toBe(DELETE_FAILED_NO_SIZE);
    expect(leftoverTempBackupText({ ...base, state: 'delete-failed', sizeBytes: 1024 }, 'Kolibri', 'idea03')).toContain('takes less than 0.1 GB.');
  });
  it('kept: do-not-remove wording', () => {
    expect(leftoverTempBackupText({ ...base, state: 'kept', sizeBytes: null }, 'Kolibri', 'idea03')).toBe(KEPT);
  });
  it('no Engine or App name, and never the path or Engine words', () => {
    const t = leftoverTempBackupText({ ...base, state: 'kept', sizeBytes: null }, '', null);
    expect(t).toBe("IDEA kept the backup it made before the update on this Engine's own disk, in case the app needs it. Ask for help before removing it.");
    for (const s of [t, DELETE_FAILED_SIZE, DELETE_FAILED_NO_SIZE]) expect(s).not.toMatch(/idea-temp-backups|tempBackup|delete-failed|temporary/);
  });
  it('raw text: the Engine warning, else the path', () => {
    expect(leftoverTempBackupRaw({ state: 'delete-failed', path: PATH, sizeBytes: null, warning: WARNING })).toBe(WARNING);
    expect(leftoverTempBackupRaw({ state: 'kept', path: PATH, sizeBytes: null, warning: null })).toContain(PATH);
  });
  it('the failed outcome drops the kept-at-path clause', () => {
    expect(stripTempBackupKept(`Health failed: x; the temporary pre-update backup is kept at ${PATH}`)).toBe('Health failed: x');
    const ctx: RefusalCtx = { app: 'Kolibri', fromVersion: '0.15.5', engine: 'idea03', diskName: 'Apps disk', hostEngine: 'idea03' };
    const out = updateOutcome(op(tbArgs('kept'), { status: 'Failed', error: `The update stopped early; the temporary pre-update backup is kept at ${PATH}` }), inst(), 'Kolibri', '0.15.5', ctx);
    expect(out?.text).not.toContain(PATH);
  });
});

describe('UpdateAppControl leftover line (console#230)', () => {
  it('delete-failed: the sentence with the size; the warning only behind Technical details', () => {
    setup([op(tbArgs('delete-failed', { tempBackupWarning: WARNING }))], [okTrace({ tempBackup: { path: PATH, sizeBytes: 2.5 * GiB, deleted: false } })]);
    const el = screen.getByTestId('update-leftover-backup-i1');
    expect(el.querySelector('.tech-details__plain')?.textContent).toBe(DELETE_FAILED_SIZE);
    const details = el.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(el.querySelector('.tech-details__raw')?.textContent).toBe(WARNING);
  });
  it('delete-failed without a trace: the sentence without the size', () => {
    setup([op(tbArgs('delete-failed'))]);
    expect(screen.getByTestId('update-leftover-backup-i1').querySelector('.tech-details__plain')?.textContent).toBe(DELETE_FAILED_NO_SIZE);
  });
  it('kept after a failed update: the do-not-remove sentence, path behind Technical details', () => {
    setup([op(tbArgs('kept'), { status: 'Failed', error: `ROLLED BACK: Health failed; the temporary pre-update backup is kept at ${PATH}` })]);
    const el = screen.getByTestId('update-leftover-backup-i1');
    expect(el.querySelector('.tech-details__plain')?.textContent).toBe(KEPT);
    expect(el.querySelector('.tech-details__raw')?.textContent).toContain(PATH);
  });
  it('no line for deleted, created, no args, or when a newer op has no leftover', () => {
    for (const ops of [
      [op(tbArgs('deleted'))],
      [op(tbArgs('created'), { status: 'Running', completedAt: null })],
      [op({})],
      [op(tbArgs('delete-failed')), op({}, { id: 'op2', startedAt: T + 120_000 })],
    ]) {
      setup(ops);
      expect(screen.queryByTestId('update-leftover-backup-i1')).toBeNull();
      cleanup();
    }
  });
});
