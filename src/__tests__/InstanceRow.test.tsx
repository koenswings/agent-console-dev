import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@solidjs/testing-library';
import InstanceRow, {
  isStartDisabled,
  isStopDisabled,
  isBackupDisabled,
  formatLastBackup,
} from '../components/InstanceRow';
import type { Instance, App, Engine, Disk, Status, Store, Operation } from '../types/store';
import * as commands from '../store/commands';

vi.mock('../store/commands', async (importOriginal) => {
  const mod = await importOriginal<typeof commands>();
  return { ...mod, backupApp: vi.fn() };
});

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------
const makeInstance = (status: Status, lastBackup: number | null = null, metrics = null as import('../types/store').DockerMetrics | null): Instance => ({
  id: 'inst-001',
  instanceOf: 'kolibri-1.0',
  name: 'kolibri',
  status,
  port: 8080,
  serviceImages: [],
  created: Date.now(),
  lastBackup,
  lastStarted: Date.now(),
  storedOn: 'DISK001',
  metrics,
});

const mockBackupDisk: Disk = {
  id: 'BACKUP001',
  name: 'backup-disk',
  device: 'sdd',
  created: Date.now(),
  lastDocked: Date.now(),
  dockedTo: 'ENGINE_DISK001',
  diskTypes: ['backup'],
  backupConfig: { mode: 'on-demand', links: ['inst-001'] },
};

const mockBackupDisk2: Disk = {
  id: 'BACKUP002',
  name: 'backup-disk-weekly',
  device: 'sde',
  created: Date.now(),
  lastDocked: Date.now(),
  dockedTo: 'ENGINE_DISK001',
  diskTypes: ['backup'],
  backupConfig: { mode: 'on-demand', links: ['inst-001'] },
};

const mockApp: App = {
  id: 'kolibri-1.0',
  name: 'kolibri',
  version: '1.0',
  title: 'Kolibri Learning Platform',
  description: null,
  url: null,
  category: 'education',
  icon: null,
  author: null,
};

const mockEngine: Engine = {
  id: 'ENGINE_DISK001',
  hostname: 'appdocker01',
  version: '1.0',
  hostOS: 'Linux',
  created: Date.now(),
  lastBooted: Date.now(),
  lastRun: Date.now(),
  lastHalted: null,
  commands: [],
};

// ---------------------------------------------------------------------------
// Pure helpers: isStartDisabled / isStopDisabled / isBackupDisabled / formatLastBackup
// ---------------------------------------------------------------------------
describe('isStartDisabled', () => {
  it('disables Start for Running', () => expect(isStartDisabled('Running')).toBe(true));
  it('disables Start for Starting', () => expect(isStartDisabled('Starting')).toBe(true));
  it('enables Start for Stopped', () => expect(isStartDisabled('Stopped')).toBe(false));
  it('enables Start for Docked', () => expect(isStartDisabled('Docked')).toBe(false));
  it('enables Start for Error', () => expect(isStartDisabled('Error')).toBe(false));
  it('enables Start for Undocked', () => expect(isStartDisabled('Undocked')).toBe(false));
  it('enables Start for Pauzed', () => expect(isStartDisabled('Pauzed')).toBe(false));
});

describe('isStopDisabled', () => {
  it('disables Stop for Stopped', () => expect(isStopDisabled('Stopped')).toBe(true));
  it('disables Stop for Docked', () => expect(isStopDisabled('Docked')).toBe(true));
  it('disables Stop for Undocked', () => expect(isStopDisabled('Undocked')).toBe(true));
  it('enables Stop for Running', () => expect(isStopDisabled('Running')).toBe(false));
  it('enables Stop for Starting', () => expect(isStopDisabled('Starting')).toBe(false));
  it('enables Stop for Error', () => expect(isStopDisabled('Error')).toBe(false));
  it('enables Stop for Pauzed', () => expect(isStopDisabled('Pauzed')).toBe(false));
});

describe('isBackupDisabled', () => {
  it('enables Backup for Running', () => expect(isBackupDisabled('Running')).toBe(false));
  it('disables Backup for Stopped', () => expect(isBackupDisabled('Stopped')).toBe(true));
  it('disables Backup for Docked', () => expect(isBackupDisabled('Docked')).toBe(true));
  it('disables Backup for Starting', () => expect(isBackupDisabled('Starting')).toBe(true));
  it('disables Backup for Error', () => expect(isBackupDisabled('Error')).toBe(true));
});

describe('formatLastBackup', () => {
  it('returns "Never" for null', () => expect(formatLastBackup(null)).toBe('Never'));
  it('returns "Never" for 0', () => expect(formatLastBackup(0)).toBe('Never'));
  it('returns a non-empty string for a valid timestamp', () => {
    const result = formatLastBackup(Date.now());
    expect(typeof result).toBe('string');
    expect(result).not.toBe('Never');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Component rendering — props are accessor functions
// ---------------------------------------------------------------------------
describe('InstanceRow component', () => {
  beforeEach(() => {
    vi.mocked(commands.backupApp).mockClear();
  });
  it('renders instance name', () => {
    const { container } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Running')}
        app={() => mockApp}
        engine={() => mockEngine}
      />
    ));
    expect(container.textContent).toContain('kolibri');
  });

  it('renders app title', () => {
    const { container } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Running')}
        app={() => mockApp}
        engine={() => mockEngine}
      />
    ));
    expect(container.textContent).toContain('Kolibri Learning Platform');
  });

  it('Start button is disabled when status is Running', () => {
    const { getByRole } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Running')}
        app={() => mockApp}
        engine={() => mockEngine}
      />
    ));
    expect(getByRole('button', { name: /start/i })).toBeDisabled();
  });

  it('Start button is disabled when status is Starting', () => {
    const { getByRole } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Starting')}
        app={() => mockApp}
        engine={() => mockEngine}
      />
    ));
    expect(getByRole('button', { name: /start/i })).toBeDisabled();
  });

  it('Start button is enabled when status is Stopped', () => {
    const { getByRole } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Stopped')}
        app={() => mockApp}
        engine={() => mockEngine}
      />
    ));
    expect(getByRole('button', { name: /start/i })).not.toBeDisabled();
  });

  it('Stop button is disabled when status is Stopped', () => {
    const { getByRole } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Stopped')}
        app={() => mockApp}
        engine={() => mockEngine}
      />
    ));
    expect(getByRole('button', { name: /stop/i })).toBeDisabled();
  });

  it('Stop button is enabled when status is Running', () => {
    const { getByRole } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Running')}
        app={() => mockApp}
        engine={() => mockEngine}
      />
    ));
    expect(getByRole('button', { name: /stop/i })).not.toBeDisabled();
  });

  it('shows Open link when status is Running', () => {
    const { container } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Running')}
        app={() => mockApp}
        engine={() => mockEngine}
      />
    ));
    const link = container.querySelector('a.btn--open');
    expect(link).toBeTruthy();
    expect(link).toHaveAttribute('href', 'http://appdocker01.local:8080');
  });

  it('does not show Open link when status is Stopped', () => {
    const { container } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Stopped')}
        app={() => mockApp}
        engine={() => mockEngine}
      />
    ));
    expect(container.querySelector('a.btn--open')).toBeFalsy();
  });

  it('does not show Open link when status is Docked', () => {
    const { container } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Docked')}
        app={() => mockApp}
        engine={() => mockEngine}
      />
    ));
    expect(container.querySelector('a.btn--open')).toBeFalsy();
  });

  it('does not show Backup button when no backupDisk provided', () => {
    const { container } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Running')}
        app={() => mockApp}
        engine={() => mockEngine}
      />
    ));
    expect(container.querySelector('.btn--backup')).toBeFalsy();
  });

  it('shows Backup button when backupDisk is provided', () => {
    const { container } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Running')}
        app={() => mockApp}
        engine={() => mockEngine}
        backupDisks={() => [mockBackupDisk]}
      />
    ));
    expect(container.querySelector('.btn--backup')).toBeTruthy();
  });

  it('Backup button is enabled when status is Running', () => {
    const { getByRole } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Running')}
        app={() => mockApp}
        engine={() => mockEngine}
        backupDisks={() => [mockBackupDisk]}
      />
    ));
    expect(getByRole('button', { name: /back up/i })).not.toBeDisabled();
  });

  it('Backup button is disabled when status is Stopped', () => {
    const { getByRole } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Stopped')}
        app={() => mockApp}
        engine={() => mockEngine}
        backupDisks={() => [mockBackupDisk]}
      />
    ));
    expect(getByRole('button', { name: /back up/i })).toBeDisabled();
  });

  it('single disk: clicking Backup fires backupApp immediately without showing picker', () => {
    const { getByRole, container } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Running')}
        app={() => mockApp}
        engine={() => mockEngine}
        backupDisks={() => [mockBackupDisk]}
      />
    ));
    fireEvent.click(getByRole('button', { name: /back up/i }));
    expect(container.querySelector('.backup-picker__dropdown')).toBeFalsy();
    expect(vi.mocked(commands.backupApp)).toHaveBeenCalledOnce();
    expect(vi.mocked(commands.backupApp)).toHaveBeenCalledWith('ENGINE_DISK001', 'kolibri', 'backup-disk');
  });

  it('multiple disks: clicking Backup opens disk picker', () => {
    const { getByRole, container } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Running')}
        app={() => mockApp}
        engine={() => mockEngine}
        backupDisks={() => [mockBackupDisk, mockBackupDisk2]}
      />
    ));
    expect(container.querySelector('.backup-picker__dropdown')).toBeFalsy();
    fireEvent.click(getByRole('button', { name: /back up/i }));
    expect(container.querySelector('.backup-picker__dropdown')).toBeTruthy();
    expect(vi.mocked(commands.backupApp)).not.toHaveBeenCalled();
  });

  it('multiple disks: picker lists disk names', () => {
    const { getByRole, container } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Running')}
        app={() => mockApp}
        engine={() => mockEngine}
        backupDisks={() => [mockBackupDisk, mockBackupDisk2]}
      />
    ));
    fireEvent.click(getByRole('button', { name: /back up/i }));
    const dropdown = container.querySelector('.backup-picker__dropdown')!;
    expect(dropdown.textContent).toContain('backup-disk');
    expect(dropdown.textContent).toContain('backup-disk-weekly');
  });

  it('multiple disks: selecting a disk from picker fires backupApp and closes picker', () => {
    const { getByRole, container } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Running')}
        app={() => mockApp}
        engine={() => mockEngine}
        backupDisks={() => [mockBackupDisk, mockBackupDisk2]}
      />
    ));
    fireEvent.click(getByRole('button', { name: /back up/i }));
    const options = container.querySelectorAll('.backup-picker__option');
    fireEvent.click(options[1]); // select weekly disk
    expect(vi.mocked(commands.backupApp)).toHaveBeenCalledOnce();
    expect(vi.mocked(commands.backupApp)).toHaveBeenCalledWith('ENGINE_DISK001', 'kolibri', 'backup-disk-weekly');
    expect(container.querySelector('.backup-picker__dropdown')).toBeFalsy();
  });

  it('multiple disks: clicking outside the picker closes it', () => {
    const { getByRole, container } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Running')}
        app={() => mockApp}
        engine={() => mockEngine}
        backupDisks={() => [mockBackupDisk, mockBackupDisk2]}
      />
    ));
    fireEvent.click(getByRole('button', { name: /back up/i }));
    expect(container.querySelector('.backup-picker__dropdown')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(container.querySelector('.backup-picker__dropdown')).toBeFalsy();
  });

  it('details panel is hidden by default', () => {
    const { container } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Running')}
        app={() => mockApp}
        engine={() => mockEngine}
      />
    ));
    expect(container.querySelector('.instance-row__details')).toBeFalsy();
  });

  it('details panel shows after clicking status button', () => {
    const { container } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Running')}
        app={() => mockApp}
        engine={() => mockEngine}
      />
    ));
    const statusBtn = container.querySelector('.instance-row__status-btn') as HTMLElement;
    fireEvent.click(statusBtn);
    expect(container.querySelector('.instance-row__details')).toBeTruthy();
    expect(container.textContent).toContain('Last backup');
    expect(container.textContent).toContain('Created');
    expect(container.textContent).toContain('Last started');
  });

  it('details panel hides again after second click', () => {
    const { container } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Running')}
        app={() => mockApp}
        engine={() => mockEngine}
      />
    ));
    const statusBtn = container.querySelector('.instance-row__status-btn') as HTMLElement;
    fireEvent.click(statusBtn);
    fireEvent.click(statusBtn);
    expect(container.querySelector('.instance-row__details')).toBeFalsy();
  });

  it('shows last backup info in details panel when backupDisk is provided', () => {
    const ts = Date.now() - 60 * 60 * 1000;
    const { container } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Running', ts)}
        app={() => mockApp}
        engine={() => mockEngine}
        backupDisks={() => [mockBackupDisk]}
      />
    ));
    fireEvent.click(container.querySelector('.instance-row__status-btn') as HTMLElement);
    expect(container.textContent).toContain('Last backup');
  });

  it('shows "Never" for last backup in details panel when timestamp is null', () => {
    const { container } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Running', null)}
        app={() => mockApp}
        engine={() => mockEngine}
        backupDisks={() => [mockBackupDisk]}
      />
    ));
    fireEvent.click(container.querySelector('.instance-row__status-btn') as HTMLElement);
    expect(container.textContent).toContain('Never');
  });
});

// ---------------------------------------------------------------------------
// Operation locking + inline progress tests
// ---------------------------------------------------------------------------

const makeStoreWithOps = (ops: Operation[]): Store => ({
  engineDB: {},
  diskDB: {},
  appDB: {},
  instanceDB: {},
  userDB: {},
  operationDB: Object.fromEntries(ops.map((op) => [op.id, op])),
});

const makeRunningOp = (
  instanceId: string,
  kind: Operation['kind'] = 'copyApp',
  pct: number | null = 45,
): Operation => ({
  id: 'op-001',
  kind,
  args: { instanceId, sourceDiskId: 'disk-src', targetDiskId: 'disk-tgt' },
  engineId: 'engine-001',
  status: 'Running',
  progressPercent: pct,
  startedAt: Date.now(),
  completedAt: null,
  error: null,
});

const makeFailedOp = (instanceId: string, errorMsg = 'Disk write failed'): Operation => ({
  id: 'op-failed-001',
  kind: 'backupApp',
  args: { instanceId, backupDiskId: 'disk-backup' },
  engineId: 'engine-001',
  status: 'Failed',
  progressPercent: null,
  startedAt: Date.now() - 1000,
  completedAt: Date.now(),
  error: errorMsg,
});

describe('InstanceRow — operation locking', () => {
  it('Start button is enabled when no ops (no store provided)', () => {
    const { getByRole } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Stopped')}
        app={() => mockApp}
        engine={() => mockEngine}
      />
    ));
    expect(getByRole('button', { name: /start/i })).not.toBeDisabled();
  });

  it('Start button is disabled when instance is locked by a Running op', () => {
    const op = makeRunningOp('inst-001');
    const store = makeStoreWithOps([op]);
    const { getByRole } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Stopped')}
        app={() => mockApp}
        engine={() => mockEngine}
        instanceId="inst-001"
        store={() => store}
      />
    ));
    expect(getByRole('button', { name: /start/i })).toBeDisabled();
  });

  it('Stop button is disabled when instance is locked by a Running op', () => {
    const op = makeRunningOp('inst-001');
    const store = makeStoreWithOps([op]);
    const { getByRole } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Running')}
        app={() => mockApp}
        engine={() => mockEngine}
        instanceId="inst-001"
        store={() => store}
      />
    ));
    expect(getByRole('button', { name: /stop/i })).toBeDisabled();
  });

  it('Backup button is disabled when instance is locked by a Running op', () => {
    const op = makeRunningOp('inst-001');
    const store = makeStoreWithOps([op]);
    const { getByRole } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Running')}
        app={() => mockApp}
        engine={() => mockEngine}
        backupDisks={() => [mockBackupDisk]}
        instanceId="inst-001"
        store={() => store}
      />
    ));
    expect(getByRole('button', { name: /back up/i })).toBeDisabled();
  });

  it('buttons are not additionally disabled when op belongs to a different instance', () => {
    const op = makeRunningOp('inst-other');
    const store = makeStoreWithOps([op]);
    const { getByRole } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Stopped')}
        app={() => mockApp}
        engine={() => mockEngine}
        instanceId="inst-001"
        store={() => store}
      />
    ));
    // Start should only be disabled by status logic (Stopped → enabled)
    expect(getByRole('button', { name: /start/i })).not.toBeDisabled();
  });
});

describe('InstanceRow — inline progress indicator', () => {
  it('shows progress label with percent when active op has progressPercent', () => {
    const op = makeRunningOp('inst-001', 'copyApp', 45);
    const store = makeStoreWithOps([op]);
    const { container } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Running')}
        app={() => mockApp}
        engine={() => mockEngine}
        instanceId="inst-001"
        store={() => store}
      />
    ));
    const label = container.querySelector('.instance-row__progress-label');
    expect(label).toBeTruthy();
    expect(label!.textContent).toContain('Copying');
    expect(label!.textContent).toContain('45%');
  });

  it('shows progress label without percent when progressPercent is null', () => {
    const op = makeRunningOp('inst-001', 'backupApp', null);
    const store = makeStoreWithOps([op]);
    const { container } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Running')}
        app={() => mockApp}
        engine={() => mockEngine}
        instanceId="inst-001"
        store={() => store}
      />
    ));
    const label = container.querySelector('.instance-row__progress-label');
    expect(label).toBeTruthy();
    expect(label!.textContent).toContain('Backing up');
    expect(label!.textContent).not.toContain('%');
  });

  it('applies indeterminate class when progressPercent is null', () => {
    const op = makeRunningOp('inst-001', 'restoreApp', null);
    const store = makeStoreWithOps([op]);
    const { container } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Running')}
        app={() => mockApp}
        engine={() => mockEngine}
        instanceId="inst-001"
        store={() => store}
      />
    ));
    expect(container.querySelector('.instance-row__progress--indeterminate')).toBeTruthy();
  });

  it('does not show progress area when no ops and no store', () => {
    const { container } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Running')}
        app={() => mockApp}
        engine={() => mockEngine}
      />
    ));
    expect(container.querySelector('.instance-row__progress')).toBeFalsy();
  });

  it('shows failed error text when op status is Failed', () => {
    const op = makeFailedOp('inst-001', 'Disk write failed');
    const store = makeStoreWithOps([op]);
    const { container } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Stopped')}
        app={() => mockApp}
        engine={() => mockEngine}
        instanceId="inst-001"
        store={() => store}
      />
    ));
    const label = container.querySelector('.instance-row__progress--failed .instance-row__progress-label');
    expect(label).toBeTruthy();
    expect(label!.textContent).toContain('Failed');
    expect(label!.textContent).toContain('Disk write failed');
  });
});

describe('DockerMetricsPanel', () => {
  const mockMetrics: import('../types/store').DockerMetrics = {
    cpuPercent:      2.5,
    memUsageBytes:   256_000_000,
    memLimitBytes:   4_000_000_000,
    memPercent:      6.4,
    netRxBytes:      1_048_576,
    netTxBytes:      524_288,
    blockReadBytes:  20_971_520,
    blockWriteBytes: 10_485_760,
    sampledAt:       Date.now() - 10_000,
  };

  it('shows metrics when instance is Running with metrics', () => {
    const inst = makeInstance('Running', null, mockMetrics);
    const { container } = render(() => (
      <InstanceRow
        instance={() => inst}
        app={() => mockApp}
        engine={() => mockEngine}
      />
    ));
    fireEvent.click(container.querySelector('.instance-row__status-btn') as HTMLElement);
    expect(container.textContent).toContain('CPU');
    expect(container.textContent).toContain('2.50%');
    expect(container.textContent).toContain('Memory');
    expect(container.textContent).toContain('244.1 MB');
    expect(container.textContent).toContain('Net I/O');
    expect(container.textContent).toContain('Disk I/O');
  });

  it('shows unavailable notice when metrics is null', () => {
    const { container } = render(() => (
      <InstanceRow
        instance={() => makeInstance('Stopped', null, null)}
        app={() => mockApp}
        engine={() => mockEngine}
      />
    ));
    fireEvent.click(container.querySelector('.instance-row__status-btn') as HTMLElement);
    expect(container.textContent).toContain('not running');
  });

  it('shows Container metrics heading', () => {
    const inst = makeInstance('Running', null, mockMetrics);
    const { container } = render(() => (
      <InstanceRow
        instance={() => inst}
        app={() => mockApp}
        engine={() => mockEngine}
      />
    ));
    fireEvent.click(container.querySelector('.instance-row__status-btn') as HTMLElement);
    expect(container.textContent).toContain('Container metrics');
  });
});
