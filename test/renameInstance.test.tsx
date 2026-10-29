import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@solidjs/testing-library';
import InstanceRow from '../src/components/InstanceRow';
import { buildRenameInstanceCommand, setSendCommandFn } from '../src/store/commands';
import {
  RENAME_REFUSALS, canOfferRename, friendlyRenameError, isSameName, normaliseName, renameProblem, renameRefusalCode,
} from '../src/store/renameInstance';
import type { Disk, Engine, Instance, Store } from '../src/types/store';

const T = 1_700_000_000_000;
const engine = (caps?: string[]): Engine => ({
  id: 'ENG1', hostname: 'idea04', version: '1', hostOS: 'Linux', created: T, lastBooted: T, lastRun: T,
  lastHalted: null, commands: [],
  ...(caps ? { capabilities: caps as Engine['capabilities'], capabilitiesBootedAt: T } : {}),
} as Engine);
const inst = (id: string, name: string, storedOn = 'DISK1'): Instance => ({
  id, instanceOf: 'kolibri-1.0', name, status: 'Running', port: 8080, serviceImages: [], created: T,
  lastBackup: null, lastStarted: T, storedOn, statusCondition: null, currentStep: null, totalSteps: null,
  stepLabel: null, metrics: null,
});
const disk = (id: string, dockedTo: string): Disk => ({ id, name: id, device: 'sda', created: T, lastDocked: T, dockedTo } as Disk);
const store = {
  engineDB: {}, diskDB: { DISK1: disk('DISK1', 'ENG1'), DISK2: disk('DISK2', 'ENG2') },
  instanceDB: { a: inst('a', 'kolibri'), b: inst('b', 'Library'), c: inst('c', 'Other Engine', 'DISK2') },
  appDB: {}, operationDB: {},
} as unknown as Store;

afterEach(() => cleanup());

describe('renameInstance helpers (agent-engine-dev#220)', () => {
  it('builds the command with id then name, whitespace collapsed', () => {
    expect(buildRenameInstanceCommand('a', '  Class  5  Library ')).toBe('renameInstance a Class 5 Library');
    expect(normaliseName(' x   y ')).toBe('x y');
  });
  it('is capability-gated', () => {
    expect(canOfferRename(engine())).toBe(false);
    expect(canOfferRename(engine(['renameInstance']))).toBe(true);
  });
  it('mirrors the Engine checks locally', () => {
    const a = store.instanceDB.a;
    expect(renameProblem('   ', a, store, 'ENG1')).toBe(RENAME_REFUSALS.EMPTY_NAME);
    expect(renameProblem('x'.repeat(65), a, store, 'ENG1')).toBe(RENAME_REFUSALS.NAME_TOO_LONG);
    expect(renameProblem('x'.repeat(64), a, store, 'ENG1')).toBeNull();
    expect(renameProblem('bad\u0007', a, store, 'ENG1')).toBe(RENAME_REFUSALS.BAD_NAME);
    expect(renameProblem('library', a, store, 'ENG1')).toBe(RENAME_REFUSALS.NAME_TAKEN);
    expect(renameProblem('other engine', a, store, 'ENG1')).toBeNull();
    expect(renameProblem('KOLIBRI', a, store, 'ENG1')).toBeNull();
    expect(isSameName(' kolibri ', a)).toBe(true);
  });
  it('maps every refusal code', () => {
    for (const code of Object.keys(RENAME_REFUSALS)) {
      expect(renameRefusalCode(`Refused (${code})`)).toBe(code);
      expect(friendlyRenameError(code)).toBe(RENAME_REFUSALS[code]);
    }
    expect(friendlyRenameError('weird')).toBe('weird');
  });
});

describe('Inline rename in InstanceRow', () => {
  const row = (e: Engine) => render(() => (
    <InstanceRow instance={() => store.instanceDB.a} app={() => undefined} engine={() => e} store={() => store} instanceId="a" />
  ));
  it('shows no rename button on an older Engine', () => {
    const r = row(engine(['diskIdArgs']));
    expect(r.queryByTestId('rename-instance-btn-a')).toBeNull();
    expect(r.container.querySelector('.instance-row__name')!.textContent).toBe('kolibri');
  });
  it('edits inline and sends renameInstance <id> <name>', () => {
    const send = vi.fn();
    setSendCommandFn(send);
    const r = row(engine(['renameInstance']));
    fireEvent.click(r.getByTestId('rename-instance-btn-a'));
    const input = r.getByTestId('rename-instance-input-a') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'Library' } });
    expect((r.getByTestId('rename-instance-save-a') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.input(input, { target: { value: 'Class 5 Kolibri' } });
    fireEvent.click(r.getByTestId('rename-instance-save-a'));
    expect(send).toHaveBeenCalledWith('ENG1', 'renameInstance a Class 5 Kolibri');
  });
  it('same name or Cancel sends nothing', () => {
    const send = vi.fn();
    setSendCommandFn(send);
    const r = row(engine(['renameInstance']));
    fireEvent.click(r.getByTestId('rename-instance-btn-a'));
    fireEvent.click(r.getByTestId('rename-instance-save-a'));
    fireEvent.click(r.getByTestId('rename-instance-btn-a'));
    fireEvent.click(r.getByTestId('rename-instance-cancel-a'));
    expect(send).not.toHaveBeenCalled();
  });
});
