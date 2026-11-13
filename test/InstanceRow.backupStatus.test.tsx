import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@solidjs/testing-library';
import InstanceRow from '../src/components/InstanceRow';
import {
  CLOCK_UNKNOWN_COPY,
  HOOK_FALLBACK_COPY,
  METHOD_NONE_COPY,
  SCHEDULED_BACKUPS_CAPABILITY,
} from '../src/store/backupStatus';
import type { Instance, App, Engine, Disk, Status } from '../src/types/store';

const BOOT = 1_700_000_000_000;

const makeInstance = (over: Partial<Instance> = {}): Instance => ({
  id: 'inst-001',
  instanceOf: 'kolibri-1.0',
  name: 'kolibri',
  status: 'Running' as Status,
  port: 8080,
  serviceImages: [],
  created: BOOT,
  lastBackup: BOOT,
  lastStarted: BOOT,
  storedOn: 'DISK001',
  statusCondition: null,
  currentStep: null,
  totalSteps: null,
  stepLabel: null,
  metrics: null,
  ...over,
});

const makeApp = (): App => ({
  id: 'kolibri-1.0',
  name: 'kolibri',
  version: '1.0',
  title: 'Kolibri',
  description: null,
  url: null,
  category: 'education',
  icon: null,
  author: null,
});

const makeEngine = (caps?: string[]): Engine => ({
  id: 'ENGINE_DISK001',
  hostname: 'appdocker01',
  version: '1.2.0',
  hostOS: 'Linux',
  created: BOOT,
  lastBooted: BOOT,
  lastRun: Date.now(),
  lastHalted: null,
  commands: [],
  ...(caps
    ? { capabilities: caps, capabilitiesBootedAt: BOOT }
    : { capabilities: ['diskIdArgs'], capabilitiesBootedAt: BOOT }),
});

const backupDisk = (over: Partial<Disk> = {}): Disk => ({
  id: 'BACKUP001',
  name: 'backup-disk',
  device: 'sdd',
  created: BOOT,
  lastDocked: BOOT,
  dockedTo: 'ENGINE_DISK001',
  diskTypes: ['backup'],
  backupConfig: { mode: 'scheduled', links: ['inst-001'], schedule: { daily: '02:30' } },
  ...over,
});

const renderRow = (opts: { instance: Instance; engine: Engine; disks?: Disk[] }) =>
  render(() => (
    <InstanceRow
      instance={() => opts.instance}
      app={() => makeApp()}
      engine={() => opts.engine}
      backupDisks={() => opts.disks ?? [backupDisk()]}
      instanceId={opts.instance.id}
    />
  ));

const expand = (container: HTMLElement) => {
  const btn = container.querySelector('.instance-row__status-btn') as HTMLElement;
  fireEvent.click(btn);
};

describe('InstanceRow — Backup status lines (idea#404)', () => {
  it('flag off: Last backup is unchanged and no status block is shown', () => {
    const { container } = renderRow({
      instance: makeInstance({
        lastResult: { time: BOOT, method: 'stop', result: 'HOOK_FALLBACK' },
      }),
      engine: makeEngine(), // no scheduledBackups
      disks: [backupDisk({ clockTrusted: false })],
    });
    expand(container);
    expect(container.textContent).toContain('Last backup');
    expect(container.textContent).not.toContain('Backup status');
    expect(container.textContent).not.toContain(HOOK_FALLBACK_COPY);
    expect(container.textContent).not.toContain(CLOCK_UNKNOWN_COPY);
    expect(container.querySelector('[data-testid="instance-backup-status"]')).toBeNull();
  });

  it('flag on: shows HOOK_FALLBACK, method none, clock, and interrupted from mock data', () => {
    const engine = makeEngine([SCHEDULED_BACKUPS_CAPABILITY, 'backupCleanup']);

    const fallback = renderRow({
      instance: makeInstance({
        lastResult: { time: BOOT, method: 'stop', result: 'HOOK_FALLBACK' },
      }),
      engine,
      disks: [backupDisk({ clockTrusted: true })],
    });
    expand(fallback.container);
    expect(fallback.container.textContent).toContain('Last backup');
    expect(fallback.container.textContent).toContain(HOOK_FALLBACK_COPY);

    fallback.unmount();

    const none = renderRow({
      instance: makeInstance({
        lastResult: { time: BOOT, method: 'none', result: 'OK' },
      }),
      engine,
    });
    expand(none.container);
    expect(none.container.textContent).toContain(METHOD_NONE_COPY);
    none.unmount();

    const clock = renderRow({
      instance: makeInstance(),
      engine,
      disks: [backupDisk({ clockTrusted: false })],
    });
    expand(clock.container);
    expect(clock.container.textContent).toContain(CLOCK_UNKNOWN_COPY);
    clock.unmount();

    const interrupted = renderRow({
      instance: makeInstance({
        lastResult: { time: BOOT, method: 'live', result: 'INTERRUPTED' },
      }),
      engine,
      disks: [backupDisk({
        clockTrusted: true,
        backupStaleLocks: [{ instanceId: 'inst-001', startedAt: BOOT, detectedAt: BOOT }],
      })],
    });
    expand(interrupted.container);
    expect(interrupted.container.textContent).toMatch(/interrupted/i);
    expect(interrupted.container.textContent).not.toMatch(/lock|borg|YAML|helper/i);
  });
});
