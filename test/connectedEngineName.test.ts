import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  connectedEngineId, connectedEngineName, forgetLearnedEngine, noteConnectedEngine,
  resetConnectedEngine, setConnectedEngineHost, setServedEngineId,
} from '../src/store/connectedEngine';
import { parseStoreUrlResponse } from '../src/store/engine';
import { createCommandLogConnection } from '../src/store/commandLog';
import type { Store } from '../src/types/store';

const store = {
  engineDB: {
    e1: { id: 'e1', hostname: 'brave-otter' },
    e2: { id: 'e2', hostname: 'calm-heron' },
  },
} as unknown as Store;

beforeEach(() => resetConnectedEngine());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('connectedEngineName (status bar, idea#203)', () => {
  it('page host that is an Engine name → that Engine', () => {
    setConnectedEngineHost('brave-otter.local');
    expect(connectedEngineName(store, 'brave-otter.local')).toBe('brave-otter');
  });
  it('idea.local with nothing known → falls back to the host', () => {
    setConnectedEngineHost('idea.local');
    expect(connectedEngineName(store, 'idea.local')).toBe('idea');
  });
  it('idea.local + engineId from /api/store-url → the real name', () => {
    setConnectedEngineHost('idea.local');
    setServedEngineId('e2');
    expect(connectedEngineName(store, 'idea.local')).toBe('calm-heron');
  });
  it('idea.local + learned from our own command log → the real name', () => {
    setConnectedEngineHost('idea.local');
    noteConnectedEngine('e1');
    expect(connectedEngineName(store, 'idea.local')).toBe('brave-otter');
  });
  it('a served id unknown to the store is ignored', () => {
    setConnectedEngineHost('idea.local');
    setServedEngineId('zzz');
    expect(connectedEngineId(store)).toBeNull();
  });
});

describe('re-learning after a holder change', () => {
  it('a new served id drops the old learned id', () => {
    setConnectedEngineHost('idea.local');
    noteConnectedEngine('e1');
    setServedEngineId('e2');
    expect(connectedEngineId(store)).toBe('e2');
  });
  it('forgetLearnedEngine drops the learned id (falls back to served/host)', () => {
    setConnectedEngineHost('idea.local');
    noteConnectedEngine('e1');
    forgetLearnedEngine();
    expect(connectedEngineId(store)).toBeNull();
  });
  it('the command log calls onUrlChange when the host\'s log doc changes (takeover or rotation)', async () => {
    vi.useFakeTimers();
    let served = 'automerge:a';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ url: served }) })));
    const handle = { doc: () => ({ traces: {}, recentTraceIds: [] }), addListener: () => {} };
    const onUrlChange = vi.fn();
    await createCommandLogConnection('idea.local', { find: async () => handle }, { pollMs: 1000, onUrlChange });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onUrlChange).not.toHaveBeenCalled();
    served = 'automerge:b';
    await vi.advanceTimersByTimeAsync(1000);
    expect(onUrlChange).toHaveBeenCalledWith('automerge:b');
  });
});

describe('parseStoreUrlResponse engineId', () => {
  it('reads engineId when the Engine reports it, absent otherwise', () => {
    expect(parseStoreUrlResponse({ url: 'automerge:x', wsPort: 4321, engineId: 'e2' })).toEqual({ url: 'automerge:x', wsPort: 4321, engineId: 'e2' });
    expect(parseStoreUrlResponse({ url: 'automerge:x' }).engineId).toBeUndefined();
  });
});
