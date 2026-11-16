/**
 * console#227: after an update whose restart failed (engine#442 / #445, forced on
 * test Pis by engine#467), the Console reads that state from the Engine store,
 * so a fresh page load (no session memory) shows the agreed sentence too.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createSignal } from 'solid-js';
import { render, fireEvent, cleanup } from '@solidjs/testing-library';
import { ImmutableString } from '@automerge/automerge-repo';
import InstanceRow from '../src/components/InstanceRow';
import OperationProgress from '../src/components/OperationProgress';
import HistoryPanel from '../src/components/HistoryPanel';
import {
  restartFailedBadgeTitle, restartFailedOpFor, restartFailedText, resetDismissed, updateOpRestartFailedText,
} from '../src/store/updateApp';
import { latestInstanceTrace, traceInstanceRefs, traceIsForInstance } from '../src/store/commandResult';
import { historyRestartFailedText, historyRowView, traceAppTitle } from '../src/store/historyRow';
import type { App, Disk, Engine, Instance, Operation, Store } from '../src/types/store';
import type { CommandLogStore, CommandTrace, LogTextValue } from '../src/types/commandLog';

const T = 1_700_000_000_000;
const RAW = 'ROLLED BACK: Snapshot failed: test hook: forced update failure; the update failed and the old version could not be restarted: test hook: forced restart failure';
const COND = 'the update failed and the old version could not be restarted: test hook: forced restart failure';
const SENTENCE = restartFailedText('Kolibri');

const engine = (): Engine => ({
  id: 'ENG1', hostname: 'idea03', version: '1', hostOS: 'Linux', created: T, lastBooted: T, lastRun: Date.now(),
  lastHalted: null, commands: [], capabilities: ['updateApp', 'updateAppFetch'] as Engine['capabilities'], capabilitiesBootedAt: T,
} as Engine);
const app = (id: string, version: string): App => ({
  id, name: 'kolibri', version, title: 'Kolibri', description: null, url: null, category: 'education', icon: null, author: null,
} as App);
const inst = (extra: Record<string, unknown> = {}): Instance => ({
  id: 'i1', instanceOf: 'kolibri-0.15.5', name: 'rf-throwaway', status: 'Error', port: 8080, serviceImages: [], created: T,
  lastBackup: null, lastStarted: T - 60_000, storedOn: 'D1', statusCondition: COND, currentStep: null, totalSteps: null,
  stepLabel: null, metrics: null, updateAvailable: { appId: 'kolibri-0.15.6' }, ...extra,
} as Instance);
const op = (extra: Partial<Operation> = {}): Operation => ({
  id: 'op1', kind: 'updateApp', args: { instanceId: 'i1' }, cause: 'console-command' as Operation['cause'], subject: null,
  engineId: 'ENG1', status: 'Failed', progressPercent: null, currentStep: null, totalSteps: null, stepLabel: null,
  startedAt: T, completedAt: T + 4_000, error: RAW, restartFailed: true, ...extra,
});
const mkStore = (i: Instance, ops: Operation[] = [op()]): Store => ({
  engineDB: { ENG1: engine() },
  diskDB: { D1: { id: 'D1', name: 'Apps disk', dockedTo: 'ENG1' } as Disk },
  appDB: { 'kolibri-0.15.5': app('kolibri-0.15.5', '0.15.5'), 'kolibri-0.15.6': app('kolibri-0.15.6', '0.15.6') },
  instanceDB: { i1: i }, userDB: {}, operationDB: Object.fromEntries(ops.map((o) => [o.id, o])),
} as unknown as Store);

const trace = (id: string, over: Partial<CommandTrace> = {}): CommandTrace => ({
  traceId: id, command: 'updateApp', args: JSON.stringify(['i1 kolibri-0.15.6 --allow-major']),
  startedAt: T, completedAt: T + 4_000, status: 'error', errorMessage: RAW, logs: [], ...over,
});
const log = (...ts: CommandTrace[]): CommandLogStore => ({
  traces: Object.fromEntries(ts.map((t) => [t.traceId, t])), recentTraceIds: ts.map((t) => t.traceId),
});
const imm = (s: string): LogTextValue => new ImmutableString(s) as unknown as LogTextValue;

beforeEach(() => { localStorage.clear(); resetDismissed(); });
afterEach(() => cleanup());

describe('restartFailedOpFor: Engine state, not session memory', () => {
  it('Error + newest finished updateApp op with restartFailed -> the op', () => {
    expect(restartFailedOpFor(mkStore(inst()), inst())?.id).toBe('op1');
  });
  it('clears when the App runs again, or is not in Error', () => {
    for (const status of ['Running', 'Starting', 'Stopped'] as const) {
      expect(restartFailedOpFor(mkStore(inst({ status })), inst({ status }))).toBeNull();
    }
  });
  it('clears when a newer updateApp op supersedes it, and while an update runs', () => {
    const newer = op({ id: 'op2', startedAt: T + 10_000, completedAt: T + 12_000, restartFailed: undefined, error: 'ROLLED BACK: x; nothing was changed' });
    expect(restartFailedOpFor(mkStore(inst(), [op(), newer]), inst())).toBeNull();
    const running = op({ id: 'op2', startedAt: T + 10_000, status: 'Running', completedAt: null, error: null, restartFailed: undefined });
    expect(restartFailedOpFor(mkStore(inst(), [op(), running]), inst())).toBeNull();
  });
  it('clears after a later start attempt (lastStarted after the op)', () => {
    const i = inst({ lastStarted: T + 60_000 });
    expect(restartFailedOpFor(mkStore(i), i)).toBeNull();
  });
  it('needs restartFailed: a plain failed update is not this state', () => {
    expect(restartFailedOpFor(mkStore(inst(), [op({ restartFailed: undefined })]), inst())).toBeNull();
  });
  it('falls back to the trace result { restartFailed: true } (plain or ImmutableString)', () => {
    const s = mkStore(inst(), [op({ restartFailed: undefined })]);
    expect(restartFailedOpFor(s, inst(), JSON.stringify({ restartFailed: true }))?.id).toBe('op1');
    expect(restartFailedOpFor(s, inst(), imm(JSON.stringify({ restartFailed: true })))?.id).toBe('op1');
  });
});

describe('fresh render (page reload) of the instance row', () => {
  const row = (s: () => Store, cls?: () => CommandLogStore | null) => render(() => (
    <InstanceRow
      instance={() => s().instanceDB.i1} app={() => s().appDB['kolibri-0.15.5']} engine={() => s().engineDB.ENG1}
      store={s} instanceId="i1" commandLogStore={cls}
    />
  ));

  it('shows the agreed sentence from the store alone, red, data-kind failed, no Retry/Resume', () => {
    const r = row(() => mkStore(inst()));
    const out = r.getByTestId('update-outcome-i1');
    expect(out.textContent).toBe(SENTENCE);
    expect(out.getAttribute('data-kind')).toBe('failed');
    expect(out.getAttribute('role')).toBe('alert');
    expect(r.queryByTestId('update-error-i1')).toBeNull();
    expect(r.queryByRole('button', { name: /^(retry|resume)$/i })).toBeNull();
    const hint = r.getByTestId('instance-error-hint-i1');
    expect(hint.textContent).toBe(COND);
    expect(hint.getAttribute('title')).toBe(COND);
  });

  it('the Update badge does not invite a retry: disabled, title points to Start', () => {
    const r = row(() => mkStore(inst()));
    const badge = r.getByTestId('update-badge-i1') as HTMLButtonElement;
    expect(badge.disabled).toBe(true);
    expect(badge.title).toBe(restartFailedBadgeTitle('Kolibri'));
    expect(badge.title).toBe("Kolibri is stopped. Start Kolibri again first, or ask for help if it doesn't start.");
  });

  it('Stop is disabled only in the restartFailed state; Start stays enabled', () => {
    const r = row(() => mkStore(inst()));
    const stop = r.getByTestId('stop-instance-i1') as HTMLButtonElement;
    expect(stop.disabled).toBe(true);
    expect(stop.title).toBe('Already stopped');
    expect((r.getByTestId('start-instance-i1') as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    const plain = row(() => mkStore(inst(), [op({ restartFailed: undefined })]));
    expect((plain.getByTestId('stop-instance-i1') as HTMLButtonElement).disabled).toBe(false);
    expect((plain.getByTestId('stop-instance-i1') as HTMLButtonElement).title).toBe('Stop app');
  });

  it('uses the command-log trace result when the op has no flag', () => {
    const s = mkStore(inst(), [op({ restartFailed: undefined })]);
    const r = row(() => s, () => log(trace('t1', { result: JSON.stringify({ restartFailed: true }) })));
    expect(r.getByTestId('update-outcome-i1').textContent).toBe(SENTENCE);
  });

  it('clears once the App runs again: sentence gone, badge and Stop enabled', () => {
    const [s, setS] = createSignal(mkStore(inst()));
    const r = row(s);
    expect(r.getByTestId('update-outcome-i1').textContent).toBe(SENTENCE);
    setS(mkStore(inst({ status: 'Running', statusCondition: null, lastStarted: T + 60_000 })));
    expect(r.queryByTestId('update-outcome-i1')).toBeNull();
    expect((r.getByTestId('update-badge-i1') as HTMLButtonElement).disabled).toBe(false);
    expect((r.getByTestId('stop-instance-i1') as HTMLButtonElement).disabled).toBe(false);
  });

  it('expanded row shows the positional updateApp trace, not an older named startInstance', () => {
    const start = trace('t0', {
      command: 'startInstance', args: JSON.stringify({ instanceId: 'i1', instanceName: 'rf-throwaway' }),
      startedAt: T - 60_000, completedAt: T - 59_000, status: 'ok', errorMessage: null,
    });
    const r = row(() => mkStore(inst()), () => log(start, trace('t1')));
    fireEvent.click(r.container.querySelector('button[aria-expanded]')!);
    expect(r.container.querySelector('.instance-row__cmd-log-name')?.textContent).toBe('updateApp');
  });
});

describe('traceIsForInstance: named and positional arg shapes', () => {
  it('named instanceId / instanceName (object or JSON text)', () => {
    expect(traceIsForInstance(trace('a', { args: { instanceId: 'i1' } }), 'i1')).toBe(true);
    expect(traceIsForInstance(trace('a', { args: JSON.stringify({ instanceName: 'rf-throwaway' }) }), 'i1', 'rf-throwaway')).toBe(true);
    expect(traceIsForInstance(trace('a', { args: { instanceId: 'i2' } }), 'i1', 'rf-throwaway')).toBe(false);
  });
  it('the real Engine updateApp form: ["<instance> <newAppId> --allow-major"] (plain and ImmutableString)', () => {
    expect(traceInstanceRefs(trace('a'))).toEqual(['i1']);
    expect(traceIsForInstance(trace('a'), 'i1')).toBe(true);
    expect(traceIsForInstance(trace('a', { args: imm(JSON.stringify(['i1 kolibri-0.15.6'])) }), 'i1')).toBe(true);
    expect(traceIsForInstance(trace('a', { args: JSON.stringify(['rf-throwaway kolibri-0.15.6 --source D1']) }), 'i1', 'rf-throwaway')).toBe(true);
    expect(traceIsForInstance(trace('a', { args: JSON.stringify(['i10 kolibri-0.15.6']) }), 'i1')).toBe(false);
  });
  it('no match for empty, missing or malformed args, and an unknown name never matches "undefined"', () => {
    expect(traceIsForInstance(trace('a', { args: JSON.stringify([]) }), 'i1')).toBe(false);
    expect(traceIsForInstance(trace('a', { args: '{nope' }), 'i1')).toBe(false);
    expect(traceIsForInstance(trace('a', { args: { diskId: 'D1' } }), 'i1', null)).toBe(false);
  });
  it('latestInstanceTrace picks the newest trace of that command', () => {
    const l = log(trace('old', { startedAt: T }), trace('new', { startedAt: T + 1 }), trace('other', { command: 'startInstance', startedAt: T + 2 }));
    expect(latestInstanceTrace(l, 'updateApp', 'i1')?.traceId).toBe('new');
  });
});

describe('Operations card and History: plain sentence, raw behind Technical details', () => {
  it('updateOpRestartFailedText: the sentence for a restartFailed updateApp op only', () => {
    const s = mkStore(inst());
    expect(updateOpRestartFailedText(op(), s)).toBe(SENTENCE);
    expect(updateOpRestartFailedText(op({ restartFailed: undefined }), s)).toBeNull();
    expect(updateOpRestartFailedText(op({ kind: 'backupApp' }), s)).toBeNull();
    expect(updateOpRestartFailedText(op(), null)).toBe(restartFailedText('the app'));
  });

  it('Operations card shows the sentence; the raw error sits in the closed Technical details', () => {
    const s = mkStore(inst());
    const r = render(() => <OperationProgress store={() => s} commandLogStore={() => null} />);
    const details = r.getByTestId('operation-error-op1');
    expect(details.querySelector('.tech-details__plain')?.textContent).toBe(SENTENCE);
    expect(details.querySelector('details.tech-details__toggle')?.hasAttribute('open')).toBe(false);
    expect(details.querySelector('.tech-details__raw')?.textContent).toBe(RAW);
  });

  it('a Failed update without restartFailed keeps its old card text', () => {
    const s = mkStore(inst(), [op({ restartFailed: undefined, error: 'ROLLED BACK: x; nothing was changed' })]);
    const r = render(() => <OperationProgress store={() => s} commandLogStore={() => null} />);
    expect(r.queryByTestId('operation-error-op1')).toBeNull();
    expect(r.container.querySelector('.operation-card__error')?.textContent).toBe('ROLLED BACK: x; nothing was changed');
  });

  it('History row: the sentence with the App name; raw text in Technical details', () => {
    const t = trace('t1', { result: imm(JSON.stringify({ restartFailed: true })) });
    const s = mkStore(inst());
    expect(traceAppTitle(s, t)).toBe('Kolibri');
    expect(historyRestartFailedText(t, 'Kolibri')).toBe(SENTENCE);
    expect(historyRowView(t, 'Kolibri')).toEqual({ tone: 'error', icon: '✗', message: SENTENCE });
    expect(historyRowView(t).message).toBe(restartFailedText('the app'));
    const r = render(() => <HistoryPanel commandLogStore={() => log(t)} store={() => s} onClose={() => {}} />);
    expect(r.getByTestId('history-entry-message-t1').textContent).toBe(SENTENCE);
    fireEvent.click(r.getByTestId('history-entry-status-t1').closest('button')!);
    const details = r.getByTestId('history-error-details');
    expect(details.querySelector('.tech-details__plain')?.textContent).toBe(SENTENCE);
    expect(details.querySelector('.tech-details__raw')?.textContent).toBe(RAW);
  });

  it('History keeps the old text for an update error without restartFailed', () => {
    const t = trace('t2', { errorMessage: 'ROLLED BACK: x; nothing was changed', result: JSON.stringify({}) });
    expect(historyRestartFailedText(t, 'Kolibri')).toBeNull();
    expect(historyRowView(t, 'Kolibri').message).toBe('ROLLED BACK: x; nothing was changed');
  });
});
