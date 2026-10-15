import { describe, it, expect, vi, afterEach } from 'vitest';
import { createCommandLogConnection } from '../src/store/commandLog';

type L = (e: { doc: unknown }) => void;
const fakeHandle = (doc: unknown) => {
  const ls: Record<string, L[]> = {};
  return {
    doc: () => doc,
    addListener: (ev: string, fn: L) => { (ls[ev] ??= []).push(fn); },
    emit: (ev: string, d: unknown) => (ls[ev] ?? []).forEach(f => f({ doc: d })),
  };
};

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('command log follows Engine rotation (idea#183)', () => {
  it('switches to the new doc when /api/command-log-url changes, and ignores the old doc', async () => {
    vi.useFakeTimers();
    let served = 'automerge:old';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ url: served }) })));
    const oldH = fakeHandle({ traces: {}, recentTraceIds: ['a'] });
    const newH = fakeHandle({ traces: {}, recentTraceIds: ['b'] });
    const repo = { find: vi.fn(async (u: string) => (u === 'automerge:old' ? oldH : newH)) };
    let disposed = false;
    const acc = await createCommandLogConnection('h:8080', repo, { pollMs: 1000, isDisposed: () => disposed });
    expect((acc() as any).recentTraceIds).toEqual(['a']);

    await vi.advanceTimersByTimeAsync(1000);
    expect(repo.find).toHaveBeenCalledTimes(1);

    served = 'automerge:new';
    await vi.advanceTimersByTimeAsync(1000);
    expect(repo.find).toHaveBeenLastCalledWith('automerge:new');
    expect((acc() as any).recentTraceIds).toEqual(['b']);

    oldH.emit('change', { traces: {}, recentTraceIds: ['stale'] });
    expect((acc() as any).recentTraceIds).toEqual(['b']);
    newH.emit('change', { traces: {}, recentTraceIds: ['b', 'c'] });
    expect((acc() as any).recentTraceIds).toEqual(['b', 'c']);

    disposed = true;
    served = 'automerge:third';
    await vi.advanceTimersByTimeAsync(3000);
    expect(repo.find).toHaveBeenCalledTimes(2);
  });

  it('keeps the current doc when a poll fails', async () => {
    vi.useFakeTimers();
    let fail = false;
    vi.stubGlobal('fetch', vi.fn(async () => { if (fail) throw new Error('down'); return { ok: true, status: 200, json: async () => ({ url: 'automerge:x' }) }; }));
    const h = fakeHandle({ traces: {}, recentTraceIds: ['x'] });
    const acc = await createCommandLogConnection('h', { find: async () => h }, { pollMs: 500 });
    fail = true;
    await vi.advanceTimersByTimeAsync(1500);
    expect((acc() as any).recentTraceIds).toEqual(['x']);
  });
});
