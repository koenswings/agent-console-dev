/**
 * agent-engine-dev#582 steps 3–4 on the box: the relay is known from the page
 * Engine's `engineRelay1` capability (no extra request), and another Engine's
 * command log is loaded only once the probe has answered, through the relay
 * when there is one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginAuthProbe,
  pageHasRelay,
  probeAuthMode,
  remoteLogRoute,
  setAuthModeForTest,
} from '../src/store/authMode';
import type { EngineApiTransport } from '../src/store/engineApi';
import type { AuthInfo } from '../src/store/engineAuth';

const info = (caps: string[]): AuthInfo => ({
  engineId: 'ENGINE_A', engineName: 'box-engine-a', version: '1.0', authVersion: 1, setupRequired: false, capabilities: caps,
});
const answering = (body: AuthInfo): { t: EngineApiTransport; fetch: ReturnType<typeof vi.fn> } => {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  return { t: { origin: '', selfEngineId: null, fetch }, fetch };
};

afterEach(() => setAuthModeForTest('legacy'));

describe('relay from engineRelay1', () => {
  it('page Engine with engineRelay1: relay known after one request', async () => {
    const { t, fetch } = answering(info(['engineSignIn1', 'signedCommands1', 'engineRelay1']));
    beginAuthProbe(t);
    expect(await probeAuthMode()).toBe('engine');
    expect(pageHasRelay()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toBe('/api/auth/info');
  });

  it('page Engine without engineRelay1 (step 3 only): no relay, no relay request', async () => {
    const { t, fetch } = answering(info(['engineSignIn1', 'signedCommands1']));
    beginAuthProbe(t);
    expect(await probeAuthMode()).toBe('engine');
    expect(pageHasRelay()).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('legacy mode never has a relay, whatever the info says', () => {
    setAuthModeForTest('legacy', null, info(['engineRelay1']));
    expect(pageHasRelay()).toBe(false);
  });
});

describe('remote command log route', () => {
  it('waits while probing', () => {
    const { t } = answering(info(['engineRelay1']));
    beginAuthProbe(t);
    expect(remoteLogRoute()).toBeNull();
  });

  it('relay once the page Engine reports engineRelay1', async () => {
    const { t } = answering(info(['engineSignIn1', 'signedCommands1', 'engineRelay1']));
    beginAuthProbe(t);
    await probeAuthMode();
    expect(remoteLogRoute()).toBe('relay');
  });

  it('direct for a page Engine without the relay, and in legacy mode', async () => {
    const { t } = answering(info(['engineSignIn1']));
    beginAuthProbe(t);
    await probeAuthMode();
    expect(remoteLogRoute()).toBe('direct');
    setAuthModeForTest('legacy');
    expect(remoteLogRoute()).toBe('direct');
  });
});
