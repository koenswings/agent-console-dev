/**
 * agent-engine-dev#582 step 2 Engines and later answers: which path a command
 * takes per target (engineSignIn1 / signedCommands1 / neither, with and
 * without the relay), sign-in only to the page's Engine without the relay,
 * the card contents in the flash summary, the setup lock wait, 413, and the
 * page being signed out when its Engine session ends.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAuthModeForTest } from '../src/store/authMode';
import { commandPath, configureCommandRouter, dispatchCommand, newerEngineMessage, noRelayMessage } from '../src/store/commandRouter';
import { olderEngineMessage } from '../src/store/signedCommand';
import { summaryRows } from '../src/store/engineConfirm';
import { authErrorText, formatWait } from '../src/store/engineAuth';
import { apiCall, EngineApiError, type EngineApiTransport } from '../src/store/engineApi';
import {
  currentUser,
  handleSessionsEnded,
  logout,
  setAuthenticatedUser,
  setupWithCode,
  signedOutNotice,
  signInEngineIds,
} from '../src/store/auth';
import { clearEngineSessions } from '../src/store/engineTokens';
import type { AuthInfo } from '../src/store/engineAuth';
import type { Engine, Store } from '../src/types/store';

const NOW = 1_800_000_000_000;
const eng = (id: string, caps: string[]): Engine => ({
  id, hostname: `host-${id}`, version: '2.0', capabilities: caps, capabilitiesBootedAt: NOW, lastBooted: NOW,
} as unknown as Engine);
const store = (...engines: Engine[]): Store => ({ engineDB: Object.fromEntries(engines.map((e) => [e.id, e])) } as unknown as Store);
const info = (id: string, caps: string[]): AuthInfo => ({ engineId: id, engineName: `host-${id}`, version: '2.0', authVersion: 1, setupRequired: false, capabilities: caps });
const t: EngineApiTransport = { origin: '', selfEngineId: 'P', fetch: vi.fn() };

afterEach(async () => {
  setAuthModeForTest('legacy');
  configureCommandRouter({ legacySend: null, store: () => null });
  clearEngineSessions();
  await logout();
});

describe('command path per target', () => {
  const SIGN = eng('S', ['engineSignIn1']);
  const SIGNED = eng('C', ['engineSignIn1', 'signedCommands1']);
  const OLD = eng('O', []);

  it('step-2 page Engine (engineSignIn1 only): everything goes into the store queue', () => {
    setAuthModeForTest('engine', t, info('S', ['engineSignIn1']));
    expect(commandPath(SIGN)).toEqual({ kind: 'queue' });
    expect(commandPath(OLD)).toEqual({ kind: 'queue' });
  });

  it('step-3 page Engine: signed to signed Engines, queue to sign-in-only ones, older ones blocked', () => {
    setAuthModeForTest('engine', t, info('C', ['engineSignIn1', 'signedCommands1']), true);
    expect(commandPath(SIGNED)).toEqual({ kind: 'signed' });
    expect(commandPath(SIGN)).toEqual({ kind: 'queue' });
    expect(commandPath(OLD)).toEqual({ kind: 'blocked', message: olderEngineMessage('host-O', '2.0') });
  });

  it('another signed Engine without the relay on the page Engine is blocked with a reason', () => {
    setAuthModeForTest('engine', t, info('P', ['engineSignIn1', 'signedCommands1']), false);
    expect(commandPath(SIGNED)).toEqual({ kind: 'blocked', message: noRelayMessage('host-C') });
    expect(commandPath(eng('P', ['signedCommands1']))).toEqual({ kind: 'signed' });
  });

  it('legacy page: signed Engines blocked, sign-in-only and older ones queued', () => {
    setAuthModeForTest('legacy');
    expect(commandPath(SIGNED)).toEqual({ kind: 'blocked', message: newerEngineMessage('host-C') });
    expect(commandPath(SIGN)).toEqual({ kind: 'queue' });
    expect(commandPath(OLD)).toEqual({ kind: 'queue' });
  });

  it('a queued command on a step-2 Engine is written with the store send', async () => {
    const legacySend = vi.fn();
    configureCommandRouter({ legacySend, store: () => store(SIGN) });
    setAuthModeForTest('engine', t, info('S', ['engineSignIn1']));
    expect(await dispatchCommand('S', 'reboot')).toEqual({ kind: 'accepted', engineId: 'S', seq: null });
    expect(legacySend).toHaveBeenCalledWith('S', 'reboot');
  });
});

describe('sign-in Engines', () => {
  it('without the relay: only the page Engine', () => {
    setAuthModeForTest('engine', t, info('P', ['engineSignIn1']), false);
    expect(signInEngineIds(store(eng('P', ['engineSignIn1']), eng('Q', ['engineSignIn1'])), 'P')).toEqual(['P']);
  });
  it('with the relay: Engines with engineSignIn1 or signedCommands1, not older ones', () => {
    setAuthModeForTest('engine', t, info('P', ['engineSignIn1']), true);
    const s = store(eng('P', ['engineSignIn1']), eng('Q', ['engineSignIn1']), eng('R', ['signedCommands1']), eng('O', []));
    expect(signInEngineIds(s, 'P')).toEqual(['P', 'Q', 'R']);
  });
});

describe('flash summary contents', () => {
  it('shows what is on the card now as "Now on the card"', () => {
    const rows = summaryRows({ command: 'flashCard', candidateId: 'c', sizeBytes: 32e9, model: 'SanDisk', version: '1.2', contents: { kind: 'raspios' } });
    expect(rows.find((r) => r.key === 'contents')).toEqual({ key: 'contents', label: 'Now on the card', value: 'Raspberry Pi OS' });
    const idea = summaryRows({ contents: { kind: 'idea-client', imageName: 'idea-client', version: '26.04' } });
    expect(idea[0].value).toBe('IDEA client image 26.04');
  });
});

describe('waits, setup lock and 413', () => {
  it('formats waits', () => {
    expect(formatWait(45)).toBe('45 s');
    expect(formatWait(900)).toBe('15 min');
  });

  it('a locked setup code shows the wait', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ error: 'LOGIN_RATE_LIMITED', message: 'x', retryAfterSeconds: 840 }), { status: 429, headers: { 'Retry-After': '840' } }));
    setAuthModeForTest('engine', { origin: '', selfEngineId: 'P', fetch: fetchFn }, info('P', ['engineSignIn1']));
    const r = await setupWithCode('P', 'ABCD-EFGH', 'first', 'pass-1234', null);
    expect(r).toEqual({ ok: false, message: 'Setup is locked after too many wrong codes. Try again in 14 min.' });
  });

  it('413 maps to a plain message', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ error: 'BAD_REQUEST', message: 'Request body too large.' }), { status: 413 }));
    const err = await apiCall({ origin: '', selfEngineId: 'P', fetch: fetchFn }, '/auth/operators', { body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(EngineApiError);
    expect(err.code).toBe('BODY_TOO_LARGE');
    expect(authErrorText(err, 'x')).toBe('That is too long for the Engine. Use a shorter name or password.');
  });
});

describe('the page Engine session ended', () => {
  it('signs the page out with a reason for the sign-in form', async () => {
    setAuthModeForTest('engine', t, info('P', ['engineSignIn1']));
    setAuthenticatedUser({ id: 'u', username: 'mary', passwordHash: '', role: 'operator', created: 0 } as never);
    await handleSessionsEnded(['P'], store(eng('P', ['engineSignIn1'])));
    expect(currentUser()).toBeNull();
    expect(signedOutNotice()).toBe('Your session on host-P ended. Sign in again.');
  });
  it('another Engine ending is not a sign-out', async () => {
    setAuthModeForTest('engine', t, info('P', ['engineSignIn1']));
    setAuthenticatedUser({ id: 'u', username: 'mary', passwordHash: '', role: 'operator', created: 0 } as never);
    await handleSessionsEnded(['Q']);
    expect(currentUser()?.username).toBe('mary');
  });
});
