import { describe, it, expect } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import RestorePanel from '../src/components/RestorePanel';
import { MOCK_STORE, MOCK_IDS } from '../src/mock/mockStore';
import {
  CLOCK_UNKNOWN_COPY,
  CLEANING_COPY,
  DISK_FULL_COPY,
  HELPER_OUTDATED_COPY,
  HOOK_FALLBACK_COPY,
  SCHEDULED_BACKUPS_CAPABILITY,
} from '../src/store/backupStatus';
import type { Disk, Engine, Instance, Store } from '../src/types/store';

const baseDisk: Disk = MOCK_STORE.diskDB[MOCK_IDS.DISK_4_ID];
const baseEngine: Engine = MOCK_STORE.engineDB[MOCK_IDS.ENGINE_1_ID];

const withFlag = (engine: Engine, caps: string[]): Engine => ({
  ...engine,
  capabilities: [...(engine.capabilities ?? []), ...caps],
  capabilitiesBootedAt: engine.lastBooted,
});

const storeWith = (opts: {
  engine?: Engine;
  disk?: Disk;
  instance?: Instance;
}): Store => {
  const engine = opts.engine ?? baseEngine;
  const disk = opts.disk ?? baseDisk;
  const instance = opts.instance ?? MOCK_STORE.instanceDB[MOCK_IDS.INST_KOLIBRI_ID];
  return {
    ...MOCK_STORE,
    engineDB: { ...MOCK_STORE.engineDB, [engine.id]: engine },
    diskDB: { ...MOCK_STORE.diskDB, [disk.id]: disk },
    instanceDB: { ...MOCK_STORE.instanceDB, [instance.id]: instance },
  };
};

const renderPanel = (store: Store, disk: Disk = store.diskDB[baseDisk.id] ?? baseDisk) =>
  render(() => (
    <RestorePanel
      disk={() => disk}
      store={() => store}
      engineId={() => MOCK_IDS.ENGINE_1_ID}
    />
  ));

describe('RestorePanel — Backup Disk status lines (idea#404)', () => {
  it('flag off: unchanged, even when summary fields are present', () => {
    const disk: Disk = {
      ...baseDisk,
      clockTrusted: false,
      missedRuns: 3,
      cleaning: true,
      lastAttempt: Date.now(),
      backupStaleLocks: [{
        instanceId: MOCK_IDS.INST_KOLIBRI_ID,
        startedAt: Date.now() - 1000,
        detectedAt: Date.now(),
      }],
    };
    const instance: Instance = {
      ...MOCK_STORE.instanceDB[MOCK_IDS.INST_KOLIBRI_ID],
      lastResult: { time: Date.now(), method: 'stop', result: 'HOOK_FALLBACK' },
    };
    // Default MOCK_STORE engine has no scheduledBackups flag
    renderPanel(storeWith({ disk, instance }), disk);

    expect(screen.getByText('kolibri')).toBeInTheDocument();
    expect(screen.getByText('On demand')).toBeInTheDocument();
    expect(screen.getByText(/Last backup:/)).toBeInTheDocument();
    expect(screen.queryByTestId('restore-disk-status')).not.toBeInTheDocument();
    expect(screen.queryByText(CLOCK_UNKNOWN_COPY)).not.toBeInTheDocument();
    expect(screen.queryByText(CLEANING_COPY)).not.toBeInTheDocument();
    expect(screen.queryByText(HOOK_FALLBACK_COPY)).not.toBeInTheDocument();
    expect(screen.queryByText(/interrupted/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/missed/i)).not.toBeInTheDocument();
  });

  it('flag on: renders each disk status line from mock data', () => {
    const engine = withFlag(baseEngine, [SCHEDULED_BACKUPS_CAPABILITY]);
    const disk: Disk = {
      ...baseDisk,
      backupConfig: {
        mode: 'scheduled',
        links: [MOCK_IDS.INST_KOLIBRI_ID],
        schedule: { daily: '02:30' },
      },
      clockTrusted: false,
      missedRuns: 2,
      cleaning: true,
      freePct: 18,
      lastAttempt: Date.now() - 3_600_000,
      backupStaleLocks: [{
        instanceId: MOCK_IDS.INST_KOLIBRI_ID,
        startedAt: Date.now() - 3_600_000,
        detectedAt: Date.now(),
      }],
    };
    const instance: Instance = {
      ...MOCK_STORE.instanceDB[MOCK_IDS.INST_KOLIBRI_ID],
      lastResult: { time: Date.now() - 3_600_000, method: 'stop', result: 'HOOK_FALLBACK' },
    };
    renderPanel(storeWith({ engine, disk, instance }), disk);

    expect(screen.getByTestId('restore-disk-status')).toBeInTheDocument();
    expect(screen.getByText(/Scheduled daily at 02:30/)).toBeInTheDocument();
    expect(screen.getByText(/Last attempt:/)).toBeInTheDocument();
    expect(screen.getByText(/2 scheduled backups were missed/)).toBeInTheDocument();
    expect(screen.getAllByText(CLOCK_UNKNOWN_COPY).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(CLEANING_COPY)).toBeInTheDocument();
    expect(screen.getByText(/18% free/)).toBeInTheDocument();
    expect(screen.getAllByText(HOOK_FALLBACK_COPY).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/interrupted/i).length).toBeGreaterThanOrEqual(1);
    // mode badge still shows Scheduled
    expect(screen.getByText('Scheduled', { selector: '.restore-panel__mode' })).toBeInTheDocument();
    // existing last-backup line is still there
    expect(screen.getByText(/Last backup:/)).toBeInTheDocument();
  });

  it('flag on: shows Backup Disk full and Pi-needs-update from result codes', () => {
    const engine = withFlag(baseEngine, [SCHEDULED_BACKUPS_CAPABILITY]);
    const disk: Disk = {
      ...baseDisk,
      backupConfig: { mode: 'on-demand', links: [MOCK_IDS.INST_KOLIBRI_ID] },
      clockTrusted: true,
    };
    const instance: Instance = {
      ...MOCK_STORE.instanceDB[MOCK_IDS.INST_KOLIBRI_ID],
      lastResult: { time: Date.now(), method: 'live', result: 'BACKUP_DISK_FULL' },
    };
    renderPanel(storeWith({ engine, disk, instance }), disk);
    expect(screen.getAllByText(DISK_FULL_COPY).length).toBeGreaterThanOrEqual(1);
  });

  it('flag on: shows cleanup paused only from a HELPER_OUTDATED result, not a missing flag', () => {
    const engine = withFlag(baseEngine, [SCHEDULED_BACKUPS_CAPABILITY]);
    const disk: Disk = {
      ...baseDisk,
      backupConfig: {
        mode: 'scheduled',
        links: [MOCK_IDS.INST_KOLIBRI_ID],
        schedule: { daily: '02:30' },
      },
      clockTrusted: true,
    };
    renderPanel(storeWith({ engine, disk }), disk);
    expect(screen.queryByText(HELPER_OUTDATED_COPY)).not.toBeInTheDocument();

    const instance: Instance = {
      ...MOCK_STORE.instanceDB[MOCK_IDS.INST_KOLIBRI_ID],
      lastResult: { time: Date.now(), method: 'live', result: 'HELPER_OUTDATED' },
    };
    renderPanel(storeWith({ engine, disk, instance }), disk);
    expect(screen.getAllByText(HELPER_OUTDATED_COPY).length).toBeGreaterThanOrEqual(1);
  });

  it('still lists two linked instances when iterated by id', () => {
    const engine = withFlag(baseEngine, [SCHEDULED_BACKUPS_CAPABILITY]);
    const other: Instance = {
      ...MOCK_STORE.instanceDB[MOCK_IDS.INST_KOLIBRI_ID],
      id: 'nextcloud-inst-001',
      name: 'nextcloud',
    };
    const disk: Disk = {
      ...baseDisk,
      backupConfig: {
        mode: 'on-demand',
        links: [MOCK_IDS.INST_KOLIBRI_ID, other.id],
      },
      clockTrusted: true,
    };
    const store = storeWith({ engine, disk });
    store.instanceDB = { ...store.instanceDB, [other.id]: other };
    renderPanel(store, disk);
    expect(screen.getByTestId(`restore-instance-${MOCK_IDS.INST_KOLIBRI_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`restore-instance-${other.id}`)).toBeInTheDocument();
    expect(screen.getByText('kolibri')).toBeInTheDocument();
    expect(screen.getByText('nextcloud')).toBeInTheDocument();
  });
});
