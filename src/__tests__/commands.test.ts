import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildStartInstanceCommand,
  buildStopInstanceCommand,
  buildEjectDiskCommand,
  buildBackupAppCommand,
  buildCreateBackupDiskCommand,
  setSendCommandFn,
  startInstance,
  stopInstance,
  ejectDisk,
  backupApp,
  createBackupDisk,
} from '../store/commands';

// ---------------------------------------------------------------------------
// Command string builders (pure, no side effects)
// ---------------------------------------------------------------------------
describe('buildStartInstanceCommand', () => {
  it('formats correctly', () => {
    expect(buildStartInstanceCommand('kolibri', 'kolibri-disk')).toBe(
      'startInstance kolibri kolibri-disk'
    );
  });

  it('includes both instanceName and diskName', () => {
    const cmd = buildStartInstanceCommand('my-instance', 'my-disk');
    expect(cmd).toContain('my-instance');
    expect(cmd).toContain('my-disk');
    expect(cmd.startsWith('startInstance ')).toBe(true);
  });
});

describe('buildStopInstanceCommand', () => {
  it('formats correctly', () => {
    expect(buildStopInstanceCommand('kolibri', 'kolibri-disk')).toBe(
      'stopInstance kolibri kolibri-disk'
    );
  });

  it('starts with stopInstance', () => {
    const cmd = buildStopInstanceCommand('nextcloud', 'nextcloud-disk');
    expect(cmd.startsWith('stopInstance ')).toBe(true);
  });
});

describe('buildEjectDiskCommand', () => {
  it('formats correctly', () => {
    expect(buildEjectDiskCommand('kolibri-disk')).toBe('ejectDisk kolibri-disk');
  });

  it('starts with ejectDisk', () => {
    expect(buildEjectDiskCommand('any-disk').startsWith('ejectDisk ')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dispatching commands (verifies correct strings are sent to sendCommandFn)
// ---------------------------------------------------------------------------
describe('startInstance', () => {
  it('dispatches the correct command string', () => {
    const mock = vi.fn();
    setSendCommandFn(mock);

    startInstance('ENGINE_001', 'kolibri', 'kolibri-disk');

    expect(mock).toHaveBeenCalledOnce();
    expect(mock).toHaveBeenCalledWith('ENGINE_001', 'startInstance kolibri kolibri-disk');
  });
});

describe('stopInstance', () => {
  it('dispatches the correct command string', () => {
    const mock = vi.fn();
    setSendCommandFn(mock);

    stopInstance('ENGINE_002', 'nextcloud', 'nextcloud-disk');

    expect(mock).toHaveBeenCalledOnce();
    expect(mock).toHaveBeenCalledWith('ENGINE_002', 'stopInstance nextcloud nextcloud-disk');
  });
});

describe('ejectDisk', () => {
  it('dispatches the correct command string', () => {
    const mock = vi.fn();
    setSendCommandFn(mock);

    ejectDisk('ENGINE_001', 'kolibri-disk');

    expect(mock).toHaveBeenCalledOnce();
    expect(mock).toHaveBeenCalledWith('ENGINE_001', 'ejectDisk kolibri-disk');
  });
});

describe('buildBackupAppCommand', () => {
  it('formats correctly', () => {
    expect(buildBackupAppCommand('kolibri', 'backup-disk')).toBe(
      'backupApp kolibri backup-disk'
    );
  });
});

describe('buildCreateBackupDiskCommand', () => {
  it('formats correctly with one instance', () => {
    expect(buildCreateBackupDiskCommand('backup-disk', 'on-demand', ['kolibri'])).toBe(
      'createBackupDisk backup-disk on-demand kolibri'
    );
  });

  it('formats correctly with multiple instances', () => {
    expect(
      buildCreateBackupDiskCommand('backup-disk', 'immediate', ['kolibri', 'nextcloud'])
    ).toBe('createBackupDisk backup-disk immediate kolibri nextcloud');
  });
});

describe('backupApp', () => {
  it('dispatches the correct command string', () => {
    const mock = vi.fn();
    setSendCommandFn(mock);

    backupApp('ENGINE_001', 'kolibri', 'backup-disk');

    expect(mock).toHaveBeenCalledOnce();
    expect(mock).toHaveBeenCalledWith('ENGINE_001', 'backupApp kolibri backup-disk');
  });
});

describe('createBackupDisk', () => {
  it('dispatches the correct command string', () => {
    const mock = vi.fn();
    setSendCommandFn(mock);

    createBackupDisk('ENGINE_001', 'backup-disk', 'on-demand', ['kolibri']);

    expect(mock).toHaveBeenCalledOnce();
    expect(mock).toHaveBeenCalledWith(
      'ENGINE_001',
      'createBackupDisk backup-disk on-demand kolibri'
    );
  });
});
