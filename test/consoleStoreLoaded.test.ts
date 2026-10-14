import { describe, it, expect } from 'vitest';
import {
  consoleStoreLoaded,
  pollUntil,
  switchEngineLoadTimeoutMs,
} from '../e2e/intents/operatorDeepActions';

describe('consoleStoreLoaded (idea#168 r86s FAIL@128)', () => {
  it('not loaded while disconnected', () => {
    expect(consoleStoreLoaded({ connectedDot: false, treeVisible: true, engineRows: 3 })).toBe(false);
  });
  it('not loaded when the Network tree is visible with zero Engine rows (store reloading)', () => {
    expect(consoleStoreLoaded({ connectedDot: true, treeVisible: true, engineRows: 0 })).toBe(false);
  });
  it('loaded when connected and the tree lists Engines', () => {
    expect(consoleStoreLoaded({ connectedDot: true, treeVisible: true, engineRows: 3 })).toBe(true);
  });
  it('loaded when connected and the tree is not on screen (Settings open)', () => {
    expect(consoleStoreLoaded({ connectedDot: true, treeVisible: false, engineRows: 0 })).toBe(true);
  });
});

describe('pollUntil', () => {
  const fakeClock = () => {
    let t = 0;
    return { now: () => t, sleep: async (ms: number) => { t += ms; } };
  };
  it('returns once the probe yields, after the store load window', async () => {
    const c = fakeClock();
    let calls = 0;
    const v = await pollUntil(async () => (++calls >= 16 ? 'ok' : null), 60_000, 250, c.sleep, c.now);
    expect(v).toBe('ok');
    expect(c.now()).toBe(15 * 250);
  });
  it('returns null after the budget', async () => {
    const c = fakeClock();
    const v = await pollUntil(async () => null, 1_000, 250, c.sleep, c.now);
    expect(v).toBeNull();
    expect(c.now()).toBe(1_000);
  });
});

describe('switchEngineLoadTimeoutMs', () => {
  it('defaults to 60s, honours override, floors at 5s', () => {
    expect(switchEngineLoadTimeoutMs({})).toBe(60_000);
    expect(switchEngineLoadTimeoutMs({ DURATION_SWITCH_ENGINE_LOAD_MS: '90000' })).toBe(90_000);
    expect(switchEngineLoadTimeoutMs({ DURATION_SWITCH_ENGINE_LOAD_MS: '100' })).toBe(5_000);
  });
});
