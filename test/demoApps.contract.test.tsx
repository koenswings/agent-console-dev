/**
 * Demo apps against Axle's contract answers on engine#369 (comment 6875670232):
 * demoPackWarning, named trace args, CODE: text parsing, idea/progress, and the
 * capability gate. Fake Engine (captured sendCommand), fake store and log.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import DemoAppsSection from '../src/components/DemoAppsSection';
import AppCard from '../src/components/AppCard';
import MobileAppList from '../src/components/MobileAppList';
import { setSendCommandFn } from '../src/store/commands';
import { findCommandTrace } from '../src/store/commandResult';
import { receiveEphemeral, resetLive } from '../src/store/live';
import { resetConnectedEngine } from '../src/store/connectedEngine';
import {
  DEMO_ERROR_TEXT,
  applyDemoProgress,
  canOfferDemoApps,
  demoLiveBytes,
  demoOperationResultText,
  demoPackWarningText,
  demoStepLiveLabel,
} from '../src/store/demoApps';
import type { CommandLogState } from '../src/store/commandLog';
import type { CommandTrace } from '../src/types/commandLog';
import type { App, DemoPackWarning, Disk, Engine, Instance, Operation, Store } from '../src/types/store';

const T = 1_700_000_000_000;
const WARN: DemoPackWarning = { code: 'PACK_OUTDATED', packVersion: 3, minVersion: 4 };
const WARN_TEXT = 'Demo content is out of date (pack v3, needs v4). Press Check and refresh demo apps in Settings → Demo apps.';

const engine = (p: Partial<Engine> = {}): Engine => ({
  id: 'E1', hostname: 'idea04', version: '1.0', hostOS: 'Linux', created: T, lastBooted: T, lastRun: T,
  lastHalted: null, commands: [], capabilities: ['demoApps'], capabilitiesBootedAt: T, ...p,
});
const disk = (id: string, free: number): Disk => ({
  id, name: `${id}-name`, device: 'sda1', created: T, lastDocked: T, dockedTo: 'E1', diskTypes: ['app'], backupConfig: null, freeBytes: free,
});
const inst = (id: string, app: string, p: Partial<Instance> = {}): Instance => ({
  id, instanceOf: app, name: id, status: 'Running', port: 8080, serviceImages: [], created: T, lastBackup: null,
  lastStarted: T, storedOn: 'BIG', statusCondition: null, currentStep: null, totalSteps: null, stepLabel: null,
  metrics: null, ...p,
});
const kolibriApp: App = { id: 'kolibri-1.1', name: 'kolibri', version: '1.1', title: 'Kolibri', description: null, url: null, category: 'edu', icon: null, author: null };
const store = (p: Partial<Store> = {}): Store => ({
  engineDB: { E1: engine() }, diskDB: { BIG: disk('BIG', 50e9) }, appDB: { 'kolibri-1.1': kolibriApp },
  instanceDB: {}, userDB: {}, operationDB: {}, ...p,
});
const trace = (p: Partial<CommandTrace>): CommandTrace => ({
  traceId: 't1', command: 'setupDemo', args: {}, startedAt: T, completedAt: T, status: 'ok', errorMessage: null, logs: [], ...p,
});
const log = (...traces: CommandTrace[]): CommandLogState =>
  ({ traces: Object.fromEntries(traces.map((t) => [t.traceId, t])), recentTraceIds: traces.map((t) => t.traceId) }) as CommandLogState;

let sent: { engineId: string; command: string }[];
beforeEach(() => { sent = []; setSendCommandFn((engineId, command) => { sent.push({ engineId, command }); }); });
afterEach(() => { cleanup(); resetLive(); resetConnectedEngine(); });

describe('Instance.demoPackWarning (answer 1)', () => {
  it('plain text for a demo instance with the exact shape', () => {
    expect(demoPackWarningText({ demo: true, demoPackWarning: WARN })).toBe(WARN_TEXT);
  });
  it('nothing when absent, null, not a demo, or malformed', () => {
    expect(demoPackWarningText({ demo: true })).toBeNull();
    expect(demoPackWarningText({ demo: true, demoPackWarning: null })).toBeNull();
    expect(demoPackWarningText({ demoPackWarning: WARN })).toBeNull();
    expect(demoPackWarningText({ demo: true, demoPackWarning: { ...WARN, packVersion: '3' } as unknown as DemoPackWarning })).toBeNull();
    expect(demoPackWarningText({ demo: true, demoPackWarning: { ...WARN, code: 'OTHER' } as unknown as DemoPackWarning })).toBeNull();
  });
  it('AppCard shows it; clearing the field (setupDemo verify) hides it', () => {
    const [cur, setCur] = createSignal(inst('k', 'kolibri-1.1', { demo: true, demoPackWarning: WARN }));
    const r = render(() => <AppCard instance={cur} app={() => kolibriApp} appUrl={() => null} />);
    expect(r.getByTestId('demo-pack-warning-k').textContent).toBe(WARN_TEXT);
    setCur({ ...cur(), demoPackWarning: null });
    expect(r.queryByTestId('demo-pack-warning-k')).toBeNull();
  });
  it('MobileAppList row shows it', () => {
    const s = store({ instanceDB: { k: inst('k', 'kolibri-1.1', { demo: true, demoPackWarning: WARN }) } });
    const r = render(() => <MobileAppList store={() => s} loadHidden={async () => []} />);
    expect(r.getByTestId('mobile-demo-pack-warning-k').textContent).toBe(WARN_TEXT);
  });
  it('Demo apps section names the instance', () => {
    const s = store({ instanceDB: { k: inst('k', 'kolibri-1.1', { demo: true, name: 'Kolibri Demo', demoPackWarning: WARN }) } });
    const r = render(() => <DemoAppsSection store={() => s} commandLog={() => null} />);
    expect(r.getByTestId('demo-apps-pack-warning-k').textContent).toBe(`Kolibri Demo: ${WARN_TEXT}`);
  });
});

describe('named trace args (answer 2)', () => {
  const none = new Set<string>();
  it('setupDemo matches args.targetDiskId exactly (apps null or a string)', () => {
    const cls = log(trace({ traceId: 'a', args: { targetDiskId: 'BIGGER' } }), trace({ traceId: 'b', args: { targetDiskId: 'BIG', apps: null } as unknown as Record<string, string> }));
    expect(findCommandTrace(cls, none, 'setupDemo', 'targetDiskId', 'BIG', 'key')?.traceId).toBe('b');
  });
  it('removeDemo matches the instanceIds array, not a partial list', () => {
    const t = trace({ traceId: 'r', command: 'removeDemo', args: { instanceIds: ['k1', 'n1'] } as unknown as Record<string, string> });
    expect(findCommandTrace(log(t), none, 'removeDemo', 'instanceIds', 'k1,n1', 'key')?.traceId).toBe('r');
    expect(findCommandTrace(log(t), none, 'removeDemo', 'instanceIds', 'k1', 'key')).toBeNull();
  });
  it('removeDemo also matches instanceIds as a comma string (engine#374)', () => {
    const t = trace({ traceId: 'c', command: 'removeDemo', args: { instanceIds: 'k1,n1' } });
    expect(findCommandTrace(log(t), none, 'removeDemo', 'instanceIds', 'k1,n1', 'key')?.traceId).toBe('c');
    expect(findCommandTrace(log(t), none, 'removeDemo', 'instanceIds', 'k1', 'key')).toBeNull();
  });
  it('pre-execute refusals with positional tokens still match', () => {
    const t = trace({ traceId: 'p', command: 'removeDemo', args: ['k1', 'n1'] as unknown as Record<string, string>, status: 'error', errorMessage: 'Unknown command' });
    expect(findCommandTrace(log(t), none, 'removeDemo', 'instanceIds', 'k1,n1', 'key')?.traceId).toBe('p');
  });
});

describe('CODE: text parsing (answer 4)', () => {
  it('a refused setupDemo shows the plain sentence once, no code', async () => {
    const [cls, setCls] = createSignal<CommandLogState>(log());
    const r = render(() => <DemoAppsSection store={() => store()} commandLog={cls} />);
    fireEvent.click(r.getByTestId('demo-apps-setup'));
    expect(sent).toEqual([{ engineId: 'E1', command: 'setupDemo BIG' }]);
    setCls(log(trace({ traceId: 'n', args: { targetDiskId: 'BIG' }, status: 'error', errorCode: 'NO_SPACE', errorMessage: 'NO_SPACE: needs 2.4 GB free on BIG' })));
    await waitFor(() => expect(r.getByTestId('demo-apps-cmd-error').textContent).toBe(DEMO_ERROR_TEXT.NO_SPACE));
    expect(r.getByTestId('demo-apps-cmd-error').textContent).not.toContain('NO_SPACE');
  });
  it('NO_SOURCE on the trace (no Operation) names the app when the Engine is online', async () => {
    receiveEphemeral({ type: 'idea/hb', v: 1, engineId: 'E1', now: T, bootedAt: T, internet: true, demoLocal: false });
    const [cls, setCls] = createSignal<CommandLogState>(log());
    const r = render(() => <DemoAppsSection store={() => store()} commandLog={cls} />);
    fireEvent.click(r.getByTestId('demo-apps-setup'));
    setCls(log(trace({
      traceId: 'n', args: { targetDiskId: 'BIG' }, status: 'error', errorCode: 'NO_SOURCE',
      errorMessage: 'NO_SOURCE: no usable local pack or GitHub asset for nextcloud, and the app bundle has no pack pin',
    })));
    await waitFor(() => expect(r.getByTestId('demo-apps-cmd-error').textContent).toBe(
      "Demo content for Nextcloud isn't available on this Engine yet.",
    ));
    expect(r.getByTestId('demo-apps-cmd-error').textContent).not.toContain('NO_SOURCE');
    expect(r.getByTestId('demo-apps-cmd-error').textContent).not.toMatch(/needs internet/i);
  });
  it('remove sends and follows removeDemo {instanceIds}', async () => {
    const s = store({ instanceDB: { k1: inst('k1', 'kolibri-1.1', { demo: true }), n1: inst('n1', 'nextcloud-1.0', { demo: true }) } });
    const [cls, setCls] = createSignal<CommandLogState>(log());
    const r = render(() => <DemoAppsSection store={() => s} commandLog={cls} />);
    fireEvent.click(r.getByTestId('demo-apps-remove'));
    fireEvent.click(r.getByTestId('demo-apps-remove-confirm'));
    expect(sent).toEqual([{ engineId: 'E1', command: 'removeDemo k1 n1' }]);
    setCls(log(trace({ traceId: 'x', command: 'removeDemo', args: { instanceIds: 'k1,n1' }, status: 'error', errorCode: 'NOT_DEMO', errorMessage: 'NOT_DEMO: n1 is not a demo instance' })));
    await waitFor(() => expect(r.getByTestId('demo-apps-cmd-error').textContent).toBe(DEMO_ERROR_TEXT.NOT_DEMO));
  });
  it('Failed op: Operation.error CODE: text beats the bare Operation.demo.code', () => {
    const op = {
      id: 'o', kind: 'setupDemo', args: { targetDiskId: 'BIG', apps: 'kolibri,nextcloud' }, cause: 'console-command', subject: { type: 'engine', id: 'E1' },
      engineId: 'E1', status: 'Failed', progressPercent: null, currentStep: null, totalSteps: null, stepLabel: null, startedAt: T, completedAt: T,
      error: 'CHECKSUM_MISMATCH: tar sha256 is abc, pin says def', demo: { targetDiskId: 'BIG', apps: [], code: 'CHECKSUM_MISMATCH', resultText: 'x' },
    } as Operation;
    expect(demoOperationResultText(op)).toBe(DEMO_ERROR_TEXT.CHECKSUM_MISMATCH);
    expect(demoOperationResultText({ ...op, error: null })).toBe(DEMO_ERROR_TEXT.CHECKSUM_MISMATCH);
    const invalid = { ...op, error: 'INVALID_PACK: CREDITS.txt is empty', demo: { ...op.demo!, code: 'INVALID_PACK' } };
    expect(demoOperationResultText(invalid)).toBe(DEMO_ERROR_TEXT.INVALID_PACK);
    expect(demoOperationResultText({ ...invalid, error: null })).toBe(DEMO_ERROR_TEXT.INVALID_PACK);
    expect(DEMO_ERROR_TEXT.INVALID_PACK).not.toBe(DEMO_ERROR_TEXT.CHECKSUM_MISMATCH);
  });
});

describe('idea/progress (answer 6, not on Engine main yet)', () => {
  it('pure apply keys by opId and ignores other or malformed messages', () => {
    const s = applyDemoProgress({}, { type: 'idea/progress', opId: 'o', step: 'download', bytesDone: 1e8, bytesTotal: 2.3e8 }, T);
    expect(s).toEqual({ o: { step: 'download', bytesDone: 1e8, bytesTotal: 2.3e8, receivedAt: T } });
    expect(applyDemoProgress(s, { type: 'idea/updateProgress', opId: 'o', step: 'download' }, T)).toBe(s);
    expect(applyDemoProgress(s, { type: 'idea/progress', step: 'download' }, T)).toBe(s);
  });
  it('label shows live bytes only while the download step runs', () => {
    const live = { step: 'download', bytesDone: 120e6, bytesTotal: 230e6, receivedAt: T };
    expect(demoStepLiveLabel({ id: 'download', status: 'running', bytesTotal: 230e6 }, live)).toBe('Get the demo content (120 of 230 MB)');
    expect(demoStepLiveLabel({ id: 'download', status: 'done', bytesTotal: 230e6 }, live)).toBe('Get the demo content (230 MB)');
    expect(demoStepLiveLabel({ id: 'download', status: 'running', bytesTotal: 230e6 }, null)).toBe('Get the demo content (230 MB)');
  });
  it('arrives through receiveEphemeral and renders in the section; resetLive clears it', () => {
    const s = store({ operationDB: { o: {
      id: 'o', kind: 'setupDemo', args: { targetDiskId: 'BIG' }, cause: 'console-command', subject: { type: 'engine', id: 'E1' },
      engineId: 'E1', status: 'Running', progressPercent: null, currentStep: null, totalSteps: null, stepLabel: null, startedAt: T, completedAt: null, error: null,
      demo: { targetDiskId: 'BIG', code: null, resultText: null, apps: [{ app: 'kolibri', instanceId: 'k', source: 'github', packVersion: null, code: null, detail: null,
        steps: [{ id: 'install', status: 'done' }, { id: 'download', status: 'running', bytesTotal: 230e6 }] }] },
    } as Operation } });
    receiveEphemeral({ type: 'idea/progress', opId: 'o', step: 'download', bytesDone: 50e6, bytesTotal: 230e6 });
    const r = render(() => <DemoAppsSection store={() => s} commandLog={() => null} />);
    expect(r.getByTestId('demo-apps-step-kolibri-download').textContent).toContain('50 of 230 MB');
    resetLive();
    expect(demoLiveBytes()).toEqual({});
  });
});

describe('gate is the capability, never Engine.version', () => {
  it('version plays no part', () => {
    expect(canOfferDemoApps(engine({ version: '0.1' }), true)).toBe(true);
    expect(canOfferDemoApps(engine({ version: '9.9', capabilities: [] }), true)).toBe(false);
    expect(canOfferDemoApps(engine({ capabilitiesBootedAt: T - 1 }), true)).toBe(false);
  });
});
