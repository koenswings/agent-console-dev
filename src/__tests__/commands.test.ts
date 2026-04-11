import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildStartInstanceCommand,
  buildStopInstanceCommand,
  buildEjectDiskCommand,
  buildBackupAppCommand,
  buildCreateBackupDiskCommand,
  buildCopyAppCommand,
  buildMoveAppCommand,
  buildInstallAppCommand,
  buildRestoreAppCommand,
  setSendCommandFn,
  startInstance,
  stopInstance,
  ejectDisk,
  backupApp,
  createBackupDisk,
  copyApp,
  moveApp,
  installApp,
  restoreApp,
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

// ---------------------------------------------------------------------------
// buildCopyAppCommand
// ---------------------------------------------------------------------------
describe('buildCopyAppCommand', () => {
  it('formats correctly', () => {
    expect(buildCopyAppCommand('kolibri', 'kolibri-disk', 'target-disk')).toBe(
      'copyApp kolibri kolibri-disk target-disk'
    );
  });

  it('starts with copyApp', () => {
    const cmd = buildCopyAppCommand('myapp', 'src', 'dst');
    expect(cmd.startsWith('copyApp ')).toBe(true);
    expect(cmd).toContain('myapp');
    expect(cmd).toContain('src');
    expect(cmd).toContain('dst');
  });
});

// ---------------------------------------------------------------------------
// buildMoveAppCommand
// ---------------------------------------------------------------------------
describe('buildMoveAppCommand', () => {
  it('formats correctly', () => {
    expect(buildMoveAppCommand('nextcloud', 'nextcloud-disk', 'new-disk')).toBe(
      'moveApp nextcloud nextcloud-disk new-disk'
    );
  });

  it('starts with moveApp', () => {
    const cmd = buildMoveAppCommand('myapp', 'src', 'dst');
    expect(cmd.startsWith('moveApp ')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildInstallAppCommand
// ---------------------------------------------------------------------------
describe('buildInstallAppCommand', () => {
  it('formats with no options', () => {
    expect(buildInstallAppCommand('kolibri-1.0', 'empty-disk')).toBe(
      'installApp kolibri-1.0 empty-disk'
    );
  });

  it('includes --source when provided', () => {
    const cmd = buildInstallAppCommand('kolibri-1.0', 'empty-disk', { source: 'catalog-disk' });
    expect(cmd).toBe('installApp kolibri-1.0 empty-disk --source catalog-disk');
  });

  it('includes --name when provided', () => {
    const cmd = buildInstallAppCommand('kolibri-1.0', 'empty-disk', { name: 'my-kolibri' });
    expect(cmd).toBe('installApp kolibri-1.0 empty-disk --name my-kolibri');
  });

  it('includes both --source and --name when both provided', () => {
    const cmd = buildInstallAppCommand('kolibri-1.0', 'empty-disk', {
      source: 'catalog-disk',
      name: 'my-kolibri',
    });
    expect(cmd).toBe('installApp kolibri-1.0 empty-disk --source catalog-disk --name my-kolibri');
  });
});

// ---------------------------------------------------------------------------
// copyApp dispatcher
// ---------------------------------------------------------------------------
describe('copyApp', () => {
  it('dispatches the correct command string', () => {
    const mock = vi.fn();
    setSendCommandFn(mock);

    copyApp('ENGINE_001', 'kolibri', 'kolibri-disk', 'target-disk');

    expect(mock).toHaveBeenCalledOnce();
    expect(mock).toHaveBeenCalledWith('ENGINE_001', 'copyApp kolibri kolibri-disk target-disk');
  });
});

// ---------------------------------------------------------------------------
// moveApp dispatcher
// ---------------------------------------------------------------------------
describe('moveApp', () => {
  it('dispatches the correct command string', () => {
    const mock = vi.fn();
    setSendCommandFn(mock);

    moveApp('ENGINE_002', 'nextcloud', 'nextcloud-disk', 'new-disk');

    expect(mock).toHaveBeenCalledOnce();
    expect(mock).toHaveBeenCalledWith('ENGINE_002', 'moveApp nextcloud nextcloud-disk new-disk');
  });
});

// ---------------------------------------------------------------------------
// installApp dispatcher
// ---------------------------------------------------------------------------
describe('installApp', () => {
  it('dispatches with no options', () => {
    const mock = vi.fn();
    setSendCommandFn(mock);

    installApp('ENGINE_001', 'kolibri-1.0', 'empty-disk');

    expect(mock).toHaveBeenCalledOnce();
    expect(mock).toHaveBeenCalledWith('ENGINE_001', 'installApp kolibri-1.0 empty-disk');
  });

  it('dispatches with --source option', () => {
    const mock = vi.fn();
    setSendCommandFn(mock);

    installApp('ENGINE_001', 'kolibri-1.0', 'empty-disk', { source: 'catalog-disk' });

    expect(mock).toHaveBeenCalledWith(
      'ENGINE_001',
      'installApp kolibri-1.0 empty-disk --source catalog-disk'
    );
  });
});

// ---------------------------------------------------------------------------
// buildRestoreAppCommand
// ---------------------------------------------------------------------------
describe('buildRestoreAppCommand', () => {
  it('formats correctly', () => {
    expect(buildRestoreAppCommand('kolibri', 'kolibri-disk')).toBe(
      'restoreApp kolibri kolibri-disk'
    );
  });

  it('starts with restoreApp and includes both args', () => {
    const cmd = buildRestoreAppCommand('my-app', 'target-disk');
    expect(cmd.startsWith('restoreApp ')).toBe(true);
    expect(cmd).toContain('my-app');
    expect(cmd).toContain('target-disk');
  });
});

// ---------------------------------------------------------------------------
// restoreApp dispatcher
// ---------------------------------------------------------------------------
describe('restoreApp', () => {
  it('dispatches the correct command string', () => {
    const mock = vi.fn();
    setSendCommandFn(mock);

    restoreApp('ENGINE_001', 'kolibri', 'kolibri-disk');

    expect(mock).toHaveBeenCalledOnce();
    expect(mock).toHaveBeenCalledWith('ENGINE_001', 'restoreApp kolibri kolibri-disk');
  });
});
