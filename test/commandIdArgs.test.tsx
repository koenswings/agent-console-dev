/**
 * r29@97 forensics: the Engine (8d98718, commandUtils.ts) splits multi-argument
 * commands on spaces, so a disk NAME such as "Duration Tests — Add Files App"
 * in a command string is refused with "Too many arguments".
 *
 *  - startInstance / stopInstance send the disk ID (the instance's storedOn);
 *    the Engine finds the disk via storedOn first, so the ID always works.
 *  - restoreApp / backupApp still send the disk NAME (Engine 8d98718 looks
 *    those disks up by name only). Locked in here until Axle's Engine fix.
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

describe('restoreApp / backupApp still send the disk NAME (Engine 8d98718 resolves by name only)', () => {
  it('buildRestoreAppCommand uses the name as given', () => {
    expect(buildRestoreAppCommand('kolibri', 'kolibri-disk')).toBe('restoreApp kolibri kolibri-disk');
    expect(buildRestoreAppCommand('kolibri', SPACED_NAME)).toBe(`restoreApp kolibri ${SPACED_NAME}`);
  });

  it('buildBackupAppCommand uses the name as given', () => {
    expect(buildBackupAppCommand('kolibri', 'backup-disk')).toBe('backupApp kolibri backup-disk');
    expect(buildBackupAppCommand('kolibri', SPACED_NAME)).toBe(`backupApp kolibri ${SPACED_NAME}`);
  });

  it('RestorePanel sends the target disk name, not its ID', () => {
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
    expect(send).toHaveBeenCalledWith(MOCK_IDS.ENGINE_1_ID, `restoreApp kolibri ${SPACED_NAME}`);
  });

  it('InstanceRow Back up sends the backup disk name', () => {
    const send = vi.fn();
    setSendCommandFn(send);
    const store = spacedStore('Running');
    const inst = store.instanceDB[MOCK_IDS.INST_KOLIBRI_ID];
    render(() => (
      <InstanceRow
        instanceId={inst.id}
        instance={() => store.instanceDB[inst.id]}
        app={() => store.appDB[inst.instanceOf]}
        engine={() => store.engineDB[MOCK_IDS.ENGINE_1_ID]}
        store={() => store}
        backupDisks={() => [store.diskDB[MOCK_IDS.DISK_4_ID]]}
      />
    ));
    fireEvent.click(screen.getByTestId(`backup-instance-${inst.id}`));
    expect(send).toHaveBeenCalledWith(MOCK_IDS.ENGINE_1_ID, 'backupApp kolibri backup-disk');
  });
});
