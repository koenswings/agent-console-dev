/**
 * Engine sign-in client (agent-engine-dev#582 §5) against mocked endpoints:
 * transport and relay paths, proof, sign-in to every Engine, setup, renew,
 * logout, operators, and the per-Engine token store.
 */
import { createHmac } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiBase, apiCall, EngineApiError, type EngineApiTransport } from '../src/store/engineApi';
import {
  computeLoginProof,
  hmacSha256Hex,
  isBcryptSalt,
  loginProofFromHash,
  loginProofMessage,
  makePasswordHash,
} from '../src/store/loginProof';
import {
  addOperator,
  changePasswordOn,
  fetchAuthInfo,
  listOperators,
  logoutAll,
  normaliseSetupCode,
  removeOperatorOn,
  renewEngine,
  setupEngine,
  signInAll,
  signInEngine,
  startSessionRenewal,
  supportsSignedCommands,
} from '../src/store/engineAuth';
import {
  clearEngineSessions,
  dropExpiredEngineSessions,
  engineSessions,
  hasAnyEngineSession,
  monoNow,
  putEngineSession,
  sessionFor,
  signedInUsername,
  tokenFor,
} from '../src/store/engineTokens';

// A low cost keeps the tests fast; the Engine hands out the real salt.
const SALT = bcrypt.genSaltSync(4);
const PASSWORD = 'correct horse';
const H = bcrypt.hashSync(PASSWORD, SALT);

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
type Handler = (call: Call) => { status: number; body?: unknown; headers?: Record<string, string> };

const jsonResponse = (status: number, body?: unknown, headers: Record<string, string> = {}): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

function mockTransport(handler: Handler, selfEngineId: string | null = 'eng-a'): { t: EngineApiTransport; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const r = handler(call);
    return jsonResponse(r.status, r.body, r.headers);
  });
  return { t: { origin: '', selfEngineId, fetch: fetchFn }, calls };
}

/** An Engine that knows one operator with hash H, behind /api (eng-a) or the relay. */
const engineHandler = (opts: { failLogin?: boolean } = {}): Handler => (c) => {
  const m = c.url.match(/^\/api(?:\/engines\/([^/]+))?(\/.*)$/);
  const engineId = m?.[1] ? decodeURIComponent(m[1]) : 'eng-a';
  const path = m?.[2] ?? '';
  if (path === '/auth/challenge') return { status: 200, body: { challengeId: `ch-${engineId}`, salt: SALT, nonce: `n-${engineId}`, expiresInMs: 60_000 } };
  if (path === '/auth/login') {
    const b = c.body as { challengeId: string; proof: string; username: string };
    const expected = loginProofFromHash(H, engineId, b.challengeId, `n-${engineId}`);
    if (opts.failLogin || b.proof !== expected) return { status: 401, body: { error: 'LOGIN_FAILED', message: 'Wrong username or password.' } };
    return { status: 200, body: { token: `tok-${engineId}`, expiresInMs: 900_000, operator: { id: 'op1', username: b.username } } };
  }
  return { status: 404, body: { error: 'NOT_FOUND', message: 'no' } };
};

beforeEach(() => {
  clearEngineSessions();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('engineApi transport', () => {
  it('uses /api for the page Engine and the relay for any other', () => {
    expect(apiBase({ origin: '', selfEngineId: 'eng-a' }, 'eng-a')).toBe('/api');
    expect(apiBase({ origin: '', selfEngineId: 'eng-a' }, null)).toBe('/api');
    expect(apiBase({ origin: '', selfEngineId: 'eng-a' }, 'eng b')).toBe('/api/engines/eng%20b');
    expect(apiBase({ origin: 'http://idea01:8080', selfEngineId: null }, 'eng-b')).toBe('http://idea01:8080/api/engines/eng-b');
  });

  it('sends JSON with a Bearer token and parses an error body', async () => {
    const { t, calls } = mockTransport(() => ({ status: 422, body: { error: 'COMMAND_REFUSED', message: 'No.', reason: 'x' } }));
    const err = await apiCall(t, '/command', { token: 'abc', body: { command: 'reboot' } }).catch((e) => e);
    expect(err).toBeInstanceOf(EngineApiError);
    expect(err.code).toBe('COMMAND_REFUSED');
    expect(err.status).toBe(422);
    expect(err.body.reason).toBe('x');
    expect(calls[0].headers.Authorization).toBe('Bearer abc');
    expect(calls[0].headers['Content-Type']).toBe('application/json');
    expect(calls[0].method).toBe('POST');
  });

  it('reads Retry-After on a rate limit', async () => {
    const { t } = mockTransport(() => ({ status: 429, body: { error: 'LOGIN_RATE_LIMITED', message: 'wait' }, headers: { 'Retry-After': '60' } }));
    const err = await apiCall(t, '/auth/login', { body: {} }).catch((e) => e);
    expect(err.code).toBe('LOGIN_RATE_LIMITED');
    expect(err.retryAfterS).toBe(60);
  });

  it('maps a failed fetch to NETWORK_ERROR and an unknown code to UNKNOWN', async () => {
    const t: EngineApiTransport = { origin: '', selfEngineId: null, fetch: () => Promise.reject(new TypeError('Failed to fetch')) };
    expect((await apiCall(t, '/auth/info').catch((e) => e)).code).toBe('NETWORK_ERROR');
    const { t: t2 } = mockTransport(() => ({ status: 500, body: { error: 'WHATEVER', message: 'm' } }));
    expect((await apiCall(t2, '/auth/info').catch((e) => e)).code).toBe('UNKNOWN');
  });

  it('accepts an empty 204', async () => {
    const t: EngineApiTransport = { origin: '', selfEngineId: null, fetch: async () => new Response(null, { status: 204 }) };
    await expect(apiCall(t, '/auth/logout', { body: {} })).resolves.toEqual({ status: 204, data: null });
  });
});

describe('login proof', () => {
  it('matches HMAC-SHA256 from node:crypto', () => {
    const msg = loginProofMessage('eng-a', 'ch1', 'n1');
    expect(msg).toBe('idea-login-v1|eng-a|ch1|n1');
    const expected = createHmac('sha256', Buffer.from(H, 'utf8')).update(msg, 'utf8').digest('hex');
    expect(hmacSha256Hex(H, msg)).toBe(expected);
    expect(loginProofFromHash(H, 'eng-a', 'ch1', 'n1')).toBe(expected);
  });

  it('computes bcrypt with the Engine salt, then the proof', async () => {
    const proof = await computeLoginProof(PASSWORD, { salt: SALT, challengeId: 'ch1', nonce: 'n1' }, 'eng-a');
    expect(proof).toBe(loginProofFromHash(H, 'eng-a', 'ch1', 'n1'));
    expect(proof).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is bound to the Engine id', () => {
    expect(loginProofFromHash(H, 'eng-a', 'c', 'n')).not.toBe(loginProofFromHash(H, 'eng-b', 'c', 'n'));
  });

  it('rejects a malformed salt', async () => {
    expect(isBcryptSalt(SALT)).toBe(true);
    expect(isBcryptSalt('nope')).toBe(false);
    await expect(computeLoginProof('x', { salt: 'nope', challengeId: 'c', nonce: 'n' }, 'e')).rejects.toThrow();
  });

  it('makes cost-10 password hashes', async () => {
    const hash = await makePasswordHash('pw');
    expect(hash.startsWith('$2b$10$')).toBe(true);
    expect(bcrypt.compareSync('pw', hash)).toBe(true);
  });
});

describe('auth info', () => {
  it('returns the info and the signedCommands1 flag', async () => {
    const info = { engineId: 'eng-a', engineName: 'idea03', version: '1.9.0', authVersion: 1, setupRequired: false, capabilities: ['signedCommands1'] };
    const { t, calls } = mockTransport(() => ({ status: 200, body: info }));
    const got = await fetchAuthInfo(t);
    expect(got).toEqual(info);
    expect(supportsSignedCommands(got)).toBe(true);
    expect(calls[0].url).toBe('/api/auth/info');
    expect(calls[0].method).toBe('GET');
  });

  it('reports an Engine without the sign-in API as NOT_SUPPORTED', async () => {
    const { t } = mockTransport(() => ({ status: 404, body: { error: 'NOT_FOUND', message: 'Not found' } }));
    expect((await fetchAuthInfo(t).catch((e) => e)).code).toBe('NOT_SUPPORTED');
  });

  it('keeps ENGINE_VERSION_MISMATCH from the relay', async () => {
    const { t } = mockTransport(() => ({ status: 409, body: { error: 'ENGINE_VERSION_MISMATCH', message: 'old', version: '1.2.0' } }));
    const err = await fetchAuthInfo(t, 'eng-b').catch((e) => e);
    expect(err.code).toBe('ENGINE_VERSION_MISMATCH');
    expect(err.body.version).toBe('1.2.0');
  });
});

describe('sign-in', () => {
  it('signs in to the page Engine and stores its token', async () => {
    const { t, calls } = mockTransport(engineHandler());
    await signInEngine(t, 'eng-a', 'koen', PASSWORD);
    expect(calls.map((c) => c.url)).toEqual(['/api/auth/challenge', '/api/auth/login']);
    expect(calls[1].body).not.toHaveProperty('password');
    expect(JSON.stringify(calls)).not.toContain(PASSWORD);
    expect(tokenFor('eng-a')).toBe('tok-eng-a');
    expect(signedInUsername()).toBe('koen');
  });

  it('one form signs in to every Engine through the relay, one bcrypt per salt', async () => {
    const { t, calls } = mockTransport(engineHandler());
    const spy = vi.spyOn(bcrypt, 'hashSync');
    const results = await signInAll(t, ['eng-a', 'eng-b', 'eng-c'], 'koen', PASSWORD);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(calls.map((c) => c.url)).toContain('/api/engines/eng-b/auth/login');
    expect(Object.keys(engineSessions()).sort()).toEqual(['eng-a', 'eng-b', 'eng-c']);
    expect(tokenFor('eng-c')).toBe('tok-eng-c');
  });

  it('reports per Engine which sign-ins failed', async () => {
    const base = engineHandler();
    const { t } = mockTransport((c) =>
      c.url.startsWith('/api/engines/eng-b/') ? { status: 502, body: { error: 'ENGINE_UNREACHABLE', message: 'down' } } : base(c));
    const results = await signInAll(t, ['eng-a', 'eng-b'], 'koen', PASSWORD);
    expect(results[0]).toEqual({ engineId: 'eng-a', ok: true });
    expect(results[1].ok).toBe(false);
    expect(!results[1].ok && results[1].error.code).toBe('ENGINE_UNREACHABLE');
    expect(hasAnyEngineSession()).toBe(true);
    expect(tokenFor('eng-b')).toBeNull();
  });

  it('a wrong password stores no token', async () => {
    const { t } = mockTransport(engineHandler());
    const results = await signInAll(t, ['eng-a'], 'koen', 'wrong');
    expect(!results[0].ok && results[0].error.code).toBe('LOGIN_FAILED');
    expect(hasAnyEngineSession()).toBe(false);
  });
});

describe('setup', () => {
  it('normalises the code and sends a cost-10 hash, never the password', async () => {
    const { t, calls } = mockTransport(() => ({ status: 201, body: { token: 'tok-setup', expiresInMs: 900_000, operator: { id: 'op1', username: 'admin' } } }));
    await setupEngine(t, 'eng-a', ' abcd efgh ', 'admin', 'pw-setup');
    const body = calls[0].body as { setupCode: string; passwordHash: string; username: string };
    expect(calls[0].url).toBe('/api/auth/setup');
    expect(body.setupCode).toBe('ABCD-EFGH');
    expect(body.passwordHash.startsWith('$2b$10$')).toBe(true);
    expect(JSON.stringify(body)).not.toContain('pw-setup');
    expect(tokenFor('eng-a')).toBe('tok-setup');
  });

  it('normaliseSetupCode keeps unusual input as typed (upper case)', () => {
    expect(normaliseSetupCode('abcd-efgh')).toBe('ABCD-EFGH');
    expect(normaliseSetupCode('abc')).toBe('ABC');
  });

  it('surfaces SETUP_CODE_INVALID', async () => {
    const { t } = mockTransport(() => ({ status: 403, body: { error: 'SETUP_CODE_INVALID', message: 'bad' } }));
    expect((await setupEngine(t, 'eng-a', 'AAAA-BBBB', 'a', 'b').catch((e) => e)).code).toBe('SETUP_CODE_INVALID');
    expect(hasAnyEngineSession()).toBe(false);
  });
});

describe('renew, logout and operators', () => {
  it('renew extends the session', async () => {
    putEngineSession('eng-a', 'tok', { id: 'op1', username: 'k' }, 1_000);
    const before = sessionFor('eng-a')!.expiresAt;
    const { t, calls } = mockTransport(() => ({ status: 200, body: { expiresInMs: 900_000 } }));
    expect(await renewEngine(t, 'eng-a')).toBe(true);
    expect(sessionFor('eng-a')!.expiresAt).toBeGreaterThan(before);
    expect(calls[0].url).toBe('/api/auth/renew');
    expect(calls[0].headers.Authorization).toBe('Bearer tok');
  });

  it('renew drops the token on TOKEN_EXPIRED but keeps it when the Engine is unreachable', async () => {
    putEngineSession('eng-b', 'tok-b', { id: 'op1', username: 'k' }, 1_000);
    const { t: down } = mockTransport(() => ({ status: 502, body: { error: 'ENGINE_UNREACHABLE', message: 'x' } }));
    expect(await renewEngine(down, 'eng-b')).toBe(true);
    expect(tokenFor('eng-b')).toBe('tok-b');
    const { t: expired } = mockTransport(() => ({ status: 401, body: { error: 'TOKEN_EXPIRED', message: 'x' } }));
    expect(await renewEngine(expired, 'eng-b')).toBe(false);
    expect(tokenFor('eng-b')).toBeNull();
  });

  it('logout calls every Engine and clears tokens even if one fails', async () => {
    putEngineSession('eng-a', 'ta', { id: 'op1', username: 'k' }, 1_000);
    putEngineSession('eng-b', 'tb', { id: 'op1', username: 'k' }, 1_000);
    const { t, calls } = mockTransport((c) => (c.url.includes('eng-b') ? { status: 502, body: { error: 'ENGINE_UNREACHABLE', message: 'x' } } : { status: 204 }));
    await logoutAll(t);
    expect(calls.map((c) => c.url).sort()).toEqual(['/api/auth/logout', '/api/engines/eng-b/auth/logout']);
    expect(hasAnyEngineSession()).toBe(false);
  });

  it('lists, adds and removes operators with the Engine token', async () => {
    putEngineSession('eng-b', 'tb', { id: 'op1', username: 'k' }, 60_000);
    const { t, calls } = mockTransport((c) => {
      if (c.method === 'GET') return { status: 200, body: { operators: [{ id: 'op1', username: 'k', created: 1 }] } };
      if (c.method === 'POST') return { status: 201, body: { operator: { id: 'op2', username: 'n', created: 2 } } };
      return { status: 204 };
    });
    expect(await listOperators(t, 'eng-b')).toEqual([{ id: 'op1', username: 'k', created: 1 }]);
    expect((await addOperator(t, 'eng-b', 'n', '$2b$10$x')).id).toBe('op2');
    await removeOperatorOn(t, 'eng-b', 'op/2');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/engines/eng-b/auth/operators',
      'POST /api/engines/eng-b/auth/operators',
      'DELETE /api/engines/eng-b/auth/operators/op%2F2',
    ]);
    expect(calls.every((c) => c.headers.Authorization === 'Bearer tb')).toBe(true);
  });

  it('operator calls without a token fail with AUTH_REQUIRED and a 401 drops the token', async () => {
    const { t } = mockTransport(() => ({ status: 401, body: { error: 'TOKEN_INVALID', message: 'x' } }));
    expect((await listOperators(t, 'eng-a').catch((e) => e)).code).toBe('AUTH_REQUIRED');
    putEngineSession('eng-a', 'ta', { id: 'op1', username: 'k' }, 60_000);
    expect((await listOperators(t, 'eng-a').catch((e) => e)).code).toBe('TOKEN_INVALID');
    expect(tokenFor('eng-a')).toBeNull();
  });

  it('password change proves the current password through a challenge', async () => {
    putEngineSession('eng-a', 'ta', { id: 'op1', username: 'koen' }, 60_000);
    const base = engineHandler();
    const { t, calls } = mockTransport((c) => (c.url.endsWith('/auth/password') ? { status: 204 } : base(c)));
    await changePasswordOn(t, 'eng-a', 'koen', PASSWORD, '$2b$10$new');
    const body = calls[1].body as { challengeId: string; proof: string; newPasswordHash: string };
    expect(body.proof).toBe(loginProofFromHash(H, 'eng-a', 'ch-eng-a', 'n-eng-a'));
    expect(body.newPasswordHash).toBe('$2b$10$new');
    expect(calls[1].headers.Authorization).toBe('Bearer ta');
  });
});

describe('token store', () => {
  it('drops sessions past their lifetime', () => {
    putEngineSession('eng-a', 'ta', { id: 'op1', username: 'k' }, 1_000);
    putEngineSession('eng-b', 'tb', { id: 'op1', username: 'k' }, 60_000);
    expect(dropExpiredEngineSessions(monoNow() + 5_000)).toEqual(['eng-a']);
    expect(tokenFor('eng-a')).toBeNull();
    expect(tokenFor('eng-b')).toBe('tb');
  });

  it('never writes tokens to localStorage', () => {
    putEngineSession('eng-a', 'secret-token', { id: 'op1', username: 'k' }, 1_000);
    const all = Object.keys(localStorage).map((k) => localStorage.getItem(k)).join('|');
    expect(all).not.toContain('secret-token');
  });
});

describe('session renewal', () => {
  it('renews on the interval only while visible, and reports ended sessions', async () => {
    vi.useFakeTimers();
    putEngineSession('eng-a', 'ta', { id: 'op1', username: 'k' }, 60_000);
    putEngineSession('eng-b', 'tb', { id: 'op1', username: 'k' }, 60_000);
    let visible = false;
    const { t, calls } = mockTransport((c) =>
      c.url.includes('eng-b') ? { status: 401, body: { error: 'TOKEN_EXPIRED', message: 'x' } } : { status: 200, body: { expiresInMs: 900_000 } });
    const ended = vi.fn();
    const stop = startSessionRenewal({ transport: () => t, isVisible: () => visible, onSessionsEnded: ended, intervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(0);

    visible = true;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls.map((c) => c.url)).toEqual(['/api/auth/renew', '/api/engines/eng-b/auth/renew']);
    expect(ended).toHaveBeenCalledWith(['eng-b']);
    expect(tokenFor('eng-b')).toBeNull();

    stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toHaveLength(2);
  });

  it('renews right away when the page becomes visible again', async () => {
    putEngineSession('eng-a', 'ta', { id: 'op1', username: 'k' }, 60_000);
    let visible = false;
    const { t, calls } = mockTransport(() => ({ status: 200, body: { expiresInMs: 900_000 } }));
    const stop = startSessionRenewal({ transport: () => t, isVisible: () => visible, intervalMs: 3_600_000 });
    visible = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    stop();
  });
});
