/**
 * Engine sign-in client (agent-engine-dev#582 §2, §4, §5).
 *
 * Every call goes to the page's own origin: `/api/auth/...` for the page's
 * Engine, `/api/engines/<id>/auth/...` for another Engine (relay). One sign-in
 * form signs in to every reachable Engine; the password is only held for that
 * loop. Tokens live in engineTokens.ts.
 */
import { apiCall, EngineApiError, type EngineApiTransport } from './engineApi';
import { bcryptWithSalt, loginProofFromHash, makePasswordHash } from './loginProof';
import {
  dropEngineSession,
  extendEngineSession,
  putEngineSession,
  engineSessions,
  tokenFor,
  clearEngineSessions,
} from './engineTokens';

/** Capability an Engine advertises when it accepts signed commands. */
export const SIGNED_COMMANDS_CAPABILITY = 'signedCommands1';

export interface AuthInfo {
  engineId: string;
  engineName: string;
  version: string;
  authVersion: number;
  setupRequired: boolean;
  capabilities: string[];
}

export interface Challenge {
  challengeId: string;
  salt: string;
  nonce: string;
  expiresInMs: number;
}

export interface SessionGrant {
  token: string;
  expiresInMs: number;
  operator: { id: string; username: string };
}

export interface OperatorInfo {
  id: string;
  username: string;
  created: number;
}

/**
 * GET /api/auth/info. A 404 means an Engine without the sign-in API: it
 * rejects with code NOT_SUPPORTED (through the relay: ENGINE_VERSION_MISMATCH).
 */
export async function fetchAuthInfo(t: EngineApiTransport, engineId?: string | null): Promise<AuthInfo> {
  try {
    const { data } = await apiCall<AuthInfo>(t, '/auth/info', { engineId });
    if (!data || typeof data.engineId !== 'string') {
      throw new EngineApiError(200, 'UNKNOWN', 'Unexpected answer from /api/auth/info');
    }
    return { ...data, capabilities: Array.isArray(data.capabilities) ? data.capabilities : [] };
  } catch (err) {
    if (err instanceof EngineApiError && err.status === 404 && err.code !== 'ENGINE_UNKNOWN') {
      throw new EngineApiError(404, 'NOT_SUPPORTED', err.message, err.body);
    }
    throw err;
  }
}

export const supportsSignedCommands = (info: Pick<AuthInfo, 'capabilities'>): boolean =>
  info.capabilities.includes(SIGNED_COMMANDS_CAPABILITY);

/**
 * Sign in to one Engine: challenge, proof, login. `hashCache` maps a salt to
 * bcrypt(password, salt) so Engines that share a hash (imported from the
 * same store) cost one bcrypt run, not one per Engine.
 */
export async function signInEngine(
  t: EngineApiTransport,
  engineId: string,
  username: string,
  password: string,
  hashCache: Map<string, string> = new Map(),
): Promise<SessionGrant> {
  const { data: ch } = await apiCall<Challenge>(t, '/auth/challenge', { engineId, body: { username } });
  let h = hashCache.get(ch.salt);
  if (h === undefined) {
    h = await bcryptWithSalt(password, ch.salt);
    hashCache.set(ch.salt, h);
  }
  const proof = loginProofFromHash(h, engineId, ch.challengeId, ch.nonce);
  const { data } = await apiCall<SessionGrant>(t, '/auth/login', {
    engineId,
    body: { challengeId: ch.challengeId, username, proof },
  });
  putEngineSession(engineId, data.token, data.operator, data.expiresInMs);
  return data;
}

export type SignInResult =
  | { engineId: string; ok: true }
  | { engineId: string; ok: false; error: EngineApiError };

/**
 * One form, every reachable Engine. Engines are tried one after the other (a
 * rate limit is per remote address, and the relay is one address). Returns a
 * result per Engine; the caller shows which ones failed. The password is not
 * kept after this returns.
 */
export async function signInAll(
  t: EngineApiTransport,
  engineIds: readonly string[],
  username: string,
  password: string,
): Promise<SignInResult[]> {
  const hashCache = new Map<string, string>();
  const results: SignInResult[] = [];
  for (const engineId of engineIds) {
    try {
      await signInEngine(t, engineId, username, password, hashCache);
      results.push({ engineId, ok: true });
    } catch (err) {
      const e = err instanceof EngineApiError ? err : new EngineApiError(null, 'UNKNOWN', String(err));
      results.push({ engineId, ok: false, error: e });
    }
  }
  hashCache.clear();
  return results;
}

/** First-time setup on one Engine with its one-time setup code. */
export async function setupEngine(
  t: EngineApiTransport,
  engineId: string,
  setupCode: string,
  username: string,
  password: string,
): Promise<SessionGrant> {
  const passwordHash = await makePasswordHash(password);
  const { data } = await apiCall<SessionGrant>(t, '/auth/setup', {
    engineId,
    body: { setupCode: normaliseSetupCode(setupCode), username, passwordHash },
  });
  putEngineSession(engineId, data.token, data.operator, data.expiresInMs);
  return data;
}

/** Setup codes are Crockford base32 shown as XXXX-XXXX; accept any case and spacing. */
export const normaliseSetupCode = (raw: string): string => {
  const compact = raw.toUpperCase().replace(/[\s-]/g, '');
  return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;
};

/** True for a 401 that means "this Engine's token is gone". */
const isTokenGone = (err: unknown): boolean =>
  err instanceof EngineApiError
  && (err.code === 'TOKEN_INVALID' || err.code === 'TOKEN_EXPIRED' || err.code === 'AUTH_REQUIRED');

/**
 * Renew one Engine's session. On a 401 the token is dropped and false is
 * returned; other failures (Engine unreachable) keep the token for the next try.
 */
export async function renewEngine(t: EngineApiTransport, engineId: string): Promise<boolean> {
  const token = tokenFor(engineId);
  if (!token) return false;
  try {
    const { data } = await apiCall<{ expiresInMs: number }>(t, '/auth/renew', { engineId, token, body: {} });
    extendEngineSession(engineId, data.expiresInMs);
    return true;
  } catch (err) {
    if (isTokenGone(err)) {
      dropEngineSession(engineId);
      return false;
    }
    return true;
  }
}

/** Log out of every Engine of this page. Tokens are dropped even when a call fails. */
export async function logoutAll(t: EngineApiTransport): Promise<void> {
  const ids = Object.keys(engineSessions());
  await Promise.allSettled(
    ids.map((engineId) => apiCall(t, '/auth/logout', { engineId, token: tokenFor(engineId), body: {} })),
  );
  clearEngineSessions();
}

/** Run `fn` with `engineId`'s token; a 401 drops that token and rethrows. */
async function withToken<T>(engineId: string, fn: (token: string) => Promise<T>): Promise<T> {
  const token = tokenFor(engineId);
  if (!token) throw new EngineApiError(401, 'AUTH_REQUIRED', 'Not signed in to this Engine');
  try {
    return await fn(token);
  } catch (err) {
    if (isTokenGone(err)) dropEngineSession(engineId);
    throw err;
  }
}

export const listOperators = (t: EngineApiTransport, engineId: string): Promise<OperatorInfo[]> =>
  withToken(engineId, async (token) => {
    const { data } = await apiCall<{ operators: OperatorInfo[] }>(t, '/auth/operators', { engineId, token });
    return data.operators ?? [];
  });

export const addOperator = (
  t: EngineApiTransport,
  engineId: string,
  username: string,
  passwordHash: string,
): Promise<OperatorInfo> =>
  withToken(engineId, async (token) => {
    const { data } = await apiCall<{ operator: OperatorInfo }>(t, '/auth/operators', {
      engineId, token, body: { username, passwordHash },
    });
    return data.operator;
  });

export const removeOperatorOn = (t: EngineApiTransport, engineId: string, operatorId: string): Promise<void> =>
  withToken(engineId, async (token) => {
    await apiCall(t, `/auth/operators/${encodeURIComponent(operatorId)}`, { engineId, token, method: 'DELETE' });
  });

/** POST /auth/grant on `fromEngineId`: lets `toEngineId` run follow-ups there. */
export const requestGrant = (
  t: EngineApiTransport,
  fromEngineId: string,
  toEngineId: string,
): Promise<{ grant: string; expiresInMs: number }> =>
  withToken(fromEngineId, async (token) => {
    const { data } = await apiCall<{ grant: string; expiresInMs: number }>(t, '/auth/grant', {
      engineId: fromEngineId, token, body: { toEngineId },
    });
    return data;
  });

/** Change the caller's own password on one Engine (proves the current one first). */
export const changePasswordOn = (
  t: EngineApiTransport,
  engineId: string,
  username: string,
  currentPassword: string,
  newPasswordHash: string,
): Promise<void> =>
  withToken(engineId, async (token) => {
    const { data: ch } = await apiCall<Challenge>(t, '/auth/challenge', { engineId, body: { username } });
    const h = await bcryptWithSalt(currentPassword, ch.salt);
    const proof = loginProofFromHash(h, engineId, ch.challengeId, ch.nonce);
    await apiCall(t, '/auth/password', {
      engineId, token, body: { challengeId: ch.challengeId, proof, newPasswordHash },
    });
  });

/** How often to renew while the page is visible (§5: every 5 minutes). */
export const RENEW_INTERVAL_MS = 5 * 60_000;

export interface RenewalDeps {
  transport: () => EngineApiTransport | null;
  isVisible?: () => boolean;
  /** Called with the Engine ids whose session ended (renew answered 401). */
  onSessionsEnded?: (engineIds: string[]) => void;
  intervalMs?: number;
}

/**
 * Keep the page's Engine sessions alive while the page is visible: renew every
 * RENEW_INTERVAL_MS, and right away when the page becomes visible again (a
 * session may have ended while hidden; the 401 then asks for a new sign-in).
 * Returns a stop function.
 */
export function startSessionRenewal(deps: RenewalDeps): () => void {
  const visible = deps.isVisible ?? (() => typeof document === 'undefined' || document.visibilityState === 'visible');
  let running = false;

  const renewAll = async (): Promise<void> => {
    const t = deps.transport();
    if (!t || running || !visible()) return;
    running = true;
    try {
      const ids = Object.keys(engineSessions());
      const ended: string[] = [];
      for (const id of ids) {
        if (!(await renewEngine(t, id))) ended.push(id);
      }
      if (ended.length > 0) deps.onSessionsEnded?.(ended);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => { void renewAll(); }, deps.intervalMs ?? RENEW_INTERVAL_MS);
  const onVisibility = (): void => { if (visible()) void renewAll(); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  return () => {
    clearInterval(timer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  };
}
