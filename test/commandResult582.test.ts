/**
 * agent-engine-dev#582: the command result helper with signed sends — a
 * refused send is the answer at once, the Engine's queue number (seq) finds
 * the trace, and the timeout waits while the Engine's confirmation is open.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import { COMMAND_RESULT_TIMEOUT_MS, createCommandResult } from '../src/store/commandResult';
import { answerEngineConfirm, requestEngineConfirm } from '../src/store/engineConfirm';
import type { CommandLogState } from '../src/store/commandLog';
import type { CommandLogStore, CommandTrace } from '../src/types/commandLog';
import type { SendResult } from '../src/store/signedCommand';

const trace = (id: string, over: Partial<CommandTrace> = {}): CommandTrace => ({
  traceId: id,
  command: 'createFilesDisk',
  args: { diskId: 'DISK_1' },
  startedAt: 0,
  completedAt: 0,
  status: 'ok',
  errorMessage: null,
  logs: [],
  ...over,
});
const log = (...traces: CommandTrace[]): CommandLogStore => ({
  traces: Object.fromEntries(traces.map((t) => [t.traceId, t])),
  recentTraceIds: traces.map((t) => t.traceId),
});

const setup = () => {
  const [cls, setCls] = createSignal<CommandLogState>(log(trace('before', { seq: 7, status: 'error', errorMessage: 'old' })));
  let dispose!: () => void;
  const r = createRoot((d) => {
    dispose = d;
    return createCommandResult({ commandLog: cls, command: 'createFilesDisk', argKey: 'diskId' });
  });
  return { r, setCls, dispose };
};

afterEach(() => { answerEngineConfirm(null); vi.useRealTimers(); });

describe('createCommandResult with signed sends', () => {
  it('a blocked send is an error at once, with its message', async () => {
    const t = setup();
    t.r.start('DISK_1', async (): Promise<SendResult> => ({ kind: 'blocked', engineId: 'E', message: 'Older Engine.' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(t.r.state()).toMatchObject({ kind: 'error' });
    expect(JSON.stringify(t.r.state())).toContain('Older Engine.');
    t.dispose();
  });

  it('a cancelled send goes back to idle', async () => {
    const t = setup();
    t.r.start('DISK_1', async (): Promise<SendResult> => ({ kind: 'cancelled' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(t.r.state().kind).toBe('idle');
    t.dispose();
  });

  it('the trace with the returned seq is the result; an old trace with the same seq is not', async () => {
    const t = setup();
    t.r.start('DISK_1', async (): Promise<SendResult> => ({ kind: 'accepted', engineId: 'E', seq: 7 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(t.r.state().kind).toBe('pending');
    t.setCls(log(trace('before', { seq: 7, status: 'error', errorMessage: 'old' }), trace('new', { seq: 7, args: { diskId: 'OTHER' } })));
    expect(t.r.state().kind).toBe('success');
    t.dispose();
  });

  it('no timeout while the Engine confirmation is open', () => {
    vi.useFakeTimers();
    const t = setup();
    void requestEngineConfirm({ engineId: 'E', command: 'x', confirmId: 'c', summary: {}, expiresInMs: 60_000, confirmField: 'label', message: '' }, 'E');
    t.r.start('DISK_1', () => undefined);
    vi.advanceTimersByTime(COMMAND_RESULT_TIMEOUT_MS + 1);
    expect(t.r.state().kind).toBe('pending');
    answerEngineConfirm(null);
    vi.advanceTimersByTime(COMMAND_RESULT_TIMEOUT_MS + 1);
    expect(t.r.state().kind).not.toBe('pending');
    t.dispose();
  });
});
