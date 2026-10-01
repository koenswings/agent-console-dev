import { describe, it, expect } from 'vitest';
import { switchEngineScanTimeoutMs } from '../e2e/intents/operatorDeepActions';

describe('switchEngineScanTimeoutMs (Prefer A r39)', () => {
  it('defaults to 45s while Scanning for engines', () => {
    expect(switchEngineScanTimeoutMs({})).toBe(45_000);
  });

  it('DURATION_SWITCH_ENGINE_SCAN_MS override', () => {
    expect(switchEngineScanTimeoutMs({ DURATION_SWITCH_ENGINE_SCAN_MS: '60000' })).toBe(
      60_000,
    );
  });

  it('rejects values below 5s floor', () => {
    expect(switchEngineScanTimeoutMs({ DURATION_SWITCH_ENGINE_SCAN_MS: '1000' })).toBe(
      5_000,
    );
  });
});
