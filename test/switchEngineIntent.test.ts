import { describe, it, expect } from 'vitest';
import {
  switchEngineScanTimeoutMs,
  switchEngineConnectTimeoutMs,
  orderSwitchEngineHosts,
  isIpv4SwitchHost,
  switchHostsMatch,
} from '../e2e/intents/operatorDeepActions';

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

describe('switchEngineConnectTimeoutMs (Prefer A r43)', () => {
  it('defaults to 60s for Connect + hostname retry', () => {
    expect(switchEngineConnectTimeoutMs({})).toBe(60_000);
  });

  it('DURATION_SWITCH_ENGINE_CONNECT_MS override', () => {
    expect(
      switchEngineConnectTimeoutMs({ DURATION_SWITCH_ENGINE_CONNECT_MS: '90000' }),
    ).toBe(90_000);
  });
});

describe('orderSwitchEngineHosts / isIpv4SwitchHost (Prefer A r43)', () => {
  it('detects IPv4', () => {
    expect(isIpv4SwitchHost('100.99.231.94')).toBe(true);
    expect(isIpv4SwitchHost('idea01')).toBe(false);
    expect(isIpv4SwitchHost('idea01.local')).toBe(false);
  });

  it('orders hostname before IP', () => {
    expect(
      orderSwitchEngineHosts(['100.99.231.94', 'idea01', 'idea03']),
    ).toEqual(['idea01', 'idea03', '100.99.231.94']);
  });

  it('dedupes and strips .local', () => {
    expect(orderSwitchEngineHosts(['idea01.local', 'idea01', '100.1.1.1'])).toEqual([
      'idea01',
      '100.1.1.1',
    ]);
  });
});

describe('switchHostsMatch (Prefer A r44 already connected)', () => {
  it('matches idea01 status to HOST idea01', () => {
    expect(switchHostsMatch('idea01', 'idea01')).toBe(true);
    expect(switchHostsMatch('idea01', 'idea01.local')).toBe(true);
  });

  it('does not match Connecting or a different host', () => {
    expect(switchHostsMatch('Connecting…', 'idea01')).toBe(false);
    expect(switchHostsMatch('idea03', 'idea01')).toBe(false);
    expect(switchHostsMatch('100.99.231.94', 'idea01')).toBe(false);
  });
});
