import { describe, it, expect } from 'vitest';
import {
  describeConsoleScreen,
  operatorLayoutLoaded,
  opLayoutTimeoutMs,
  type ConsoleScreen,
} from '../e2e/intents/operatorLayout';

const base: ConsoleScreen = {
  url: 'http://idea01:8080/',
  status: 'idea01',
  connectedDot: true,
  opOverview: true,
  networkTree: true,
  engineRows: 3,
  settings: false,
  connectionManagement: false,
  account: false,
  loginForm: false,
};

describe('operatorLayoutLoaded (kc10 FAIL@133)', () => {
  it('loaded when connected and the operator layout lists Engines', () => {
    expect(operatorLayoutLoaded(base)).toBe(true);
  });
  it('not loaded while Settings covers the layout (walker reaches reboot_engine from op_settings)', () => {
    expect(operatorLayoutLoaded({ ...base, opOverview: false, networkTree: false, engineRows: 0, settings: true })).toBe(false);
  });
  it('not loaded when connected but signed out (the old check soft-passed this)', () => {
    expect(operatorLayoutLoaded({ ...base, opOverview: false, networkTree: false, engineRows: 0 })).toBe(false);
  });
  it('not loaded while the tree has no Engine rows', () => {
    expect(operatorLayoutLoaded({ ...base, engineRows: 0 })).toBe(false);
  });
  it('not loaded while disconnected', () => {
    expect(operatorLayoutLoaded({ ...base, connectedDot: false })).toBe(false);
  });
});

describe('describeConsoleScreen', () => {
  it('names the panel covering the layout', () => {
    expect(describeConsoleScreen({ ...base, opOverview: false, networkTree: false, settings: true })).toMatch(/^screen=Settings /);
    expect(describeConsoleScreen({ ...base, connectionManagement: true })).toMatch(/^screen=Connection Management /);
  });
  it('names a lost operator session', () => {
    const s = { ...base, opOverview: false, networkTree: false, engineRows: 0 };
    expect(describeConsoleScreen(s)).toMatch(/signed-out App view/);
    expect(describeConsoleScreen({ ...s, loginForm: true })).toMatch(/login form/);
  });
  it('includes url, status and counts', () => {
    expect(describeConsoleScreen(base)).toBe(
      'screen=operator layout url=http://idea01:8080/ status="idea01" connected=true opOverview=true networkTree=true engineRows=3',
    );
  });
});

describe('opLayoutTimeoutMs', () => {
  it('defaults to 60s, honours override, floors at 5s', () => {
    expect(opLayoutTimeoutMs({})).toBe(60_000);
    expect(opLayoutTimeoutMs({ DURATION_OP_LAYOUT_MS: '90000' })).toBe(90_000);
    expect(opLayoutTimeoutMs({ DURATION_OP_LAYOUT_MS: '100' })).toBe(5_000);
  });
});
