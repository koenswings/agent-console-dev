/**
 * engine#469 / agent-engine-dev#472: a major update with no linked Backup Disk docked makes a
 * temporary backup on the system disk. The Console lets the update start (the Engine makes the
 * backup first), names the backup step, and gives the new refusals plain sentences.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createSignal } from 'solid-js';
import { render, fireEvent, cleanup, screen } from '@solidjs/testing-library';
import UpdateAppControl from '../src/components/UpdateAppControl';
import HistoryPanel from '../src/components/HistoryPanel';
import { setSendCommandFn } from '../src/store/commands';
import {
  BACKUP_STEP, BACKUP_STEP_TEXT, REFUSAL_TEXT, currentStep, friendlyUpdateError, isTempBackupRefusal, parseRefusal,
  parseTempBackupNoSpace, resetDismissed, restartFailedText, stepLabel, updateOutcome, type RefusalCtx, type UpdateProgress,
} from '../src/store/updateApp';
import { historyRowView, historyTempBackupText, historyUpdatePlainText } from '../src/store/historyRow';
import type { CommandLogState } from '../src/store/commandLog';
import type { App, Disk, Engine, Instance, Operation, Store } from '../src/types/store';
import type { CommandLogStore, CommandTrace } from '../src/types/commandLog';

const T = 1_700_000_000_000;
const GiB = 1024 ** 3;

// Engine Check refusal (UpdateApp.ts tempBackupSpace), App Disk on the system disk.
const NO_SPACE_CHECK = `TEMP_BACKUP_NO_SPACE: the temporary pre-update backup on the system disk needs ${3 * GiB} bytes (3.0 GiB: ${2 * GiB} bytes of data + margin) plus ${4 * GiB} bytes for the snapshot on the same disk, free ${5 * GiB} bytes (5.0 GiB). Free space on the system disk or dock a Backup Disk linked to this instance; nothing was stopped or changed`;
// Helper re-check inside the Snapshot stop (idea-app-data temp-backup-create, exit 3).
const NO_SPACE_HELPER = `TEMP_BACKUP_NO_SPACE: the temporary backup needs ${2 * GiB} bytes (1048576 KB folder + 1048576 KB margin; 0 KB excluded), free ${1 * GiB} bytes on the system disk`;
const FAILED_PRE = 'TEMP_BACKUP_FAILED: /usr/bin/borg is not installed, so Backup Disk backups and restores cannot run. Dock a Backup Disk linked to this instance instead; nothing was stopped or changed';
const FAILED_IN_STOP = 'TEMP_BACKUP_FAILED: the temporary pre-update backup on the system disk failed: borg check exited 1';
const HELPER_TEMP = "HELPER_OUTDATED: the temporary pre-update backup on the system disk (engine#469) needs the app-data root helper /usr/local/sbin/idea-app-data v18 or later, but the installed one reports 'idea-app-data 17'; run ./install-root-helpers. Dock a Backup Disk linked to this instance instead; nothing was stopped or changed";
const HELPER_PLAIN = "HELPER_OUTDATED: updateApp needs the app-data root helper v14 or later, but the installed one reports 'idea-app-data 12'";

const ctx: RefusalCtx = { app: 'Kolibri', fromVersion: '0.15.5', engine: 'idea03', diskName: 'Apps disk', hostEngine: 'idea03' };

const NO_SPACE_SENTENCE = "There isn't enough free space on idea03's own disk for the backup IDEA makes before this update: it needs 7.0 GB and only 5.0 GB is free. Nothing changed: Kolibri works as before. Dock a Backup Disk for Kolibri, or make room on idea03, then try again.";
const FAILED_SENTENCE = "IDEA couldn't make a backup of Kolibri on idea03's own disk, so Kolibri wasn't updated. Nothing changed: Kolibri keeps its current version and all its data. Dock a Backup Disk for Kolibri and try again, or ask for help.";
const HELPER_SENTENCE = "idea03 needs a system update before it can back up Kolibri on its own disk, so Kolibri wasn't updated. Nothing changed. Dock a Backup Disk for Kolibri and try again, or ask for help.";

const engine = (): Engine => ({
  id: 'ENG1', hostname: 'idea03', version: '1', hostOS: 'Linux', created: T, lastBooted: T, lastRun: Date.now(),
  lastHalted: null, commands: [], capabilities: ['updateApp', 'updateAppFetch'] as Engine['capabilities'], capabilitiesBootedAt: T,
} as Engine);
const app = (id: string, version: string): App => ({
  id, name: 'kolibri', version, title: 'Kolibri', description: null, url: null, category: 'education', icon: null, author: null,
} as App);
const inst = (extra: Record<string, unknown> = {}): Instance => ({
  id: 'i1', instanceOf: 'kolibri-0.15.5', name: 'kolibri', status: 'Running', port: 8080, serviceImages: [], created: T,
  lastBackup: null, lastStarted: T, storedOn: 'D1', statusCondition: null, currentStep: null, totalSteps: null,
  stepLabel: null, metrics: null, updateAvailable: { appId: 'kolibri-1.0.0' }, ...extra,
} as Instance);
const op = (extra: Partial<Operation> = {}): Operation => ({
  id: 'op1', kind: 'updateApp', args: { instanceId: 'i1' }, cause: 'console-command' as Operation['cause'], subject: null,
  engineId: 'ENG1', status: 'Running', progressPercent: null, currentStep: 2, totalSteps: 6,
  stepLabel: 'Temporary pre-update backup on the system disk (no Backup Disk linked; inside the snapshot stop)',
  startedAt: T, completedAt: null, error: null, ...extra,
});
const mkStore = (i: Instance, ops: Operation[] = []): Store => ({
  engineDB: { ENG1: engine() },
  diskDB: { D1: { id: 'D1', name: 'Apps disk', dockedTo: 'ENG1' } as Disk },
  appDB: { 'kolibri-0.15.5': app('kolibri-0.15.5', '0.15.5'), 'kolibri-1.0.0': app('kolibri-1.0.0', '1.0.0') },
  instanceDB: { i1: i }, userDB: {}, operationDB: Object.fromEntries(ops.map((o) => [o.id, o])),
} as unknown as Store);
const trace = (errorMessage: string, over: Partial<CommandTrace> = {}): CommandTrace => ({
  traceId: 't1', command: 'updateApp', args: JSON.stringify(['i1 kolibri-1.0.0 --allow-major']),
  startedAt: T, completedAt: T + 1_000, status: 'error', errorMessage, logs: [], ...over,
});
const live = (step: string): UpdateProgress => ({ step, bytesDone: null, bytesTotal: null, receivedAt: T });

beforeEach(() => { localStorage.clear(); resetDismissed(); });
afterEach(() => cleanup());

describe('refusal sentences (engine#469)', () => {
  it('TEMP_BACKUP_NO_SPACE at Check: need counts the snapshot on the same disk; names the Engine', () => {
    expect(parseRefusal(NO_SPACE_CHECK).code).toBe('TEMP_BACKUP_NO_SPACE');
    expect(parseTempBackupNoSpace(parseRefusal(NO_SPACE_CHECK).detail)).toEqual({ needBytes: 7 * GiB, freeBytes: 5 * GiB });
    expect(friendlyUpdateError(NO_SPACE_CHECK, ctx)).toBe(NO_SPACE_SENTENCE);
  });
  it('TEMP_BACKUP_NO_SPACE from the helper inside the stop', () => {
    expect(friendlyUpdateError(NO_SPACE_HELPER, ctx)).toBe(
      "There isn't enough free space on idea03's own disk for the backup IDEA makes before this update: it needs 2.0 GB and only 1.0 GB is free. Nothing changed: Kolibri works as before. Dock a Backup Disk for Kolibri, or make room on idea03, then try again.",
    );
  });
  it('TEMP_BACKUP_NO_SPACE without numbers, and without a known Engine name', () => {
    expect(REFUSAL_TEXT.TEMP_BACKUP_NO_SPACE({ ...ctx, hostEngine: null }, 'disk full')).toBe(
      "There isn't enough free space on this Engine's own disk for the backup IDEA makes before this update. Nothing changed: Kolibri works as before. Dock a Backup Disk for Kolibri, or make room on this Engine, then try again.",
    );
  });
  it('TEMP_BACKUP_FAILED before the stop and inside it', () => {
    expect(friendlyUpdateError(FAILED_PRE, ctx)).toBe(FAILED_SENTENCE);
    expect(friendlyUpdateError(FAILED_IN_STOP, ctx)).toBe(FAILED_SENTENCE);
  });
  it('HELPER_OUTDATED for the temporary backup vs the general one', () => {
    expect(friendlyUpdateError(HELPER_TEMP, ctx)).toBe(HELPER_SENTENCE);
    expect(friendlyUpdateError(HELPER_TEMP, { ...ctx, hostEngine: null })).toMatch(/^This Engine needs a system update before it can back up Kolibri/);
    expect(friendlyUpdateError(HELPER_PLAIN, ctx)).toBe('This Engine needs a system update before Apps can be updated. Nothing changed.');
  });
  it('isTempBackupRefusal', () => {
    for (const m of [NO_SPACE_CHECK, NO_SPACE_HELPER, FAILED_PRE, FAILED_IN_STOP, HELPER_TEMP]) expect(isTempBackupRefusal(m)).toBe(true);
    for (const m of [HELPER_PLAIN, 'NO_SPACE: snapshot needs 1 bytes, free 0 bytes', 'NEEDS_BACKUP: x', 'boom']) expect(isTempBackupRefusal(m)).toBe(false);
  });
  it('restartFailed still wins over the code', () => {
    expect(friendlyUpdateError(`${FAILED_IN_STOP}; the update failed and the old version could not be restarted: x`, ctx, { restartFailed: true }))
      .toBe(restartFailedText('Kolibri'));
  });
  it('a failed op with a temp-backup error reads as the sentence (no raw text, no path)', () => {
    const failed = op({ status: 'Failed', completedAt: T + 1, error: NO_SPACE_HELPER });
    expect(updateOutcome(failed, inst(), 'Kolibri', '0.15.5', ctx)).toEqual({ kind: 'failed', text: friendlyUpdateError(NO_SPACE_HELPER, ctx) });
  });
});

describe('backup step (engine#469 / idea#448)', () => {
  it('the temporary backup stepLabel shows as "Making a backup first" (live Snapshot or none)', () => {
    expect(currentStep(op(), live('Snapshot'))).toBe(BACKUP_STEP);
    expect(currentStep(op(), null)).toBe(BACKUP_STEP);
    expect(stepLabel(BACKUP_STEP, null, 'x')).toBe(BACKUP_STEP_TEXT);
    expect(BACKUP_STEP_TEXT).toBe('Making a backup first');
  });
  it('the Backup Disk pre-update backup too, including the hook before the stop (live Check)', () => {
    expect(currentStep(op({ currentStep: 1, stepLabel: 'Pre-update backup to Backup A (hook, no stop)' }), live('Check'))).toBe(BACKUP_STEP);
    expect(currentStep(op({ stepLabel: 'Pre-update backup to Backup A (inside the snapshot stop)' }), live('Snapshot'))).toBe(BACKUP_STEP);
  });
  it('a later live step wins over a stale backup stepLabel', () => {
    expect(currentStep(op(), live('Swap'))).toBe('Swap');
  });
  it('after a reload a long Engine stepLabel maps through the step index', () => {
    const snapshotDone = op({ stepLabel: 'Snapshot /media/D1/.pre-update/i1 (123 bytes)', currentStep: 2, totalSteps: 6 });
    expect(stepLabel(currentStep(snapshotDone, null), null, 'x')).toBe('Saving a safety copy');
    expect(currentStep(op({ stepLabel: 'Swap', currentStep: 3 }), null)).toBe('Swap');
    // Unknown step count: keep the label.
    expect(currentStep(op({ stepLabel: 'Something', currentStep: 9, totalSteps: 10 }), null)).toBe('Something');
  });
  it('a finished op is never shown as backing up', () => {
    expect(currentStep(op({ status: 'Failed', completedAt: T + 1 }), null)).not.toBe(BACKUP_STEP);
  });
});

describe('UpdateAppControl (engine#469)', () => {
  const setup = (i: Instance, ops: Operation[] = []) => {
    const s = mkStore(i, ops);
    const [cls, setCls] = createSignal<CommandLogState>({ traces: {}, recentTraceIds: [] } as unknown as CommandLogState);
    const send = vi.fn();
    setSendCommandFn(send);
    render(() => (
      <UpdateAppControl instance={() => s.instanceDB.i1} engine={() => s.engineDB.ENG1} store={() => s} commandLog={cls} appTitle={() => 'Kolibri'} />
    ));
    return { setCls, send };
  };
  const refuse = (setCls: (c: CommandLogState) => void, message: string) => {
    const log: CommandLogStore = { traces: { t1: trace(message, { args: { instanceId: 'i1' } }) }, recentTraceIds: ['t1'] };
    setCls(log as unknown as CommandLogState);
  };

  it('major without a recent backup: Update is enabled and the confirm says the backup comes first', () => {
    const { send } = setup(inst());
    fireEvent.click(screen.getByTestId('update-badge-i1'));
    const confirm = screen.getByTestId('update-confirm-i1');
    expect(confirm.textContent).toContain('Kolibri 1.0.0 is a major update. IDEA makes a backup of Kolibri first, so it takes a little longer.');
    expect(confirm.textContent).not.toContain('backed up in the last hour');
    expect(screen.queryByTestId('update-confirm-needs-backup-i1')).toBeNull();
    fireEvent.click(screen.getByTestId('update-confirm-btn-i1'));
    expect(send).toHaveBeenCalledWith('ENG1', 'updateApp i1 kolibri-1.0.0 --allow-major');
  });
  it('a backup from the last hour: no backup-first line', () => {
    setup(inst({ lastBackup: Date.now() - 60_000 }));
    fireEvent.click(screen.getByTestId('update-badge-i1'));
    expect(screen.getByTestId('update-confirm-i1').textContent).not.toContain('makes a backup');
  });
  it('an older Engine still refusing NEEDS_BACKUP: the badge locks with the hint', () => {
    const { setCls } = setup(inst());
    fireEvent.click(screen.getByTestId('update-badge-i1'));
    fireEvent.click(screen.getByTestId('update-confirm-btn-i1'));
    refuse(setCls, 'NEEDS_BACKUP: Dock a Backup Disk linked to this instance (updateApp then takes the backup itself), or make a backup first');
    expect((screen.getByTestId('update-badge-i1') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('update-needs-backup-i1').textContent).toBe('Dock a Backup Disk and make a backup first');
  });
  it('TEMP_BACKUP_NO_SPACE refusal: the sentence names this Engine; the badge stays usable', () => {
    const { setCls } = setup(inst());
    fireEvent.click(screen.getByTestId('update-badge-i1'));
    fireEvent.click(screen.getByTestId('update-confirm-btn-i1'));
    refuse(setCls, NO_SPACE_CHECK);
    expect(screen.getByTestId('update-error-i1').textContent).toBe(NO_SPACE_SENTENCE);
    expect((screen.getByTestId('update-badge-i1') as HTMLButtonElement).disabled).toBe(false);
  });
  it('while the temporary backup runs the step reads "Making a backup first"', () => {
    setup(inst(), [op()]);
    expect(screen.getByTestId('update-step-i1').textContent).toBe('Making a backup first');
  });
});

describe('History (engine#469)', () => {
  it('a temp-backup refusal row shows the sentence; raw text behind Technical details', () => {
    const t = trace(NO_SPACE_CHECK);
    const sentence = REFUSAL_TEXT.TEMP_BACKUP_NO_SPACE({ app: 'Kolibri', fromVersion: '', engine: '', diskName: null }, parseRefusal(NO_SPACE_CHECK).detail);
    expect(sentence).toContain("this Engine's own disk");
    expect(historyTempBackupText(t, 'Kolibri')).toBe(sentence);
    expect(historyRowView(t, 'Kolibri')).toEqual({ tone: 'error', icon: '✗', message: sentence });
    const s = mkStore(inst());
    const r = render(() => <HistoryPanel commandLogStore={() => ({ traces: { t1: t }, recentTraceIds: ['t1'] })} store={() => s} onClose={() => {}} />);
    expect(r.getByTestId('history-entry-message-t1').textContent).toBe(sentence);
    fireEvent.click(r.getByTestId('history-entry-status-t1').closest('button')!);
    const details = r.getByTestId('history-error-details');
    expect(details.querySelector('.tech-details__plain')?.textContent).toBe(sentence);
    expect(details.textContent).toContain('TEMP_BACKUP_NO_SPACE');
  });
  it('without an App name it says "the app"; other codes and commands are unchanged', () => {
    expect(historyTempBackupText(trace(FAILED_PRE), null)).toContain('a backup of the app');
    expect(historyUpdatePlainText(trace('NO_SPACE: snapshot needs 1 bytes, free 0 bytes'), 'Kolibri')).toBeNull();
    expect(historyUpdatePlainText(trace(FAILED_PRE, { command: 'backupApp' }), 'Kolibri')).toBeNull();
    expect(historyUpdatePlainText(trace(FAILED_PRE, { status: 'ok' }), 'Kolibri')).toBeNull();
  });
});
