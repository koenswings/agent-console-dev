/**
 * engine#456: 12 named update steps (with six-step fallback), Instance.updatePending
 * and new update error codes. Raw codes stay behind Technical details.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createSignal } from 'solid-js';
import { render, cleanup, screen, fireEvent } from '@solidjs/testing-library';
import UpdateAppControl from '../src/components/UpdateAppControl';
import OperationProgress from '../src/components/OperationProgress';
import { setSendCommandFn } from '../src/store/commands';
import {
  BACKUP_STEP, BACKUP_STEP_TEXT, LEGACY_STEPS, ROLLBACK_FAILED_PREFIX, ROLLBACK_START_FAILED_PREFIX, STEPS,
  currentStep, friendlyUpdateError, isRollbackStartFailed, isRolledBackUpdateError, parseRefusal, resetDismissed, stepLabel, updateOpErrorText,
  updateOpFailedPlainText, updateOutcome, updatePendingText, type RefusalCtx,
} from '../src/store/updateApp';
import { historyRowView } from '../src/store/historyRow';
import type { CommandLogState } from '../src/store/commandLog';
import type { CommandTrace } from '../src/types/commandLog';
import type { App, Disk, Engine, Instance, Operation, Store } from '../src/types/store';

const T = 1_700_000_000_000;
const PENDING = 'Kolibri is working, but its update is not finished yet. Press Finish update to finish it.';
const SETUP = 'The new version of Kolibri could not be set up, so IDEA put the old version back. Your data is safe.';
const SETTLE = 'Kolibri runs the new version, but the last part of the update failed. Press Finish update to try again, or ask for help.';
const ROLLBACK_START = 'IDEA put back the old version of Kolibri and its data, but it does not start. Ask for help.';
const ctx: RefusalCtx = { app: 'Kolibri', fromVersion: '0.15.5', engine: 'idea03', diskName: 'Apps disk', hostEngine: 'idea03' };

const engine = (): Engine => ({
  id: 'ENG1', hostname: 'idea03', version: '1', hostOS: 'Linux', created: T, lastBooted: T, lastRun: Date.now(),
  lastHalted: null, commands: [], capabilities: ['updateApp'] as Engine['capabilities'], capabilitiesBootedAt: T,
} as Engine);
const app = (id: string, version: string): App => ({ id, name: 'kolibri', version, title: 'Kolibri', description: null, url: null, category: 'education', icon: null, author: null } as App);
const inst = (extra: Partial<Instance> = {}): Instance => ({
  id: 'i1', instanceOf: 'kolibri-1.0.0', name: 'kolibri', status: 'Running', port: 8080, serviceImages: [], created: T,
  lastBackup: null, lastStarted: T, storedOn: 'D1', statusCondition: null, currentStep: null, totalSteps: null,
  stepLabel: null, metrics: null, previousAppId: 'kolibri-0.15.5', ...extra,
} as Instance);
const op = (extra: Partial<Operation> = {}): Operation => ({
  id: 'op1', kind: 'updateApp', args: { instanceId: 'i1' }, cause: 'console-command' as Operation['cause'], subject: null,
  engineId: 'ENG1', status: 'Running', progressPercent: null, currentStep: null, totalSteps: 12, stepLabel: null,
  startedAt: T, completedAt: null, error: null, ...extra,
});
const mkStore = (i: Instance, ops: Operation[] = []): Store => ({
  engineDB: { ENG1: engine() }, diskDB: { D1: { id: 'D1', name: 'Apps disk', dockedTo: 'ENG1' } as Disk },
  appDB: { 'kolibri-0.15.5': app('kolibri-0.15.5', '0.15.5'), 'kolibri-1.0.0': app('kolibri-1.0.0', '1.0.0') },
  instanceDB: { i1: i }, userDB: {}, operationDB: Object.fromEntries(ops.map((o) => [o.id, o])),
} as unknown as Store);
const setup = (i: Instance, ops: Operation[] = []) => {
  const s = mkStore(i, ops);
  const [cls] = createSignal<CommandLogState>({ traces: {}, recentTraceIds: [] } as unknown as CommandLogState);
  return render(() => <UpdateAppControl instance={() => s.instanceDB.i1} engine={() => s.engineDB.ENG1} store={() => s} commandLog={cls} appTitle={() => 'Kolibri'} />);
};

beforeEach(() => { localStorage.clear(); resetDismissed(); });
afterEach(() => cleanup());

describe('engine#456 update steps', () => {
  it('has the final 12 step names and keeps the six-step list', () => {
    expect(STEPS).toEqual(['Fetch', 'Check', 'Backup', 'Snapshot', 'Swap', 'LoadImages', 'Prepare', 'Start', 'Health', 'Verify', 'Work', 'Settle']);
    expect(LEGACY_STEPS).toEqual(['Fetch', 'Check', 'Snapshot', 'Swap', 'Start', 'Health']);
  });
  it('uses step names first, including stepLabel names', () => {
    expect(currentStep(op({ stepLabel: 'Prepare', currentStep: 0 }), null)).toBe('Prepare');
    expect(currentStep(op({ stepLabel: 'Health', currentStep: 0 }), { step: 'Verify', bytesDone: null, bytesTotal: null, receivedAt: T })).toBe('Verify');
  });
  it('maps 12-step and old 6-step indices through their own lists', () => {
    expect(STEPS.map((_, i) => currentStep(op({ currentStep: i }), null))).toEqual(STEPS);
    expect(LEGACY_STEPS.map((_, i) => currentStep(op({ currentStep: i, totalSteps: 6 }), null))).toEqual(LEGACY_STEPS);
    expect(currentStep(op({ currentStep: 4, totalSteps: 6 }), null)).toBe('Start');
    expect(currentStep(op({ currentStep: 4, totalSteps: 12 }), null)).toBe('Swap');
  });
  it('treats Backup and engine#469 backup text as one step', () => {
    expect(currentStep(op({ stepLabel: 'Pre-update backup to Backup disk (1 GB)', currentStep: 2 }), { step: BACKUP_STEP, bytesDone: null, bytesTotal: null, receivedAt: T })).toBe(BACKUP_STEP);
    expect(currentStep(op({ stepLabel: 'Temporary pre-update backup on the system disk (1 GB)', currentStep: 1, totalSteps: 6 }), null)).toBe(BACKUP_STEP);
    expect(currentStep(op({ status: 'Done', completedAt: T + 1, stepLabel: 'Pre-update backup to Backup disk', currentStep: 2 }), null)).toBe('Backup');
  });
  it('has the agreed step labels', () => {
    expect(['LoadImages', 'Prepare', 'Verify', 'Work', 'Settle', 'Backup'].map((s) => stepLabel(s, null, 'x'))).toEqual([
      'Loading the new version', 'Preparing the new version', 'Checking the new version', 'Finishing the update', 'Finishing the update', BACKUP_STEP_TEXT,
    ]);
  });
});

describe('engine#456 error text', () => {
  it('maps leading codes only, with plain teacher sentences', () => {
    expect(friendlyUpdateError('PREPARE_FAILED: exit 2', ctx)).toBe(SETUP);
    expect(friendlyUpdateError('VERIFY_FAILED: exit 1', ctx)).toBe(SETUP);
    expect(friendlyUpdateError('MIGRATIONS_PENDING: timed out', ctx)).toBe(PENDING);
    expect(friendlyUpdateError('SETTLE_FAILED: exit 1', ctx)).toBe(SETTLE);
    expect(friendlyUpdateError('ROLLBACK_START_FAILED: compose failed', ctx)).toBe(ROLLBACK_START);
    expect(friendlyUpdateError('UPDATE_PENDING: finish the current update first', ctx)).toBe(
      'The last update of Kolibri is not finished yet. Press Finish update to finish it first. Nothing changed.',
    );
    expect(parseRefusal('note PREPARE_FAILED: in a log').code).toBeNull();
    for (const text of [PENDING, SETUP, SETTLE, ROLLBACK_START]) expect(text).not.toMatch(/[A-Z]{2,}_[A-Z]+|\/|Engine/);
  });
  it('handles rollback-start-failed like rollback-failed and keeps both prefixes', () => {
    expect(ROLLBACK_FAILED_PREFIX).toBe('ROLLBACK FAILED:');
    expect(ROLLBACK_START_FAILED_PREFIX).toBe('ROLLBACK START FAILED:');
    const i = inst({ status: 'Stopped', statusCondition: 'ROLLBACK START FAILED: compose failed' });
    expect(isRollbackStartFailed(i)).toBe(true);
    expect(updateOutcome(op({ status: 'Failed', completedAt: T + 1, error: 'ROLLBACK_START_FAILED: compose failed' }), i, 'Kolibri', '0.15.5', ctx)).toEqual({ kind: 'stopped', text: ROLLBACK_START });
  });
  it('SETTLE_FAILED and MIGRATIONS_PENDING are not rolled-back Failed-card text', () => {
    const settle = op({ status: 'Failed', completedAt: T + 1, error: 'SETTLE_FAILED: exit 1; the temporary pre-update backup is kept at /x' });
    const pending = op({ id: 'op2', status: 'Failed', completedAt: T + 1, error: 'MIGRATIONS_PENDING: timed out' });
    const rolled = op({ id: 'op3', status: 'Failed', completedAt: T + 1, error: 'PREPARE_FAILED: exit 2' });
    const s = mkStore(inst(), [settle, pending, rolled]);
    expect(isRolledBackUpdateError(settle.error!)).toBe(false);
    expect(isRolledBackUpdateError(pending.error!)).toBe(false);
    expect(isRolledBackUpdateError(rolled.error!)).toBe(true);
    expect(updateOpFailedPlainText(settle, s)).toBe(SETTLE);
    expect(updateOpErrorText(settle, s)).toBe(SETTLE);
    expect(updateOpFailedPlainText(pending, s)).toBe(PENDING);
    expect(updateOpFailedPlainText(rolled, s)).toBe(SETUP);
  });
  it('the Ops card and History show plain text with raw codes behind Technical details', () => {
    const o = op({ status: 'Failed', completedAt: T + 1, error: 'SETTLE_FAILED: exit 1' });
    const s = mkStore(inst(), [o]);
    expect(updateOpErrorText(o, s)).toBe(SETTLE);
    const r = render(() => <OperationProgress store={() => s} commandLogStore={() => null} />);
    const details = r.getByTestId('operation-error-op1');
    expect(details.querySelector('.tech-details__plain')?.textContent).toBe(SETTLE);
    expect(details.querySelector('.tech-details__raw')?.textContent).toBe('SETTLE_FAILED: exit 1');
    const trace = { traceId: 't1', command: 'updateApp', args: { instanceId: 'i1' }, startedAt: T, completedAt: T + 1, status: 'error', errorMessage: 'VERIFY_FAILED: exit 1', logs: [] } as unknown as CommandTrace;
    expect(historyRowView(trace, 'Kolibri')).toEqual({ tone: 'error', icon: '✗', message: SETUP });
  });
});

describe('Instance.updatePending', () => {
  it('shows the pending sentence and Finish update even with no newer version', () => {
    setup(inst({ updatePending: true }));
    expect(screen.getByTestId('update-pending-i1').textContent).toBe(PENDING);
    expect(screen.getByTestId('update-badge-i1').textContent).toBe('Finish update');
    expect(updatePendingText('Kolibri')).toBe(PENDING);
  });
  it('Finish update re-sends updateApp for the same instance with the existing builder', () => {
    const send = vi.fn();
    setSendCommandFn(send);
    setup(inst({ updatePending: true }));
    fireEvent.click(screen.getByTestId('update-badge-i1'));
    expect(send).toHaveBeenCalledWith('ENG1', 'updateApp i1 kolibri-1.0.0');
  });
  it('MIGRATIONS_PENDING uses the pending line, not a second outcome line', () => {
    setup(inst({ updatePending: true }), [op({ status: 'Failed', completedAt: T + 1, error: 'MIGRATIONS_PENDING: timed out' })]);
    expect(screen.getByTestId('update-pending-i1').textContent).toBe(PENDING);
    expect(screen.queryByTestId('update-outcome-i1')).toBeNull();
  });
  it('a Stopped ROLLBACK START FAILED instance keeps its sentence after a reload', () => {
    setup(inst({ status: 'Stopped', statusCondition: 'ROLLBACK START FAILED: compose failed' }));
    expect(screen.getByTestId('update-outcome-i1').textContent).toBe(ROLLBACK_START);
  });
  it('undefined and false mean no pending update', () => {
    setup(inst());
    expect(screen.queryByTestId('update-pending-i1')).toBeNull();
    cleanup();
    setup(inst({ updatePending: false }));
    expect(screen.queryByTestId('update-pending-i1')).toBeNull();
  });
});
