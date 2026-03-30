import { describe, it, expect } from 'vitest';
import { isEngineOnline, getEngineTree } from '../store/signals';
import { MOCK_STORE, MOCK_IDS } from '../mock/mockStore';
import type { Engine } from '../types/store';

// ---------------------------------------------------------------------------
// isEngineOnline
// ---------------------------------------------------------------------------
describe('isEngineOnline', () => {
  it('returns true when lastRun is within the last 2 minutes', () => {
    const engine: Engine = {
      id: 'ENG_001',
      hostname: 'test-engine',
      version: '1.0',
      hostOS: 'Linux',
      created: Date.now() - 60_000,
      lastBooted: Date.now() - 60_000,
      lastRun: Date.now() - 30_000,   // 30 seconds ago
      lastHalted: null,
      commands: [],
    };
    expect(isEngineOnline(engine)).toBe(true);
  });

  it('returns false when lastRun is older than 2 minutes', () => {
    const engine: Engine = {
      id: 'ENG_002',
      hostname: 'stale-engine',
      version: '1.0',
      hostOS: 'Linux',
      created: Date.now() - 3_600_000,
      lastBooted: Date.now() - 3_600_000,
      lastRun: Date.now() - 3 * 60_000,  // 3 minutes ago
      lastHalted: null,
      commands: [],
    };
    expect(isEngineOnline(engine)).toBe(false);
  });

  it('returns false when lastRun is exactly 2 minutes ago (boundary)', () => {
    const engine: Engine = {
      id: 'ENG_003',
      hostname: 'boundary-engine',
      version: '1.0',
      hostOS: 'Linux',
      created: Date.now() - 3_600_000,
      lastBooted: Date.now() - 3_600_000,
      lastRun: Date.now() - 2 * 60_000,  // exactly 2 minutes
      lastHalted: null,
      commands: [],
    };
    // Date.now() - 2*60*1000 equals twoMinutesAgo, so it is NOT > twoMinutesAgo
    expect(isEngineOnline(engine)).toBe(false);
  });

  it('returns true for both mock engines (they are online)', () => {
    const eng1 = MOCK_STORE.engineDB[MOCK_IDS.ENGINE_1_ID];
    const eng2 = MOCK_STORE.engineDB[MOCK_IDS.ENGINE_2_ID];
    expect(isEngineOnline(eng1)).toBe(true);
    expect(isEngineOnline(eng2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getEngineTree
// ---------------------------------------------------------------------------
describe('getEngineTree', () => {
  it('returns one node per engine', () => {
    const tree = getEngineTree(MOCK_STORE);
    expect(tree).toHaveLength(2);
  });

  it('attaches the correct disks to each engine', () => {
    const tree = getEngineTree(MOCK_STORE);

    const node1 = tree.find((n) => n.engine.id === MOCK_IDS.ENGINE_1_ID);
    const node2 = tree.find((n) => n.engine.id === MOCK_IDS.ENGINE_2_ID);

    expect(node1).toBeDefined();
    expect(node2).toBeDefined();

    // Engine 1 has 1 disk (kolibri-disk)
    expect(node1!.disks).toHaveLength(1);
    expect(node1!.disks[0].id).toBe(MOCK_IDS.DISK_1_ID);

    // Engine 2 has 2 disks (nextcloud-disk, wikipedia-disk)
    expect(node2!.disks).toHaveLength(2);
    const diskIds = node2!.disks.map((d) => d.id);
    expect(diskIds).toContain(MOCK_IDS.DISK_2_ID);
    expect(diskIds).toContain('DISK003');
  });

  it('includes engine metadata in each node', () => {
    const tree = getEngineTree(MOCK_STORE);
    const node1 = tree.find((n) => n.engine.id === MOCK_IDS.ENGINE_1_ID)!;
    expect(node1.engine.hostname).toBe('appdocker01');
    expect(node1.engine.version).toBe('1.2.0');
  });
});
