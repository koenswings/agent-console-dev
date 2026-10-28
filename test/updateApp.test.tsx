import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@solidjs/testing-library';
import InstanceRow from '../src/components/InstanceRow';
import { setSendCommandFn } from '../src/store/commands';
import {
  NEEDS_BACKUP_TEXT, NO_SUMS_TEXT, REFUSAL_TEXT, applyUpdateProgress, badgeText, buildUpdateAppCommand,
  confirmText, friendlyUpdateError, pausedText, resetDismissed, stepLabel, updateOfferFor, updateOutcome,
} from '../src/store/updateApp';
import type { App, Disk, Engine, Instance, Operation, Store } from '../src/types/store';

const T = Date.now();
const engine = (id: string, caps?: string[]): Engine => ({
  id, hostname: id === 'ENG1' ? 'idea04' : 'library-pi', version: '1', hostOS: 'Linux', created: T, lastBooted: T,
  lastRun: T, lastHalted: null, commands: [],
  ...(caps ? { capabilities: caps as Engine['capabilities'], capabilitiesBootedAt: T } : {}),
} as Engine);
const app = (id: string, version: string, extra: Record<string, unknown> = {}): App => ({
  id, name: 'kolibri', version, title: 'Kolibri', description: null, url: null, category: 'education', icon: null, author: null, ...extra,
} as App);
const inst = (extra: Record<string, unknown> = {}): Instance => ({
  id: 'i1', instanceOf: 'kolibri-0.15.5', name: 'kolibri', status: 'Running', port: 8080, serviceImages: [], created: T,
  lastBackup: null, lastStarted: T, storedOn: 'D1', statusCondition: null, currentStep: null, totalSteps: null,
  stepLabel: null, metrics: null, ...extra,
} as Instance);
const op = (status: Operation['status'], extra: Partial<Operation> = {}): Operation => ({
  id: 'op1', kind: 'upgradeApp', args: { instanceId: 'i1' }, cause: 'console-command' as Operation['cause'], subject: null,
  engineId: 'ENG1', status, progressPercent: null, currentStep: null, totalSteps: null, stepLabel: null,
  startedAt: T, completedAt: null, error: null, ...extra,
});
const mkStore = (i: Instance, ops: Operation[] = [], eng2Online = true): Store => ({
  engineDB: { ENG1: engine('ENG1', ['updateApp', 'updateAppFetch']), ENG2: { ...engine('ENG2'), lastRun: eng2Online ? T : 0 } },
  diskDB: { D1: { id: 'D1', name: 'Apps disk', dockedTo: 'ENG1' } as Disk },
  appDB: {
    'kolibri-0.15.5': app('kolibri-0.15.5', '0.15.5'),
    'kolibri-0.15.6': app('kolibri-0.15.6', '0.15.6'),
    'kolibri-1.0.0': app('kolibri-1.0.0', '1.0.0', { migrationNote: 'Big change: lessons move.' }),
  },
  instanceDB: { i1: i }, userDB: {}, operationDB: Object.fromEntries(ops.map((o) => [o.id, o])),
} as unknown as Store);
const ctx = { app: 'Kolibri', fromVersion: '0.15.5', engine: 'library-pi', diskName: 'Apps disk' };

beforeEach(() => { localStorage.clear(); resetDismissed(); });
afterEach(() => cleanup());

describe('updateApp adapter (provisional shapes)', () => {
  const caps = engine('ENG1', ['updateApp']);
  it('needs the updateApp capability (older Engines: no offer)', () => {
    const i = inst({ updateAvailable: { appId: 'kolibri-0.15.6' } });
    expect(updateOfferFor(mkStore(i), i, engine('ENG1'))).toBeNull();
    expect(updateOfferFor(mkStore(i), inst(), caps)).toBeNull();
    const o = updateOfferFor(mkStore(i), i, caps)!;
    expect(o).toMatchObject({ toAppId: 'kolibri-0.15.6', fromVersion: '0.15.5', toVersion: '0.15.6', major: false, estimatedMinutes: null, sourceEngineId: null });
  });
  it('cross-Engine needs updateAppFetch too', () => {
    const i = inst({ updateAvailable: { appId: 'kolibri-0.15.6', engineId: 'ENG2', sourceDiskId: 'SRC' } });
    expect(updateOfferFor(mkStore(i), i, caps)).toBeNull();
    const o = updateOfferFor(mkStore(i), i, engine('ENG1', ['updateApp', 'updateAppFetch']))!;
    expect(o.sourceEngineId).toBe('ENG2');
    expect(o.sourceDiskId).toBe('SRC');
  });
  it('reads the agreed richer fields and derives major + migrationNote', () => {
    const i = inst({ updateAvailable: { appId: 'kolibri-1.0.0', diskId: 'D9', estimatedMinutes: 7, sizeBytes: 5 } });
    const o = updateOfferFor(mkStore(i), i, caps)!;
    expect(o).toMatchObject({ major: true, estimatedMinutes: 7, sourceDiskId: 'D9', sizeBytes: 5, migrationNote: 'Big change: lessons move.' });
  });
  it('builds the command', () => {
    expect(buildUpdateAppCommand('i1', { toAppId: 'k-2', sourceDiskId: null, major: false })).toBe('updateApp i1 k-2');
    expect(buildUpdateAppCommand('i1', { toAppId: 'k-2', sourceDiskId: 'S', major: true })).toBe('updateApp i1 k-2 --source S --allow-major');
  });
  it('badge and confirm wording', () => {
    const o = { toAppId: 'x', fromVersion: '1', toVersion: '2', major: false, estimatedMinutes: 6, sourceDiskId: null, sourceEngineId: null, sizeBytes: null, migrationNote: null };
    expect(badgeText(o, null)).toBe('Update available: 1 to 2');
    expect(badgeText(o, 'library-pi')).toBe('Update available: 1 to 2 (on a disk in library-pi)');
    expect(confirmText('Kolibri', o, null)).toEqual([
      'Update Kolibri from 1 to 2?', "Your learners' work is kept.", 'Kolibri is unavailable for up to 6 minutes.',
      "If the new version doesn't work, IDEA switches back to the old one by itself.",
    ]);
    const cross = confirmText('Kolibri', { ...o, estimatedMinutes: null }, 'library-pi');
    expect(cross[2]).toBe('This can take a while.');
    expect(cross[4]).toBe('The new version is on a disk in library-pi. IDEA copies it here first, and Kolibri keeps working while it copies. Keep library-pi switched on until the copy is done.');
  });
  it('maps refusals (CODE: text) to plain sentences', () => {
    expect(friendlyUpdateError('NEEDS_BACKUP: no recent backup', ctx)).toBe(NEEDS_BACKUP_TEXT);
    expect(friendlyUpdateError('NO_SUMS: missing', ctx)).toBe(NO_SUMS_TEXT);
    expect(NO_SUMS_TEXT).toBe("This disk's new version can't be checked, so the app wasn't updated. Your app still works as before. Ask for a fresh copy of this App Disk.");
    expect(friendlyUpdateError('NO_SPACE: Apps disk', ctx)).toContain('Apps disk is full');
    expect(friendlyUpdateError('TRANSFER_FAILED: eof', ctx)).toBe("The copy from library-pi didn't finish, so nothing changed. Kolibri is still on 0.15.5. Try again while library-pi is switched on.");
    expect(friendlyUpdateError('SOURCE_MISSING: gone', ctx)).toBe('The disk with the new version is no longer in library-pi. Nothing changed.');
    expect(friendlyUpdateError('SOURCE_UNSUPPORTED', ctx)).toBe('library-pi needs a newer IDEA version before it can share this update. Nothing changed.');
    for (const code of Object.keys(REFUSAL_TEXT)) expect(friendlyUpdateError(`${code}: x`, ctx)).not.toContain(code);
    expect(friendlyUpdateError('something odd', ctx)).toBe('something odd');
  });
  it('maps the engine#268 codes NOT_FOUND, AMBIGUOUS, HELPER_OUTDATED', () => {
    expect(friendlyUpdateError("NOT_FOUND: instance 'x' not found on this Engine", ctx)).toBe('This app is no longer on this Engine. Nothing changed.');
    expect(friendlyUpdateError("AMBIGUOUS: instance name 'k' is shared by several instances on this Engine; use the instance id", ctx))
      .toBe("IDEA couldn't tell which copy of this app to update. Nothing changed. Ask for help.");
    expect(friendlyUpdateError('HELPER_OUTDATED: idea-app-data v4, need v5', ctx)).toBe('This Engine needs a system update before Apps can be updated. Nothing changed.');
  });
  it('NO_SPACE: plain GB amounts when the helper text parses, else the old message', () => {
    const g = 1024 ** 3;
    const msg = `NO_SPACE: snapshot needs ${3 * g} bytes (100 KB + 10 KB margin), free ${1.5 * g} bytes`;
    expect(friendlyUpdateError(msg, ctx)).toBe('Apps disk is too full: the safety copy needs 3.0 GB and only 1.5 GB is free. Make room and try again. Nothing changed.');
    expect(friendlyUpdateError('NO_SPACE: not enough free space on sdb1', ctx)).toBe('Apps disk is full. Make room and try again. Nothing changed.');
  });
  it('step labels, copy progress and pause', () => {
    const p = { step: 'Fetch', bytesDone: 1.5 * 1024 ** 3, bytesTotal: 3 * 1024 ** 3, receivedAt: 0 };
    expect(stepLabel('Fetch', p, 'library-pi')).toBe('Copying from library-pi: 1.5 of 3.0 GB');
    expect(['Check', 'Snapshot', 'Swap', 'Start', 'Health'].map((s) => stepLabel(s, null, 'x')))
      .toEqual(['Checking', 'Saving a safety copy', 'Installing', 'Starting', 'Checking it works']);
    expect(pausedText({ reason: 'temperature', bytesDone: null, bytesTotal: null }, 'library-pi'))
      .toBe('Paused while library-pi cools down. The copy continues by itself.');
    const next = applyUpdateProgress({}, { type: 'idea/updateProgress', engineId: 'ENG1', instanceId: 'i1', step: 'Fetch', bytesDone: 1, bytesTotal: 2 }, 5);
    expect(next.i1).toEqual({ step: 'Fetch', bytesDone: 1, bytesTotal: 2, receivedAt: 5 });
    expect(applyUpdateProgress(next, { type: 'idea/hb', engineId: 'ENG1' }, 6)).toBe(next);
  });
  it('outcomes: updated, rolled back, stopped', () => {
    expect(updateOutcome(op('Running'), inst(), 'Kolibri', '0.15.5', ctx)).toBeNull();
    expect(updateOutcome(op('Done'), inst(), 'Kolibri', '0.15.5', ctx)!.text).toBe('Updated from 0.15.5');
    expect(updateOutcome(op('Failed', { error: 'ROLLED BACK: health' }), inst(), 'Kolibri', '0.15.5', ctx)!.text)
      .toBe("The update didn't work, so Kolibri is back on 0.15.5 with all its data.");
    expect(updateOutcome(op('Failed', { error: 'ROLLED BACK: health' }), inst({ status: 'Stopped', statusCondition: 'ROLLBACK FAILED: snapshot restore' }), 'Kolibri', '0.15.5', ctx)!.text)
      .toBe('Kolibri is stopped. Nothing was deleted. Ask for help.');
    // A Stopped instance with some other condition is not a failed rollback.
    expect(updateOutcome(op('Failed', { error: 'BUSY: lock' }), inst({ status: 'Stopped', statusCondition: 'exited' }), 'Kolibri', '0.15.5', ctx)!.kind)
      .toBe('failed');
  });
});

describe('UpdateAppControl in InstanceRow', () => {
  const row = (s: Store, e: Engine = s.engineDB.ENG1) => render(() => (
    <InstanceRow instance={() => s.instanceDB.i1} app={() => s.appDB['kolibri-0.15.5']} engine={() => e} store={() => s} instanceId="i1" />
  ));
  it('older Engine: no badge even with the field', () => {
    const s = mkStore(inst({ updateAvailable: { appId: 'kolibri-0.15.6' } }));
    const r = row(s, engine('ENG1'));
    expect(r.queryByTestId('update-app-i1')).toBeNull();
  });
  it('badge → confirm → Update sends the command', () => {
    const send = vi.fn();
    setSendCommandFn(send);
    const r = row(mkStore(inst({ updateAvailable: { appId: 'kolibri-0.15.6' } })));
    fireEvent.click(r.getByTestId('update-badge-i1'));
    expect(r.getByTestId('update-confirm-i1').textContent).toContain('Update Kolibri from 0.15.5 to 0.15.6?');
    fireEvent.click(r.getByTestId('update-confirm-btn-i1'));
    expect(send).toHaveBeenCalledWith('ENG1', 'updateApp i1 kolibri-0.15.6');
  });
  it('Not now hides the badge in this browser', () => {
    const s = mkStore(inst({ updateAvailable: { appId: 'kolibri-0.15.6' } }));
    const r = row(s);
    fireEvent.click(r.getByTestId('update-badge-i1'));
    fireEvent.click(r.getByTestId('update-not-now-i1'));
    expect(r.queryByTestId('update-badge-i1')).toBeNull();
    expect(localStorage.getItem('idea.updateNotNow')).toContain('kolibri-0.15.6');
  });
  it('major shows migrationNote', () => {
    const r = row(mkStore(inst({ updateAvailable: { appId: 'kolibri-1.0.0' } })));
    fireEvent.click(r.getByTestId('update-badge-i1'));
    expect(r.getByTestId('update-migration-note-i1').textContent).toBe('Big change: lessons move.');
  });
  it('greys out the badge when the source Engine is offline', () => {
    const r = row(mkStore(inst({ updateAvailable: { appId: 'kolibri-0.15.6', engineId: 'ENG2' } }), [], false));
    const b = r.getByTestId('update-badge-i1') as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.textContent).toBe('Update available: 0.15.5 to 0.15.6 (on a disk in library-pi)');
  });
  it('while running: shows the step, not the Error hint', () => {
    const s = mkStore(inst({ status: 'Error', statusCondition: 'unhealthy' }), [op('Running', { stepLabel: 'Health' })]);
    const r = row(s);
    expect(r.getByTestId('update-step-i1').textContent).toBe('Checking it works');
    expect(r.container.querySelector('.instance-row__error-hint')).toBeNull();
  });
  it('shows fetchPaused text while paused', () => {
    const s = mkStore(inst({ updateAvailable: { appId: 'kolibri-0.15.6', engineId: 'ENG2' }, fetchPaused: { reason: 'temperature', bytesDone: 1, bytesTotal: 2, since: T } }),
      [op('Running', { stepLabel: 'Fetch' })]);
    const r = row(s);
    expect(r.getByTestId('update-step-i1').textContent).toBe('Paused while library-pi cools down. The copy continues by itself.');
  });
});
