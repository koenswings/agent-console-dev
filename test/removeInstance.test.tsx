import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@solidjs/testing-library';
import InstanceRow from '../src/components/InstanceRow';
import { buildRemoveInstanceCommand, setSendCommandFn } from '../src/store/commands';
import {
  REMOVE_REFUSALS,
  REMOVE_STOP_FIRST,
  canOfferRemove,
  friendlyRemoveError,
  removeBlockedReason,
  removeConfirmText,
  removeRefusalCode,
} from '../src/store/removeInstance';
import type { Engine, Instance, Status } from '../src/types/store';

const T = 1_700_000_000_000;
const engine = (caps?: string[]): Engine => ({
  id: 'ENG1', hostname: 'idea04', version: '1', hostOS: 'Linux', created: T, lastBooted: T, lastRun: T,
  lastHalted: null, commands: [],
  ...(caps ? { capabilities: caps as Engine['capabilities'], capabilitiesBootedAt: T } : {}),
} as Engine);
const inst = (status: Status): Instance => ({
  id: 'inst-1', instanceOf: 'kolibri-1.0', name: 'kolibri', status, port: 8080, serviceImages: [], created: T,
  lastBackup: null, lastStarted: T, storedOn: 'DISK1', statusCondition: null, currentStep: null, totalSteps: null,
  stepLabel: null, metrics: null,
});

afterEach(() => cleanup());

describe('removeInstance helpers (idea#347)', () => {
  it('builds the command with the instance id', () => {
    expect(buildRemoveInstanceCommand('inst-1')).toBe('removeInstance inst-1');
  });
  it('confirm says the data is kept aside, not deleted', () => {
    const t = removeConfirmText('Kolibri');
    expect(t).toContain('Remove Kolibri from this disk?');
    expect(t).toContain('kept aside');
    expect(t).toContain('not deleted');
  });
  it('is capability-gated (older Engines: no Remove)', () => {
    expect(canOfferRemove(engine())).toBe(false);
    expect(canOfferRemove(engine(['diskIdArgs']))).toBe(false);
    expect(canOfferRemove(engine(['removeInstance']))).toBe(true);
  });
  it('blocks while running/starting or locked', () => {
    expect(removeBlockedReason(inst('Running'), false)).toBe(REMOVE_STOP_FIRST);
    expect(removeBlockedReason(inst('Starting'), false)).toBe(REMOVE_STOP_FIRST);
    expect(removeBlockedReason(inst('Stopped'), true)).not.toBeNull();
    expect(removeBlockedReason(inst('Stopped'), false)).toBeNull();
    expect(removeBlockedReason(inst('Error'), false)).toBeNull();
  });
  it('maps every refusal code to a plain sentence', () => {
    for (const code of Object.keys(REMOVE_REFUSALS)) {
      expect(removeRefusalCode(`Refused: ${code}`)).toBe(code);
      expect(friendlyRemoveError(`${code}: details`)).toBe(REMOVE_REFUSALS[code]);
    }
  });
  it('picks BUSY_BACKUP over BUSY and keeps unknown messages', () => {
    expect(removeRefusalCode('BUSY_BACKUP')).toBe('BUSY_BACKUP');
    expect(removeRefusalCode('BUSY')).toBe('BUSY');
    expect(friendlyRemoveError('disk on fire')).toBe('disk on fire');
  });
});

describe('Remove control in InstanceRow', () => {
  const open = (e: Engine, s: Status) => {
    const r = render(() => <InstanceRow instance={() => inst(s)} app={() => undefined} engine={() => e} instanceId="inst-1" />);
    fireEvent.click(r.container.querySelector('.instance-row__status-btn')!);
    return r;
  };
  it('is absent on an Engine without the capability', () => {
    const r = open(engine(['diskIdArgs']), 'Stopped');
    expect(r.queryByTestId('remove-instance-btn-inst-1')).toBeNull();
  });
  it('is disabled with a hint while running', () => {
    const r = open(engine(['removeInstance']), 'Running');
    expect((r.getByTestId('remove-instance-btn-inst-1') as HTMLButtonElement).disabled).toBe(true);
    expect(r.getByTestId('remove-instance-hint-inst-1').textContent).toBe(REMOVE_STOP_FIRST);
  });
  it('confirms, then sends removeInstance <id>; Cancel sends nothing', () => {
    const send = vi.fn();
    setSendCommandFn(send);
    const r = open(engine(['removeInstance']), 'Stopped');
    fireEvent.click(r.getByTestId('remove-instance-btn-inst-1'));
    expect(r.getByTestId('remove-instance-text-inst-1').textContent).toBe(removeConfirmText('kolibri'));
    fireEvent.click(r.getByTestId('remove-instance-cancel-inst-1'));
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(r.getByTestId('remove-instance-btn-inst-1'));
    fireEvent.click(r.getByTestId('remove-instance-confirm-inst-1'));
    expect(send).toHaveBeenCalledWith('ENG1', 'removeInstance inst-1');
  });
});
