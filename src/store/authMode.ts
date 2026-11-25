/**
 * Which sign-in the Console uses with the Engine that serves it (agent-engine-dev#582).
 *
 *   'engine'  — the page's Engine answers GET /api/auth/info: operators sign in
 *               on the Engines and commands go through POST /api/command.
 *   'legacy'  — the page's Engine answers 404 (an Engine from before #582):
 *               the Console works as before (userDB sign-in, commands written
 *               into the store). Engines that only take signed commands are
 *               switched off for commands in this mode.
 *   'probing' — not known yet (no answer, or the Engine is unreachable).
 *               Sign-in and commands wait; the probe is retried.
 *
 * The mode is decided by the page's Engine only, once per connection. Outside
 * the app (unit tests, components rendered alone) it stays 'legacy'.
 *
 * Engines gain the API in steps (docs/COMMAND_AUTH.md in the Engine repo):
 *   engineSignIn1   — /api/auth/* (sign-in, setup, operators); commands still
 *                     go into the store queue as before.
 *   signedCommands1 — POST /api/command; unsigned queue entries are refused.
 *   engineRelay1    — /api/engines/<id>/...: the page's Engine forwards
 *                     sign-in and commands to other Engines of the store.
 */
import { createSignal } from 'solid-js';
import { EngineApiError, type EngineApiTransport } from './engineApi';
import { fetchAuthInfo, type AuthInfo } from './engineAuth';

export type AuthMode = 'engine' | 'legacy' | 'probing';

const [mode, setMode] = createSignal<AuthMode>('legacy');
const [transport, setTransportSignal] = createSignal<EngineApiTransport | null>(null);
const [pageInfo, setPageInfo] = createSignal<AuthInfo | null>(null);

export const authMode = mode;
/** The API transport of the current connection (selfEngineId filled once probed). */
export const authTransport = transport;
/** GET /api/auth/info of the page's Engine, in 'engine' mode. */
export const pageAuthInfo = pageInfo;
/** Id of the page's Engine as it reported itself, in 'engine' mode. */
export const pageAuthEngineId = (): string | null => pageInfo()?.engineId ?? null;

export const isEngineAuth = (): boolean => mode() === 'engine';

/** The page's Engine has `cap` in its /api/auth/info capabilities (engine mode only). */
export const pageHasCapability = (cap: string): boolean => (pageInfo()?.capabilities ?? []).includes(cap);

/** The page's Engine relays /api/engines/<id>/... to other Engines (capability engineRelay1). */
export const RELAY_CAPABILITY = 'engineRelay1';
export const pageHasRelay = (): boolean => mode() === 'engine' && pageHasCapability(RELAY_CAPABILITY);

/**
 * How to load another Engine's command log: through the page Engine's relay,
 * directly, or not yet (null while the probe has not answered, so a direct
 * attempt that can only fail is not made and kept).
 */
export const remoteLogRoute = (): 'relay' | 'direct' | null =>
  mode() === 'probing' ? null : pageHasRelay() ? 'relay' : 'direct';

/** A new connection: forget the old answer and wait for the probe. */
export const beginAuthProbe = (t: EngineApiTransport | null): void => {
  setTransportSignal(t ? { ...t, selfEngineId: null } : null);
  setPageInfo(null);
  setMode(t ? 'probing' : 'legacy');
};

/** Retry delay while the page's Engine gives no answer. */
export const AUTH_PROBE_RETRY_MS = 5_000;

/**
 * Ask the page's Engine which sign-in it supports. Resolves with the mode it
 * set: 'engine' on 200, 'legacy' on 404, 'probing' when there was no usable
 * answer (the caller retries).
 */
export async function probeAuthMode(): Promise<AuthMode> {
  const t = transport();
  if (!t) { setMode('legacy'); return 'legacy'; }
  try {
    const info = await fetchAuthInfo({ ...t, selfEngineId: null });
    if (transport() !== t) return mode();
    setTransportSignal({ ...t, selfEngineId: info.engineId });
    setPageInfo(info);
    setMode('engine');
    return 'engine';
  } catch (err) {
    if (transport() !== t) return mode();
    if (err instanceof EngineApiError && err.code === 'NOT_SUPPORTED') {
      setMode('legacy');
      return 'legacy';
    }
    setMode('probing');
    return 'probing';
  }
}

/** Re-read the page's Engine info (setupRequired changes after setup). */
export async function refreshPageAuthInfo(): Promise<AuthInfo | null> {
  const t = transport();
  if (!t || mode() !== 'engine') return pageInfo();
  try {
    const info = await fetchAuthInfo(t);
    setPageInfo(info);
    return info;
  } catch {
    return pageInfo();
  }
}

/** For tests: put the module in a known state. */
export const setAuthModeForTest = (m: AuthMode, t: EngineApiTransport | null = null, info: AuthInfo | null = null, hasRelay = false): void => {
  setTransportSignal(t);
  const caps = info?.capabilities ?? [];
  setPageInfo(info && hasRelay && !caps.includes(RELAY_CAPABILITY) ? { ...info, capabilities: [...caps, RELAY_CAPABILITY] } : info);
  setMode(m);
};
