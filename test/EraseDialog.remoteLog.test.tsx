/**
 * idea#168 r86i FAIL@105: EmptyDiskPanel erase of duration-empty-001 (docked on idea03) while the Console
 * talks to idea01. idea03 answered summariseDisk at once, but its trace is only in idea03's own command
 * log. The dialog watched idea01's log alone, so it showed "The Engine didn't respond." after 15 s.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import EraseDialog from '../src/components/EraseDialog';
import { setSendCommandFn } from '../src/store/commands';
import { ERASE_NO_RESPONSE_MS } from '../src/store/erase';
import { mergeCommandLogs, setRemoteCommandLogFn } from '../src/store/remoteCommandLogs';
import { MOCK_FILES_STORE, FILES_IDS as I } from '../src/mock/filesFixtures';
import { SAMPLE_SUMMARY } from '../src/mock/eraseFixtures';
import type { CommandLogState } from '../src/store/commandLog';
import type { CommandLogStore, CommandTrace } from '../src/types/commandLog';
import type { Store } from '../src/types/store';

const log = (...t: CommandTrace[]): CommandLogStore => ({
  traces: Object.fromEntries(t.map((x) => [x.traceId, x])),
  recentTraceIds: t.map((x) => x.traceId),
});
const summariseOk = (): CommandTrace => ({
  traceId: 'sum-remote', command: 'summariseDisk', args: { targetId: I.FA_APP },
  startedAt: 1, completedAt: 2, status: 'ok', errorMessage: null, logs: [],
  result: JSON.stringify(SAMPLE_SUMMARY({ label: MOCK_FILES_STORE.diskDB[I.FA_APP].name, targetId: I.FA_APP })),
});

beforeEach(() => { setSendCommandFn(vi.fn()); });
afterEach(() => { cleanup(); vi.useRealTimers(); setRemoteCommandLogFn(() => null); });

const renderRemote = () => {
  vi.useFakeTimers();
  const [store] = createSignal<Store | null>(MOCK_FILES_STORE);
  const [own] = createSignal<CommandLogState>(log()); // connected Engine: never sees the trace
  const [remote, setRemote] = createSignal<CommandLogState>(log());
  setRemoteCommandLogFn((id) => (id === I.ENGINE_A ? remote : null));
  const t = render(() => (
    <EraseDialog targetId={I.FA_APP} engineId={I.ENGINE_A} fallbackLabel="x" mode="erase"
      store={store} commandLogStore={own} onClose={() => {}} />
  ));
  return { ...t, setRemote };
};

describe('EraseDialog follows the target Engine\'s own command log (r86i)', () => {
  it('summary trace only in the target Engine log → typed-name box, no "didn\'t respond"', () => {
    const t = renderRemote();
    t.setRemote(log(summariseOk()));
    vi.advanceTimersByTime(ERASE_NO_RESPONSE_MS + 1000);
    expect(t.container.querySelector('#erase-confirm-name')).not.toBeNull();
    expect(t.container.textContent).not.toContain("The Engine didn't respond");
  });
  it('no trace in either log → still "The Engine didn\'t respond." (no soft-pass)', () => {
    const t = renderRemote();
    vi.advanceTimersByTime(ERASE_NO_RESPONSE_MS + 1000);
    expect(t.container.textContent).toContain("The Engine didn't respond");
  });
});

describe('mergeCommandLogs', () => {
  it('union of loaded logs; passes through null/error when none loaded', () => {
    const a = log(summariseOk()), b = log({ ...summariseOk(), traceId: 'other' });
    const m = mergeCommandLogs(a, b) as CommandLogStore;
    expect(Object.keys(m.traces ?? {}).sort()).toEqual(['other', 'sum-remote']);
    expect(mergeCommandLogs(null, null)).toBeNull();
    const err = { error: true as const, url: 'u', status: null };
    expect(mergeCommandLogs(err, null)).toBe(err);
    expect(mergeCommandLogs(err, a)).toBe(a);
  });
});
