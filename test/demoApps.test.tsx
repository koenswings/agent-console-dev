/**
 * Demo apps (idea#235) against the engine#369 contract: fake Engine (a
 * captured sendCommand) and fake store fixtures. No Pi.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import DemoAppsSection from '../src/components/DemoAppsSection';
import AppCard from '../src/components/AppCard';
import { buildRemoveDemoCommand, buildSetupDemoCommand, setSendCommandFn } from '../src/store/commands';
import { applyEphemeral, emptyLive, receiveEphemeral, resetLive, type LiveState } from '../src/store/live';
import { resetConnectedEngine } from '../src/store/connectedEngine';
import {
  DEMO_AMBIGUOUS_TEXT,
  DEMO_BUSY_TEXT,
  DEMO_ERROR_TEXT,
  DEMO_NO_SOURCE_ONLINE_GENERIC,
  DEMO_NO_SOURCE_TEXT,
  DEMO_NO_TARGET_TEXT,
  DEMO_REFRESH_HINT,
  DEMO_SETUP_LABEL,
  DEMO_STEP_TEXT,
  canOfferDemoApps,
  demoAppIdOf,
  demoEnginesElsewhere,
  demoErrorText,
  demoExistsText,
  demoHeartbeat,
  demoInstancesOnEngine,
  demoNoSourceOnlineText,
  demoOperationResultText,
  demoSetupGate,
  demoSkippedApps,
  demoSkippedLines,
  demoSkippedText,
  demoStepLabel,
  demoTargetDisks,
  isDemoInstance,
  latestDemoOperation,
  noDemoSource,
  parseDemoSkipped,
  removeDemoConfirmText,
} from '../src/store/demoApps';
import { GENERIC_ERROR_TEXT } from '../src/store/plainError';
import type { App, DemoAppProgress, Disk, DiskType, Engine, Instance, Operation, Store } from '../src/types/store';

const T = 1_700_000_000_000;

// ── fake store fixtures ─────────────────────────────────────────────────────
const engine = (id: string, caps: string[] | null = ['demoApps'], stale = false): Engine => ({
  id, hostname: id.toLowerCase(), version: '1', hostOS: 'Linux', created: T, lastBooted: T, lastRun: T,
  lastHalted: null, commands: [],
  ...(caps ? { capabilities: caps, capabilitiesBootedAt: stale ? T - 1 : T } : {}),
});
const disk = (id: string, dockedTo: string | null, types: DiskType[], freeBytes: number | null = null): Disk => ({
  id, name: `${id}-name`, device: 'sda1', created: T, lastDocked: T, dockedTo, diskTypes: types,
  backupConfig: null, freeBytes,
});
const inst = (id: string, app: string, storedOn: string, demo = false, name = `${app} demo`): Instance => ({
  id, instanceOf: app, name, status: 'Running', port: 8080, serviceImages: [], created: T, lastBackup: null,
  lastStarted: T, storedOn, statusCondition: null, currentStep: null, totalSteps: null, stepLabel: null,
  metrics: null, ...(demo ? { demo: true as const } : {}),
});
const demoOp = (id: string, kind: 'setupDemo' | 'removeDemo', status: Operation['status'], extra: Partial<Operation> = {}): Operation => ({
  id, kind, args: { targetDiskId: 'BIG' }, cause: 'console-command', subject: { type: 'engine', id: 'E1' },
  engineId: 'E1', status, progressPercent: null, currentStep: null, totalSteps: null, stepLabel: null,
  startedAt: T, completedAt: null, error: null, ...extra,
});
const store = (p: Partial<Store> = {}): Store => ({
  engineDB: { E1: engine('E1') },
  diskDB: {
    BIG: disk('BIG', 'E1', ['app'], 50e9),
    SMALL: disk('SMALL', 'E1', ['empty'], 5e9),
    SYS: disk('SYS', 'E1', ['system', 'app'], 90e9),
    BACK: disk('BACK', 'E1', ['backup'], 99e9),
    UPG: disk('UPG', 'E1', ['upgrade'], 99e9),
    OTHER: disk('OTHER', 'E2', ['app'], 99e9),
  },
  appDB: {}, instanceDB: {}, userDB: {}, operationDB: {},
  ...p,
});
const hb = (engineId: string, fields: Record<string, unknown>): LiveState =>
  applyEphemeral(emptyLive(), { type: 'idea/hb', v: 1, engineId, now: T, bootedAt: T, ...fields }, T);

afterEach(() => { cleanup(); resetLive(); resetConnectedEngine(); });

describe('command strings (engine#369 §2)', () => {
  it('setupDemo by disk id, --apps only for a subset', () => {
    expect(buildSetupDemoCommand('BIG')).toBe('setupDemo BIG');
    expect(buildSetupDemoCommand('BIG', ['kolibri'])).toBe('setupDemo BIG --apps kolibri');
    expect(buildSetupDemoCommand('BIG', ['kolibri', 'nextcloud'])).toBe('setupDemo BIG --apps kolibri,nextcloud');
  });
  it('removeDemo names every instance id', () => {
    expect(buildRemoveDemoCommand(['k1', 'n1'])).toBe('removeDemo k1 n1');
  });
});

describe('ephemeral hb fields (engine#369 §4)', () => {
  it('reads internet and demoLocal; absent or non-boolean = unknown', () => {
    expect(demoHeartbeat(hb('E1', { internet: false, demoLocal: true }), 'E1')).toEqual({ internet: false, demoLocal: true });
    expect(demoHeartbeat(hb('E1', {}), 'E1')).toEqual({ internet: null, demoLocal: null });
    expect(demoHeartbeat(hb('E1', { internet: 'no' }), 'E1')).toEqual({ internet: null, demoLocal: null });
    expect(demoHeartbeat(emptyLive(), 'E1')).toEqual({ internet: null, demoLocal: null });
  });
  it('a metrics message keeps the last hb fields', () => {
    const s = applyEphemeral(hb('E1', { internet: true, demoLocal: false }), { type: 'idea/metrics', engineId: 'E1', sampledAt: T, instances: {} }, T + 1);
    expect(demoHeartbeat(s, 'E1')).toEqual({ internet: true, demoLocal: false });
  });
  it('no source only when BOTH are known false', () => {
    expect(noDemoSource({ internet: false, demoLocal: false })).toBe(true);
    expect(noDemoSource({ internet: false, demoLocal: true })).toBe(false);
    expect(noDemoSource({ internet: true, demoLocal: false })).toBe(false);
    expect(noDemoSource({ internet: false, demoLocal: null })).toBe(false);
    expect(noDemoSource({ internet: null, demoLocal: null })).toBe(false);
  });
});

describe('gating', () => {
  it('capability (fresh only) and operator are both required', () => {
    expect(canOfferDemoApps(engine('E1'), true)).toBe(true);
    expect(canOfferDemoApps(engine('E1'), false)).toBe(false);
    expect(canOfferDemoApps(engine('E1', ['removeInstance']), true)).toBe(false);
    expect(canOfferDemoApps(engine('E1', null), true)).toBe(false);
    expect(canOfferDemoApps(engine('E1', ['demoApps'], true), true)).toBe(false);
  });
  it('targets App or empty disks docked here, not system/backup/upgrade, most free first', () => {
    expect(demoTargetDisks(store(), 'E1').map((d) => d.id)).toEqual(['BIG', 'SMALL']);
  });
  it('setup is open on a clean Engine with unknown hb fields (the Engine decides)', () => {
    expect(demoSetupGate({ store: store(), engineId: 'E1', live: emptyLive(), targetDiskId: 'BIG' })).toEqual({ reason: null, mode: 'setup' });
  });
  it('greys out with Koen\'s text when no internet and no local pack', () => {
    const g = demoSetupGate({ store: store(), engineId: 'E1', live: hb('E1', { internet: false, demoLocal: false }), targetDiskId: 'BIG' });
    expect(g.reason).toBe(DEMO_NO_SOURCE_TEXT);
    expect(demoSetupGate({ store: store(), engineId: 'E1', live: hb('E1', { internet: false, demoLocal: true }), targetDiskId: 'BIG' }).reason).toBeNull();
  });
  it('no usable target disk', () => {
    expect(demoSetupGate({ store: store({ diskDB: {} }), engineId: 'E1', live: emptyLive(), targetDiskId: null }).reason).toBe(DEMO_NO_TARGET_TEXT);
    expect(demoSetupGate({ store: store(), engineId: 'E1', live: emptyLive(), targetDiskId: 'SYS' }).reason).toBe(DEMO_NO_TARGET_TEXT);
  });
  it('complete set → re-press allowed as a refresh (addendum decision 5: re-verify or download)', () => {
    const s = store({ instanceDB: { k: inst('k', 'kolibri', 'BIG', true), n: inst('n', 'nextcloud', 'BIG', true) } });
    expect(demoSetupGate({ store: s, engineId: 'E1', live: emptyLive(), targetDiskId: 'BIG' })).toEqual({ reason: null, mode: 'refresh' });
  });
  it('versioned app ids (instanceOf changes on updateApp) still group per demo app', () => {
    const apps = {
      'kolibri-1.1': { id: 'kolibri-1.1', name: 'kolibri', version: '1.1', title: 'Kolibri', description: null, url: null, category: 'edu', icon: null, author: null },
      'kolibri-channel-builder-1.0': { id: 'kolibri-channel-builder-1.0', name: 'kolibri-channel-builder', version: '1.0', title: 'CB', description: null, url: null, category: 'edu', icon: null, author: null },
    };
    const s = store({
      appDB: apps,
      instanceDB: { k: inst('k', 'kolibri-1.1', 'BIG', true), n: inst('n', 'nextcloud-1.0', 'BIG', true) },
    });
    expect(demoAppIdOf(s, { instanceOf: 'kolibri-1.1' })).toBe('kolibri');
    expect(demoAppIdOf(s, { instanceOf: 'nextcloud-1.0' })).toBe('nextcloud');
    expect(demoAppIdOf(s, { instanceOf: 'kolibri-channel-builder-1.0' })).toBeNull();
    expect(demoAppIdOf(store(), { instanceOf: 'kolibri-channel-builder-1.0' })).toBeNull();
    expect(demoSetupGate({ store: s, engineId: 'E1', live: emptyLive(), targetDiskId: 'BIG' }).mode).toBe('refresh');
    const two = store({ appDB: apps, instanceDB: { k: inst('k', 'kolibri-1.0', 'BIG', true), k2: inst('k2', 'kolibri-1.1', 'BIG', true) } });
    expect(demoSetupGate({ store: two, engineId: 'E1', live: emptyLive(), targetDiskId: 'BIG' }).reason).toBe(DEMO_AMBIGUOUS_TEXT);
  });
  it('demo on another disk of this Engine → DEMO_EXISTS mirror naming the disk', () => {
    const s = store({ instanceDB: { k: inst('k', 'kolibri', 'SMALL', true) } });
    expect(demoSetupGate({ store: s, engineId: 'E1', live: emptyLive(), targetDiskId: 'BIG' }).reason).toBe(demoExistsText('SMALL-name'));
  });
  it('two demos of one app → ambiguous', () => {
    const s = store({ instanceDB: { k: inst('k', 'kolibri', 'BIG', true), k2: inst('k2', 'kolibri', 'BIG', true) } });
    expect(demoSetupGate({ store: s, engineId: 'E1', live: emptyLive(), targetDiskId: 'BIG' }).reason).toBe(DEMO_AMBIGUOUS_TEXT);
  });
  it('partial set on the chosen disk, or a failed last setup → resume (engine#369 §8)', () => {
    const partial = store({ instanceDB: { k: inst('k', 'kolibri', 'BIG', true) } });
    expect(demoSetupGate({ store: partial, engineId: 'E1', live: emptyLive(), targetDiskId: 'BIG' })).toEqual({ reason: null, mode: 'resume' });
    const failed = store({
      instanceDB: { k: inst('k', 'kolibri', 'BIG', true), n: inst('n', 'nextcloud', 'BIG', true) },
      operationDB: { op1: demoOp('op1', 'setupDemo', 'Failed', { error: 'INTERRUPTED: engine restarted' }) },
    });
    expect(demoSetupGate({ store: failed, engineId: 'E1', live: emptyLive(), targetDiskId: 'BIG' })).toEqual({ reason: null, mode: 'resume' });
  });
  it('busy while a setupDemo/removeDemo Operation runs', () => {
    const s = store({ operationDB: { op1: demoOp('op1', 'removeDemo', 'Running') } });
    expect(demoSetupGate({ store: s, engineId: 'E1', live: emptyLive(), targetDiskId: 'BIG' }).reason).toBe(DEMO_BUSY_TEXT);
  });
  it('demo instances by Engine; other Engines only warn', () => {
    const s = store({
      engineDB: { E1: engine('E1'), E2: engine('E2') },
      instanceDB: { k: inst('k', 'kolibri', 'BIG', true), real: inst('real', 'kolibri', 'BIG'), o: inst('o', 'kolibri', 'OTHER', true) },
    });
    expect(demoInstancesOnEngine(s, 'E1').map((i) => i.id)).toEqual(['k']);
    expect(demoEnginesElsewhere(s, 'E1')).toEqual(['e2']);
  });
});

describe('badge source: Instance.demo only, never the name', () => {
  it('isDemoInstance', () => {
    expect(isDemoInstance(inst('k', 'kolibri', 'BIG', true))).toBe(true);
    expect(isDemoInstance(inst('k', 'kolibri', 'BIG', false, 'Kolibri Demo'))).toBe(false);
    expect(isDemoInstance(undefined)).toBe(false);
  });
  const app: App = { id: 'kolibri', name: 'kolibri', version: '1', title: 'Kolibri', description: null, url: null, category: 'edu', icon: null, author: null };
  it('AppCard shows DEMO next to the instance-name title', () => {
    const r = render(() => <AppCard instance={() => inst('k', 'kolibri', 'BIG', true, 'Kolibri Demo')} app={() => app} appUrl={() => null} />);
    expect(r.getByTestId('demo-badge-k').textContent).toBe('DEMO');
    expect(r.container.querySelector('.app-card__title')!.textContent).toContain('Kolibri Demo');
    expect(r.container.querySelector('.app-card__subtitle')!.textContent).toBe('Kolibri');
  });
  it('the badge survives updateApp (addendum A: instanceOf changes, demo kept)', () => {
    const [cur, setCur] = createSignal(inst('k', 'kolibri-1.0', 'BIG', true, 'Kolibri Demo'));
    const r = render(() => <AppCard instance={cur} app={() => app} appUrl={() => null} />);
    expect(r.getByTestId('demo-badge-k')).toBeTruthy();
    setCur({ ...cur(), instanceOf: 'kolibri-1.1', status: 'Stopped' });
    expect(r.getByTestId('demo-badge-k').textContent).toBe('DEMO');
    // An Engine without the addendum fix would drop the field: the badge goes too (never inferred from the name).
    const { demo: _dropped, ...withoutDemo } = cur();
    setCur(withoutDemo as Instance);
    expect(r.queryByTestId('demo-badge-k')).toBeNull();
  });
  it('a real instance named "Kolibri Demo" gets no badge', () => {
    const r = render(() => <AppCard instance={() => inst('k', 'kolibri', 'BIG', false, 'Kolibri Demo')} app={() => app} appUrl={() => null} />);
    expect(r.queryByTestId('demo-badge-k')).toBeNull();
  });
});

describe('step and error mapping (engine#369 §3, §9)', () => {
  const ALL_CODES = [
    'UNKNOWN_APP', 'NOT_FOUND', 'NOT_DOCKED', 'NOT_LOCAL', 'SYSTEM_DISK', 'NOT_APP_DISK', 'DEMO_EXISTS', 'DEMO_AMBIGUOUS',
    'NO_SOURCE', 'PACK_OUTDATED', 'NO_SPACE', 'BUSY', 'NOT_DEMO', 'HELPER_OUTDATED',
    'DOWNLOAD_FAILED', 'CHECKSUM_MISMATCH', 'INVALID_PACK', 'INSTALL_FAILED', 'HOOK_MISSING', 'HOOK_FAILED', 'START_FAILED', 'NOT_READY',
    'DOCK_CHANGED', 'INTERRUPTED', 'REMOVE_FAILED', 'DEMO_READY', 'DEMO_REMOVED',
  ];
  it('every code has plain wording, with and without text', () => {
    for (const c of ALL_CODES) {
      expect(DEMO_ERROR_TEXT[c], c).toBeTruthy();
      expect(demoErrorText(c)).toBe(DEMO_ERROR_TEXT[c]);
      expect(demoErrorText(`${c}: some engine text`)).toBe(DEMO_ERROR_TEXT[c]);
      expect(demoErrorText(c)).not.toMatch(/[A-Z]+_[A-Z]+/);
    }
  });
  it('NO_SOURCE names the app when the Engine is online, and keeps the internet sentence when it is not', () => {
    const liveMsg = 'NO_SOURCE: no usable local pack or GitHub asset for nextcloud, and the app bundle has no pack pin';
    expect(demoErrorText(liveMsg, true)).toBe("Demo content for Nextcloud isn't available on this Engine yet.");
    expect(demoErrorText('NO_SOURCE: no usable local pack or GitHub asset for kolibri', true)).toBe(
      "Demo content for Kolibri isn't available on this Engine yet.",
    );
    expect(demoErrorText('NO_SOURCE: no usable local pack or GitHub asset, and the app bundle has no pack pin', true)).toBe(
      DEMO_NO_SOURCE_ONLINE_GENERIC,
    );
    expect(demoErrorText(liveMsg, false)).toBe(DEMO_NO_SOURCE_TEXT);
    expect(demoErrorText(liveMsg, null)).toBe(DEMO_NO_SOURCE_TEXT);
    expect(demoErrorText(liveMsg)).toBe(DEMO_NO_SOURCE_TEXT);
    expect(demoNoSourceOnlineText(null)).toBe(DEMO_NO_SOURCE_ONLINE_GENERIC);
  });
  it('a Failed setupDemo Operation and a bare demo.code use the same NO_SOURCE wording', () => {
    const liveMsg = 'NO_SOURCE: no usable local pack or GitHub asset for nextcloud, and the app bundle has no pack pin';
    const failed = demoOp('a', 'setupDemo', 'Failed', { error: liveMsg, demo: { targetDiskId: 'BIG', apps: [], code: 'NO_SOURCE', resultText: null } });
    expect(demoOperationResultText(failed, true)).toBe("Demo content for Nextcloud isn't available on this Engine yet.");
    expect(demoOperationResultText({ ...failed, error: null }, true)).toBe(DEMO_NO_SOURCE_ONLINE_GENERIC);
    expect(demoOperationResultText(failed, false)).toBe(DEMO_NO_SOURCE_TEXT);
  });
  it('CHECKSUM_MISMATCH is a sha mismatch; INVALID_PACK is a damaged pack', () => {
    expect(demoErrorText('CHECKSUM_MISMATCH: tar sha256 is abc, pin says def')).toBe(
      "The downloaded demo pack didn't match its checksum. Try again.",
    );
    expect(demoErrorText('INVALID_PACK: CREDITS.txt is empty')).toBe(
      "The demo app pack is damaged or incomplete, so it can't be used. Try again, or get a fresh pack.",
    );
    expect(DEMO_ERROR_TEXT.CHECKSUM_MISMATCH).not.toBe(DEMO_ERROR_TEXT.INVALID_PACK);
  });
  it('REMOVE_FAILED adds the inner removeInstance reason', () => {
    expect(demoErrorText('REMOVE_FAILED: k1: COMPOSE_DOWN_FAILED')).toContain("couldn't be shut down");
  });
  it('unknown codes never leak', () => {
    expect(demoErrorText('WEIRD_NEW_CODE: The disk is tired.')).toBe('The disk is tired.');
    expect(demoErrorText('WEIRD_NEW_CODE')).toBe(GENERIC_ERROR_TEXT);
    expect(demoErrorText('WEIRD_NEW_CODE: see --apps')).toBe(GENERIC_ERROR_TEXT);
  });
  it('every step id has a label; download shows its size', () => {
    for (const id of Object.keys(DEMO_STEP_TEXT)) expect(demoStepLabel({ id })).toBe(DEMO_STEP_TEXT[id as keyof typeof DEMO_STEP_TEXT]);
    expect(demoStepLabel({ id: 'download', bytesTotal: 230_000_000 })).toBe('Get the demo content (230 MB)');
  });
  it('operation result text', () => {
    expect(demoOperationResultText(demoOp('a', 'setupDemo', 'Running'))).toBeNull();
    expect(demoOperationResultText(demoOp('a', 'setupDemo', 'Done', { demo: { targetDiskId: 'BIG', apps: [], code: 'DEMO_READY', resultText: null } }))).toBe(DEMO_ERROR_TEXT.DEMO_READY);
    expect(demoOperationResultText(demoOp('a', 'removeDemo', 'Done'))).toBe(DEMO_ERROR_TEXT.DEMO_REMOVED);
    expect(demoOperationResultText(demoOp('a', 'setupDemo', 'Failed', { error: 'NOT_READY: kolibri' }))).toBe(DEMO_ERROR_TEXT.NOT_READY);
  });
  it('latest demo op wins', () => {
    const s = store({ operationDB: { a: demoOp('a', 'setupDemo', 'Done'), b: demoOp('b', 'removeDemo', 'Done', { startedAt: T + 5 }) } });
    expect(latestDemoOperation(s, 'E1')?.id).toBe('b');
  });
  it('remove confirm names the exact instances', () => {
    expect(removeDemoConfirmText(['Kolibri Demo', 'Nextcloud Demo'])).toContain('Remove Kolibri Demo and Nextcloud Demo?');
  });
});

describe('skipped apps (Operation.demo.skipped, engine#369 follow-up)', () => {
  const kolibriDone = {
    app: 'kolibri' as const, instanceId: 'k1', source: 'local' as const, packVersion: '3', code: 'DEMO_READY', detail: null,
    steps: [{ id: 'install' as const, status: 'done' as const }],
  };
  const skippedNc = { app: 'nextcloud' as const, code: 'NO_SOURCE', detail: 'no usable local pack or GitHub asset for nextcloud' };

  it('parseDemoSkipped accepts a comma string, an array of tokens, objects, [], and a missing field', () => {
    expect(parseDemoSkipped('nextcloud:NO_SOURCE')).toEqual([{ app: 'nextcloud', code: 'NO_SOURCE', detail: null }]);
    expect(parseDemoSkipped('nextcloud:NO_SOURCE,kolibri:NO_SOURCE')).toEqual([
      { app: 'nextcloud', code: 'NO_SOURCE', detail: null },
      { app: 'kolibri', code: 'NO_SOURCE', detail: null },
    ]);
    expect(parseDemoSkipped(['nextcloud:NO_SOURCE'])).toEqual([{ app: 'nextcloud', code: 'NO_SOURCE', detail: null }]);
    expect(parseDemoSkipped([skippedNc])).toEqual([{ app: 'nextcloud', code: 'NO_SOURCE', detail: skippedNc.detail }]);
    expect(parseDemoSkipped([])).toEqual([]);
    expect(parseDemoSkipped(undefined)).toEqual([]);
    expect(parseDemoSkipped(null)).toEqual([]);
    expect(parseDemoSkipped('')).toEqual([]);
  });
  it('an Operation with skipped [] or no skipped field (older Engine) has no skip lines', () => {
    const none = demoOp('a', 'setupDemo', 'Done', { demo: { targetDiskId: 'BIG', apps: [kolibriDone], code: 'DEMO_READY', resultText: 'Kolibri Demo ready', skipped: [] } });
    const old = demoOp('a', 'setupDemo', 'Done', { demo: { targetDiskId: 'BIG', apps: [kolibriDone], code: 'DEMO_READY', resultText: 'Kolibri Demo ready' } });
    expect(demoSkippedApps(none)).toEqual([]);
    expect(demoSkippedLines(none, true)).toEqual([]);
    expect(demoSkippedApps(old)).toEqual([]);
    expect(demoSkippedLines(old, true)).toEqual([]);
    expect(demoOperationResultText(none)).toBe(DEMO_ERROR_TEXT.DEMO_READY);
  });
  it('one skipped app becomes a plain note; Done is not a failure', () => {
    const op = demoOp('a', 'setupDemo', 'Done', {
      demo: {
        targetDiskId: 'BIG', apps: [kolibriDone], code: 'DEMO_READY',
        resultText: 'Kolibri Demo ready; skipped nextcloud (NO_SOURCE: no usable local pack)',
        skipped: [skippedNc],
      },
    });
    expect(demoSkippedApps(op)).toEqual([{ app: 'nextcloud', code: 'NO_SOURCE', detail: skippedNc.detail }]);
    expect(demoSkippedLines(op, true)).toEqual([{
      app: 'nextcloud',
      text: "Nextcloud Demo was skipped: its demo content isn't available on this Engine yet.",
    }]);
    expect(demoSkippedText('nextcloud', true)).toBe("Nextcloud Demo was skipped: its demo content isn't available on this Engine yet.");
    expect(demoSkippedText('nextcloud', false)).toBe(
      'Nextcloud Demo was skipped because the Engine has no internet and no local demo pack.',
    );
    expect(demoSkippedText('nextcloud', null)).toBe("Nextcloud Demo was skipped: its demo content isn't available on this Engine yet.");
    expect(demoOperationResultText(op)).toBe(DEMO_ERROR_TEXT.DEMO_READY);
    expect(demoSkippedLines({ ...op, status: 'Running' }, true)).toEqual([]);
    expect(demoSkippedLines(demoOp('b', 'removeDemo', 'Done', { demo: { targetDiskId: 'BIG', apps: [], code: 'DEMO_REMOVED', resultText: null, skipped: [skippedNc] } }), true)).toEqual([]);
  });
});

describe('DemoAppsSection with a fake Engine', () => {
  let sent: { engineId: string; command: string }[];
  beforeEach(() => {
    sent = [];
    setSendCommandFn((engineId, command) => { sent.push({ engineId, command }); });
  });
  const mount = (s: Store) => render(() => <DemoAppsSection store={() => s} commandLog={() => null} />);

  it('sends setupDemo to the Engine with the most-free App Disk by default', () => {
    const r = mount(store());
    fireEvent.click(r.getByTestId('demo-apps-setup'));
    expect(sent).toEqual([{ engineId: 'E1', command: 'setupDemo BIG' }]);
  });
  it('with the full set there, the button refreshes (same setupDemo command)', () => {
    const r = mount(store({ instanceDB: { k: inst('k', 'kolibri', 'SMALL', true), n: inst('n', 'nextcloud', 'SMALL', true) } }));
    expect(r.getByTestId('demo-apps-setup').textContent).toBe(DEMO_SETUP_LABEL.refresh);
    expect(r.getByTestId('demo-apps-refresh-hint').textContent).toBe(DEMO_REFRESH_HINT);
    fireEvent.click(r.getByTestId('demo-apps-setup'));
    expect(sent).toEqual([{ engineId: 'E1', command: 'setupDemo SMALL' }]);
  });
  it('is disabled with the reason when the hb says no internet and no pack', () => {
    receiveEphemeral({ type: 'idea/hb', v: 1, engineId: 'E1', now: T, bootedAt: T, internet: false, demoLocal: false });
    const r = mount(store());
    expect((r.getByTestId('demo-apps-setup') as HTMLButtonElement).disabled).toBe(true);
    expect(r.getByTestId('demo-apps-setup-reason').textContent).toBe(DEMO_NO_SOURCE_TEXT);
    fireEvent.click(r.getByTestId('demo-apps-setup'));
    expect(sent).toEqual([]);
  });
  it('remove confirms with the instance names, then sends removeDemo <ids>; cancel sends nothing', () => {
    const s = store({ instanceDB: { k1: inst('k1', 'kolibri', 'BIG', true, 'Kolibri Demo'), n1: inst('n1', 'nextcloud', 'BIG', true, 'Nextcloud Demo'), real: inst('real', 'kolibri', 'BIG') } });
    const r = mount(s);
    fireEvent.click(r.getByTestId('demo-apps-remove'));
    expect(r.getByTestId('demo-apps-remove-text').textContent).toContain('Kolibri Demo and Nextcloud Demo');
    fireEvent.click(r.getByTestId('demo-apps-remove-cancel'));
    expect(sent).toEqual([]);
    fireEvent.click(r.getByTestId('demo-apps-remove'));
    fireEvent.click(r.getByTestId('demo-apps-remove-confirm'));
    expect(sent).toEqual([{ engineId: 'E1', command: 'removeDemo k1 n1' }]);
  });
  it('renders progress per app and step id from Operation.demo', () => {
    const kolibri: DemoAppProgress = {
      app: 'kolibri', instanceId: 'k1', source: 'local', packVersion: '3', code: null, detail: null,
      steps: [
        { id: 'install', status: 'done' }, { id: 'download', status: 'skipped', bytesTotal: 230_000_000 },
        { id: 'verify', status: 'done' }, { id: 'seed', status: 'running' }, { id: 'start', status: 'pending' },
        { id: 'ready', status: 'pending' }, { id: 'classwork', status: 'pending' },
      ],
    };
    const s = store({ operationDB: { op1: demoOp('op1', 'setupDemo', 'Running', { demo: { targetDiskId: 'BIG', apps: [kolibri], code: null, resultText: null } }) } });
    const r = mount(s);
    expect(r.getByTestId('demo-apps-step-kolibri-seed').textContent).toContain('Working…');
    expect(r.getByTestId('demo-apps-step-kolibri-download').textContent).toContain('230 MB');
    expect(r.getByTestId('demo-apps-step-kolibri-download').textContent).toContain('Already done');
    expect((r.getByTestId('demo-apps-setup') as HTMLButtonElement).disabled).toBe(true);
    expect(r.queryByTestId('demo-apps-result')).toBeNull();
  });
  it('shows the plain failure line of the last Operation', () => {
    const s = store({ operationDB: { op1: demoOp('op1', 'setupDemo', 'Failed', { error: 'DOCK_CHANGED: disk ejected' }) } });
    const r = mount(s);
    expect(r.getByTestId('demo-apps-result').textContent).toBe(DEMO_ERROR_TEXT.DOCK_CHANGED);
  });
  it('a Done setupDemo with a skipped app stays a success and names the skipped app', () => {
    const kolibri: DemoAppProgress = {
      app: 'kolibri', instanceId: 'k1', source: 'local', packVersion: '3', code: 'DEMO_READY', detail: null,
      steps: [{ id: 'install', status: 'done' }],
    };
    const s = store({
      operationDB: {
        op1: demoOp('op1', 'setupDemo', 'Done', {
          demo: {
            targetDiskId: 'BIG', apps: [kolibri], code: 'DEMO_READY',
            resultText: 'Kolibri Demo ready; skipped nextcloud (NO_SOURCE: no pack)',
            skipped: [{ app: 'nextcloud', code: 'NO_SOURCE', detail: 'no pack' }],
          },
        }),
      },
    });
    const r = mount(s);
    const result = r.getByTestId('demo-apps-result');
    expect(result.textContent).toBe(DEMO_ERROR_TEXT.DEMO_READY);
    expect(result.className).toContain('form-success');
    expect(result.className).not.toContain('edp-form__error');
    expect(r.getByTestId('demo-apps-skipped-nextcloud').textContent).toBe(
      "Nextcloud Demo was skipped: its demo content isn't available on this Engine yet.",
    );
    expect(r.getByTestId('demo-apps-skipped-nextcloud').className).not.toContain('edp-form__error');
  });
});
