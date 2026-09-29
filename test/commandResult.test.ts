/**
 * idea#132 — the reusable command result helper: new trace ID + args.diskId
 * (or args.targetId), no timestamps; error, success, timeout.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import {
  COMMAND_RESULT_TIMEOUT_MS,
  createCommandResult,
  findCommandOutcome,
  traceMatchesArg,
} from '../src/store/commandResult';
import type { CommandLogState } from '../src/store/commandLog';
import type { CommandLogStore, CommandTrace } from '../src/types/commandLog';

const trace = (id: string, over: Partial<CommandTrace> = {}): CommandTrace => ({
  traceId: id,
  command: 'createFilesDisk',
  args: { diskId: 'DISK_1', shareName: 'School Files' },
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

describe('findCommandOutcome', () => {
  it('null while the log is missing or errored', () => {
    expect(findCommandOutcome(null, new Set(), 'createFilesDisk', 'diskId', 'DISK_1')).toBeNull();
    expect(findCommandOutcome({ error: true, url: 'x', status: 500 }, new Set(), 'createFilesDisk', 'diskId', 'DISK_1')).toBeNull();
  });
  it('ignores traces in the baseline, other commands and other disk IDs', () => {
    const l = log(
      trace('old', { status: 'error', errorMessage: 'old' }),
      trace('other-cmd', { command: 'ejectDisk' }),
      trace('other-disk', { args: { diskId: 'DISK_2' } }),
    );
    expect(findCommandOutcome(l, new Set(['old']), 'createFilesDisk', 'diskId', 'DISK_1')).toBeNull();
  });
  it('null while the new trace is still running', () => {
    expect(findCommandOutcome(log(trace('t', { status: 'running' })), new Set(), 'createFilesDisk', 'diskId', 'DISK_1')).toBeNull();
  });
  it('error trace → its errorMessage', () => {
    const l = log(trace('t', { status: 'error', errorMessage: 'School Files already has other files on it.' }));
    expect(findCommandOutcome(l, new Set(), 'createFilesDisk', 'diskId', 'DISK_1'))
      .toEqual({ kind: 'error', message: 'School Files already has other files on it.' });
  });
  it('ok trace with an error log line → error (ANSI stripped)', () => {
    const l = log(trace('t', { logs: [{ level: 'error', message: '\u001b[31mboom\u001b[39m', timestamp: 0 }] }));
    expect(findCommandOutcome(l, new Set(), 'createFilesDisk', 'diskId', 'DISK_1')).toEqual({ kind: 'error', message: 'boom' });
  });
  it('ok trace → ok; JSON-string args work too', () => {
    const l = log(trace('t', { args: JSON.stringify({ diskId: 'DISK_1' }) }));
    expect(findCommandOutcome(l, new Set(), 'createFilesDisk', 'diskId', 'DISK_1')).toEqual({ kind: 'ok' });
  });
  it('takes the FIRST new matching trace by log order, not by timestamp', () => {
    const l = log(
      trace('first', { status: 'error', errorMessage: 'first', startedAt: 999 }),
      trace('second', { status: 'ok', startedAt: 1 }),
    );
    expect(findCommandOutcome(l, new Set(), 'createFilesDisk', 'diskId', 'DISK_1')).toEqual({ kind: 'error', message: 'first' });
  });
  it('matches args.targetId when asked', () => {
    const l = log(trace('t', { command: 'eraseDisk', args: { targetId: 'CAND_1' } }));
    expect(findCommandOutcome(l, new Set(), 'eraseDisk', 'targetId', 'CAND_1')).toEqual({ kind: 'ok' });
  });
});

describe('createCommandResult', () => {
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const [cls, setCls] = createSignal<CommandLogState>(log(trace('before', { status: 'error', errorMessage: 'stale' })));
    const [hasFiles, setHasFiles] = createSignal(false);
    const send = vi.fn();
    let dispose!: () => void;
    const r = createRoot((d) => {
      dispose = d;
      return createCommandResult({ commandLog: cls, command: 'createFilesDisk', argKey: 'diskId', isSuccess: hasFiles });
    });
    return { r, setCls, setHasFiles, send, dispose };
  };

  it('success needs an ok trace AND the extra condition (disk has files)', () => {
    const t = setup();
    t.r.start('DISK_1', t.send);
    expect(t.send).toHaveBeenCalledOnce();
    expect(t.r.state().kind).toBe('pending'); // the baseline error trace is ignored
    t.setCls(log(trace('before', { status: 'error' }), trace('new')));
    expect(t.r.state().kind).toBe('pending'); // ok, but no 'files' yet
    t.setHasFiles(true);
    expect(t.r.state().kind).toBe('success');
    t.dispose();
  });

  it('error → the trace message', () => {
    const t = setup();
    t.r.start('DISK_1', t.send);
    t.setCls(log(trace('new', { status: 'error', errorMessage: 'School Files is already a Files Disk' })));
    expect(t.r.state()).toEqual({ kind: 'error', message: 'School Files is already a Files Disk' });
    t.dispose();
  });

  it('timeout after 15 s without an answer', () => {
    vi.useFakeTimers();
    const t = setup();
    t.r.start('DISK_1', t.send);
    vi.advanceTimersByTime(COMMAND_RESULT_TIMEOUT_MS - 1);
    expect(t.r.state().kind).toBe('pending');
    vi.advanceTimersByTime(1);
    expect(t.r.state().kind).toBe('timeout');
    expect(COMMAND_RESULT_TIMEOUT_MS).toBe(15_000);
    t.dispose();
  });

  it('a result after the timeout does not override it; reset() goes back to idle', () => {
    vi.useFakeTimers();
    const t = setup();
    t.r.start('DISK_1', t.send);
    vi.advanceTimersByTime(COMMAND_RESULT_TIMEOUT_MS);
    t.setCls(log(trace('late', { status: 'error', errorMessage: 'late' })));
    expect(t.r.state().kind).toBe('timeout');
    t.r.reset();
    expect(t.r.state().kind).toBe('idle');
    t.dispose();
  });
});

describe("findCommandOutcome includes mode (idea#122 installApp)", () => {
  it('matches when the disk arg appears inside a positional args blob', () => {
    const t = {
      traceId: 'inst-1',
      command: 'installApp',
      args: JSON.stringify(['kolibri-1.0 DISK005 --source SRC']),
      startedAt: 1,
      completedAt: 2,
      status: 'ok' as const,
      errorMessage: null,
      logs: [],
    };
    const cls = { traces: { 'inst-1': t }, recentTraceIds: ['inst-1'] };
    expect(traceMatchesArg(t, 'diskId', 'DISK005', 'includes')).toBe(true);
    expect(traceMatchesArg(t, 'diskId', 'OTHER', 'includes')).toBe(false);
    expect(findCommandOutcome(cls, new Set(), 'installApp', 'diskId', 'DISK005', 'includes'))
      .toEqual({ kind: 'ok' });
    expect(findCommandOutcome(cls, new Set(), 'installApp', 'diskId', 'DISK005', 'includes'))
      .toEqual({ kind: 'ok' });
  });

  it('surfaces installApp error traces via includes match', () => {
    const t = {
      traceId: 'inst-err',
      command: 'installApp',
      args: JSON.stringify(['kolibri-1.0 DISK005']),
      startedAt: 1,
      completedAt: 2,
      status: 'error' as const,
      errorMessage: 'App not found',
      logs: [],
    };
    const cls = { traces: { 'inst-err': t }, recentTraceIds: ['inst-err'] };
    expect(findCommandOutcome(cls, new Set(), 'installApp', 'diskId', 'DISK005', 'includes'))
      .toEqual({ kind: 'error', message: 'App not found' });
  });
});
