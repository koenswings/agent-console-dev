/**
 * r29@97 forensics: the Engine (8d98718, commandUtils.ts) splits multi-argument
 * commands on spaces, so a disk NAME such as "Duration Tests — Add Files App"
 * in a command string is refused with "Too many arguments".
 *
 *  - startInstance / stopInstance send the disk ID (the instance's storedOn);
 *    the Engine finds the disk via storedOn first, so the ID always works.
 *  - restoreApp / backupApp send the instance ID and the disk ID (r30 id
 *    contract; Axle's Engine fix resolves both id-first). start/stop/copy/move
 *    keep the instance NAME: no Engine resolves an instance id for them.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import {
  buildBackupAppCommand,
  buildRestoreAppCommand,
  buildStartInstanceCommand,
  buildStopInstanceCommand,
  setSendCommandFn,
} from '../src/store/commands';
import InstanceRow from '../src/components/InstanceRow';
import MobileAppList from '../src/components/MobileAppList';
import RestorePanel from '../src/components/RestorePanel';
import { MOCK_IDS, MOCK_STORE } from '../src/mock/mockStore';
import type { Disk, Instance, Status, Store } from '../src/types/store';

const SPACED_NAME = 'Duration Tests — Add Files App';
const DISK_ID = MOCK_IDS.DISK_1_ID; // kolibri's storedOn

/** MOCK_STORE with kolibri's disk renamed to a name with spaces and an em-dash. */
const spacedStore = (status: Status = 'Stopped'): Store => {
  const disk: Disk = { ...MOCK_STORE.diskDB[DISK_ID], name: SPACED_NAME };
  const inst: Instance = { ...MOCK_STORE.instanceDB[MOCK_IDS.INST_KOLIBRI_ID], status };
  return {
    ...MOCK_STORE,
    diskDB: { ...MOCK_STORE.diskDB, [DISK_ID]: disk },
    instanceDB: { ...MOCK_STORE.instanceDB, [inst.id]: inst },
  };
};

const expectNoDiskName = (cmd: string) => {
  expect(cmd).not.toContain('—');
  expect(cmd).not.toContain('Duration');
  expect(cmd).not.toContain(SPACED_NAME);
  // Exactly <command> <instanceName> <diskId>: what the Engine's 2-arg descriptor accepts
  expect(cmd.split(' ')).toHaveLength(3);
};

afterEach(() => {
  cleanup();
  setSendCommandFn(() => {});
});

describe('startInstance / stopInstance builders take the disk ID', () => {
  it('buildStartInstanceCommand → "startInstance <name> <diskId>"', () => {
    expect(buildStartInstanceCommand('kolibri', DISK_ID)).toBe(`startInstance kolibri ${DISK_ID}`);
  });
  it('buildStopInstanceCommand → "stopInstance <name> <diskId>"', () => {
    expect(buildStopInstanceCommand('kolibri', DISK_ID)).toBe(`stopInstance kolibri ${DISK_ID}`);
  });
});

describe('InstanceRow sends the disk ID, never a spaced disk name', () => {
  const renderRow = (store: Store) => {
    const inst = store.instanceDB[MOCK_IDS.INST_KOLIBRI_ID];
    return render(() => (
      <InstanceRow
        instanceId={inst.id}
        instance={() => store.instanceDB[inst.id]}
        app={() => store.appDB[inst.instanceOf]}
        engine={() => store.engineDB[MOCK_IDS.ENGINE_1_ID]}
        store={() => store}
      />
    ));
  };

  it('Start → startInstance kolibri <storedOn id>', () => {
    const send = vi.fn();
    setSendCommandFn(send);
    renderRow(spacedStore('Stopped'));
    fireEvent.click(screen.getByTestId(`start-instance-${MOCK_IDS.INST_KOLIBRI_ID}`));
    expect(send).toHaveBeenCalledOnce();
    const [engineId, cmd] = send.mock.calls[0];
    expect(engineId).toBe(MOCK_IDS.ENGINE_1_ID);
    expect(cmd).toBe(`startInstance kolibri ${DISK_ID}`);
    expectNoDiskName(cmd);
  });

  it('Stop → stopInstance kolibri <storedOn id>', () => {
    const send = vi.fn();
    setSendCommandFn(send);
    renderRow(spacedStore('Running'));
    fireEvent.click(screen.getByTestId(`stop-instance-${MOCK_IDS.INST_KOLIBRI_ID}`));
    expect(send).toHaveBeenCalledOnce();
    const cmd = send.mock.calls[0][1];
    expect(cmd).toBe(`stopInstance kolibri ${DISK_ID}`);
    expectNoDiskName(cmd);
  });
});

describe('MobileAppList sends the disk ID, never a spaced disk name', () => {
  it('Start and Stop use storedOn', () => {
    const send = vi.fn();
    setSendCommandFn(send);
    const stopped = spacedStore('Stopped');
    const { unmount } = render(() => <MobileAppList store={() => stopped} />);
    const card = screen.getByText('kolibri').closest('.mobile-app-card') as HTMLElement;
    fireEvent.click(card.querySelector('.btn--start')!);
    unmount();

    const running = spacedStore('Running');
    render(() => <MobileAppList store={() => running} />);
    const card2 = screen.getByText('kolibri').closest('.mobile-app-card') as HTMLElement;
    fireEvent.click(card2.querySelector('.btn--stop')!);

    const cmds = send.mock.calls.map((c) => c[1] as string);
    expect(cmds).toEqual([`startInstance kolibri ${DISK_ID}`, `stopInstance kolibri ${DISK_ID}`]);
    cmds.forEach(expectNoDiskName);
  });
});

describe('restoreApp / backupApp send instance ID + disk ID (r30 id contract)', () => {
  const INST_ID = MOCK_IDS.INST_KOLIBRI_ID;

  it('buildRestoreAppCommand → "restoreApp <instanceId> <diskId>"', () => {
    expect(buildRestoreAppCommand(INST_ID, DISK_ID)).toBe(`restoreApp ${INST_ID} ${DISK_ID}`);
  });

  it('buildBackupAppCommand → "backupApp <instanceId> <diskId>"', () => {
    expect(buildBackupAppCommand(INST_ID, MOCK_IDS.DISK_4_ID)).toBe(`backupApp ${INST_ID} ${MOCK_IDS.DISK_4_ID}`);
  });

  it('RestorePanel sends the instance ID and the target disk ID, never the spaced name', () => {
    const send = vi.fn();
    setSendCommandFn(send);
    const store = spacedStore('Running');
    render(() => (
      <RestorePanel
        disk={() => store.diskDB[MOCK_IDS.DISK_4_ID]}
        store={() => store}
        engineId={() => MOCK_IDS.ENGINE_1_ID}
      />
    ));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: DISK_ID } });
    fireEvent.click(screen.getByRole('button', { name: /^restore$/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm restore/i }));
    expect(send).toHaveBeenCalledOnce();
    const cmd = send.mock.calls[0][1] as string;
    expect(cmd).toBe(`restoreApp ${INST_ID} ${DISK_ID}`);
    expectNoDiskName(cmd);
    expect(cmd.split(' ')[1]).not.toBe('kolibri'); // instance by id (two instances can be named kolibri)
  });

  const renderBackupRow = (store: Store, backupDisk: Disk) => {
    const inst = store.instanceDB[INST_ID];
    return render(() => (
      <InstanceRow
        instanceId={inst.id}
        instance={() => store.instanceDB[inst.id]}
        app={() => store.appDB[inst.instanceOf]}
        engine={() => store.engineDB[MOCK_IDS.ENGINE_1_ID]}
        store={() => store}
        backupDisks={() => [backupDisk]}
      />
    ));
  };

  it('InstanceRow Back up sends the instance ID and the backup disk ID (spaced em-dash name never sent)', () => {
    const send = vi.fn();
    setSendCommandFn(send);
    const base = spacedStore('Running');
    const backupDisk: Disk = { ...base.diskDB[MOCK_IDS.DISK_4_ID], name: 'Weekly Backups — Grade 5' };
    const store: Store = { ...base, diskDB: { ...base.diskDB, [backupDisk.id]: backupDisk } };
    renderBackupRow(store, backupDisk);
    fireEvent.click(screen.getByTestId(`backup-instance-${INST_ID}`));
    expect(send).toHaveBeenCalledOnce();
    const cmd = send.mock.calls[0][1] as string;
    expect(cmd).toBe(`backupApp ${INST_ID} ${backupDisk.id}`);
    expect(cmd).not.toContain('—');
    expect(cmd).not.toContain('Weekly');
    expect(cmd.split(' ')).toHaveLength(3);
  });

  it('MobileAppList Back up sends the instance ID and the backup disk ID', () => {
    const send = vi.fn();
    setSendCommandFn(send);
    const base = spacedStore('Running');
    const backupDisk: Disk = { ...base.diskDB[MOCK_IDS.DISK_4_ID], name: 'Weekly Backups — Grade 5' };
    const store: Store = { ...base, operationDB: {}, diskDB: { ...base.diskDB, [backupDisk.id]: backupDisk } };
    render(() => <MobileAppList store={() => store} />);
    const card = screen.getByText('kolibri').closest('.mobile-app-card') as HTMLElement;
    fireEvent.click(card.querySelector('.btn--backup')!);
    expect(send).toHaveBeenCalledWith(MOCK_IDS.ENGINE_1_ID, `backupApp ${INST_ID} ${backupDisk.id}`);
  });
});

describe('instance argument: name where no Engine resolves an id (locked in)', () => {
  it('start / stop / copy / move keep the instance NAME; restore / backup use the ID', async () => {
    const c = await import('../src/store/commands');
    expect(c.buildStartInstanceCommand('kolibri', DISK_ID).split(' ')[1]).toBe('kolibri');
    expect(c.buildStopInstanceCommand('kolibri', DISK_ID).split(' ')[1]).toBe('kolibri');
    expect(c.buildCopyAppCommand('kolibri', DISK_ID, 'DISK002')).toBe(`copyApp kolibri ${DISK_ID} DISK002`);
    expect(c.buildMoveAppCommand('kolibri', DISK_ID, 'DISK002')).toBe(`moveApp kolibri ${DISK_ID} DISK002`);
    expect(c.buildRestoreAppCommand(MOCK_IDS.INST_KOLIBRI_ID, DISK_ID).split(' ')[1]).toBe(MOCK_IDS.INST_KOLIBRI_ID);
    expect(c.buildBackupAppCommand(MOCK_IDS.INST_KOLIBRI_ID, DISK_ID).split(' ')[1]).toBe(MOCK_IDS.INST_KOLIBRI_ID);
  });
});
