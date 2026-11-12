import { describe, it, expect } from 'vitest';
import { connectionIndicator, RECONNECTING_LABEL } from '../src/store/connectionIndicator';

const base = { connected: true, socketState: 'live' as const, demo: false, discovering: false, hostname: 'idea04', engineName: () => 'idea04' };

describe('status-bar indicator (agent-engine-dev#168)', () => {
  it('live socket: green dot and the Engine name', () => {
    expect(connectionIndicator(base)).toEqual({ dotClass: 'status-bar__dot--connected', label: 'idea04' });
  });
  it('lost socket: reconnecting dot and plain wording', () => {
    expect(connectionIndicator({ ...base, socketState: 'reconnecting' })).toEqual({ dotClass: 'status-bar__dot--reconnecting', label: RECONNECTING_LABEL });
    expect(RECONNECTING_LABEL).toBe('Connection lost, reconnecting…');
  });
  it('back to live after reconnect', () => {
    expect(connectionIndicator({ ...base, socketState: 'live' }).label).toBe('idea04');
  });
  it('never connected: existing states unchanged', () => {
    expect(connectionIndicator({ ...base, connected: false }).label).toBe('Connecting…');
    expect(connectionIndicator({ ...base, connected: false, hostname: null }).label).toBe('No engine found');
    expect(connectionIndicator({ ...base, connected: false, discovering: true }).label).toBe('Scanning for engines...');
  });
});
