import { describe, it, expect, vi } from 'vitest';
import { consoleUrl, decideFailover, failoverCandidates } from '../src/store/prodFailover';
import type { DiscoveryResult } from '../src/store/discovery';

const store = {
  engineDB: {
    e1: { id: 'e1', hostname: 'brave-otter', lanAddress: '10.42.0.2' },
    e2: { id: 'e2', hostname: 'calm-heron', lanAddress: '10.42.0.3' },
    e3: { id: 'e3', hostname: 'quiet-fox', lanAddress: null },
  },
};
const ok = (host: string, port: number): DiscoveryResult => ({ hostname: host, storeUrl: 'automerge:x', ...(port !== 80 ? { port } : {}) });

describe('failoverCandidates (idea#203)', () => {
  it('lists the other Engines by name.local and LAN address, never the page host', () => {
    const c = failoverCandidates(store, 'brave-otter.local', 80).map((r) => r.hostname);
    expect(c).toEqual(['calm-heron.local', 'quiet-fox.local', '10.42.0.3']);
  });
  it('a page opened by LAN IP excludes that Engine too', () => {
    const c = failoverCandidates(store, '10.42.0.2', 80).map((r) => r.hostname);
    expect(c).not.toContain('10.42.0.2');
    expect(c).not.toContain('brave-otter.local');
  });
  it('idea.local page host: every Engine is a candidate (no Engine is called idea)', () => {
    expect(failoverCandidates(store, 'idea.local', 80)).toHaveLength(5);
  });
  it('keeps the page port (#146) in the Console URL', () => {
    const [first] = failoverCandidates(store, 'brave-otter.local', 8080);
    expect(consoleUrl(first)).toBe('http://calm-heron.local:8080/');
    expect(consoleUrl({ hostname: 'calm-heron.local' })).toBe('http://calm-heron.local/');
  });
  it('no store → no candidates', () => {
    expect(failoverCandidates(null, 'brave-otter.local', 80)).toEqual([]);
  });
});

describe('decideFailover', () => {
  it('page host answers again (restart / new idea.local holder) → reconnect in place', async () => {
    const probe = vi.fn(async (h: string, p: number) => (h === 'idea.local' ? ok(h, p) : null));
    expect(await decideFailover(store, 'idea.local', 80, probe)).toEqual({ kind: 'reconnect' });
    expect(probe).toHaveBeenCalledTimes(1);
  });
  it('page host gone → opens the first live other Engine in order', async () => {
    const probe = vi.fn(async (h: string, p: number) => (h === 'quiet-fox.local' || h === '10.42.0.3' ? ok(h, p) : null));
    const step = await decideFailover(store, 'brave-otter.local', 80, probe);
    expect(step).toMatchObject({ kind: 'navigate', url: 'http://quiet-fox.local/' });
  });
  it('nobody answers → none (stay and retry)', async () => {
    expect(await decideFailover(store, 'brave-otter.local', 80, async () => null)).toEqual({ kind: 'none' });
  });
});
