/**
 * Transport for the Engine sign-in and command API (agent-engine-dev#582 §5).
 *
 * The Console talks only to its own origin:
 *   - `/api/...` is the Engine that served the page;
 *   - `/api/engines/<engineId>/...` is the same API on another Engine, relayed
 *     by the page's Engine.
 * Bodies are JSON; errors are `{ error: <CODE>, message, ...extra }`.
 *
 * Nothing here touches the store or the old command path; callers pass the
 * token and the fetch function (tests use a mock).
 */

/** Error codes from the Console contract (agent-engine-dev#582 §5). */
export type EngineApiErrorCode =
  | 'BAD_REQUEST'
  | 'AUTH_REQUIRED'
  | 'TOKEN_INVALID'
  | 'TOKEN_EXPIRED'
  | 'LOGIN_FAILED'
  | 'LOGIN_RATE_LIMITED'
  | 'SETUP_REQUIRED'
  | 'SETUP_CODE_INVALID'
  | 'SETUP_DONE'
  | 'CONFIRM_REQUIRED'
  | 'CONFIRM_INVALID'
  | 'GRANT_REQUIRED'
  | 'GRANT_INVALID'
  | 'GRANT_EXPIRED'
  | 'COMMAND_REFUSED'
  | 'ENGINE_UNKNOWN'
  | 'ENGINE_UNREACHABLE'
  | 'ENGINE_VERSION_MISMATCH'
  /** DELETE /api/auth/operators/<id> of the last operator (Axle, #582 review answer 14). */
  | 'LAST_OPERATOR'
  /** DELETE of an operator id the Engine does not know (pixel-answers 14). */
  | 'OPERATOR_UNKNOWN'
  /** POST of a username the Engine already has (pixel-answers 14). */
  | 'OPERATOR_EXISTS'
  /** Console-side: the call failed before an Engine answered (network, timeout, not JSON). */
  | 'NETWORK_ERROR'
  /** Console-side: an Engine without the sign-in API (GET /api/auth/info answered 404). */
  | 'NOT_SUPPORTED'
  /** Console-side: an error body without a code we know. */
  | 'UNKNOWN';

const KNOWN_CODES: ReadonlySet<string> = new Set<EngineApiErrorCode>([
  'BAD_REQUEST', 'AUTH_REQUIRED', 'TOKEN_INVALID', 'TOKEN_EXPIRED', 'LOGIN_FAILED',
  'LOGIN_RATE_LIMITED', 'SETUP_REQUIRED', 'SETUP_CODE_INVALID', 'SETUP_DONE',
  'CONFIRM_REQUIRED', 'CONFIRM_INVALID', 'GRANT_REQUIRED', 'GRANT_INVALID', 'GRANT_EXPIRED',
  'COMMAND_REFUSED', 'ENGINE_UNKNOWN', 'ENGINE_UNREACHABLE', 'ENGINE_VERSION_MISMATCH',
  'LAST_OPERATOR', 'OPERATOR_UNKNOWN', 'OPERATOR_EXISTS',
]);

/** A failed call: HTTP status (null when no answer), contract code, message and extra fields. */
export class EngineApiError extends Error {
  readonly status: number | null;
  readonly code: EngineApiErrorCode;
  readonly body: Readonly<Record<string, unknown>>;
  /** Seconds from `Retry-After`, when the Engine sent one. */
  readonly retryAfterS: number | null;

  constructor(
    status: number | null,
    code: EngineApiErrorCode,
    message: string,
    body: Record<string, unknown> = {},
    retryAfterS: number | null = null,
  ) {
    super(message);
    this.name = 'EngineApiError';
    this.status = status;
    this.code = code;
    this.body = body;
    this.retryAfterS = retryAfterS;
  }
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Where the API lives and how to reach it. */
export interface EngineApiTransport {
  /**
   * Prefix before `/api`: '' on a page served by an Engine (same origin), or
   * `http://<host[:port]>` for the extension, which has host permissions.
   */
  origin: string;
  /** Id of the Engine behind `origin`, from its GET /api/auth/info. */
  selfEngineId: string | null;
  fetch: FetchFn;
  /** Per-call timeout (ms). */
  timeoutMs?: number;
}

export const DEFAULT_API_TIMEOUT_MS = 15_000;

/**
 * The API base for `engineId`: `/api` for the page's own Engine (or when the
 * target is not given), `/api/engines/<id>` for any other Engine (relay).
 */
export const apiBase = (t: Pick<EngineApiTransport, 'origin' | 'selfEngineId'>, engineId?: string | null): string => {
  const own = !engineId || (t.selfEngineId !== null && String(engineId) === t.selfEngineId);
  return own ? `${t.origin}/api` : `${t.origin}/api/engines/${encodeURIComponent(String(engineId))}`;
};

const parseRetryAfter = (res: Response): number | null => {
  const raw = res.headers?.get?.('Retry-After');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : null;
};

export interface ApiCallOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  /** Session token, sent as `Authorization: Bearer <token>`. */
  token?: string | null;
  /** Target Engine; another Engine than the page's goes through the relay. */
  engineId?: string | null;
}

/**
 * One call to `<base><path>`. Resolves with the parsed JSON body (or null for
 * an empty 2xx such as 204) and the status. Rejects with EngineApiError for
 * any non-2xx answer or a call that got no answer.
 */
export async function apiCall<T>(
  t: EngineApiTransport,
  path: string,
  opts: ApiCallOptions = {},
): Promise<{ status: number; data: T }> {
  const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const url = `${apiBase(t, opts.engineId)}${path}`;

  let res: Response;
  try {
    res = await t.fetch(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: 'omit',
      signal: AbortSignal.timeout(t.timeoutMs ?? DEFAULT_API_TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new EngineApiError(null, 'NETWORK_ERROR', msg);
  }

  const text = await res.text().catch(() => '');
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (res.ok) return { status: res.status, data: parsed as T };

  const body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  const rawCode = typeof body.error === 'string' ? body.error : '';
  const code: EngineApiErrorCode = KNOWN_CODES.has(rawCode) ? (rawCode as EngineApiErrorCode) : 'UNKNOWN';
  const message = typeof body.message === 'string' ? body.message : `HTTP ${res.status}`;
  const bodyRetry = typeof body.retryAfterSeconds === 'number' && body.retryAfterSeconds >= 0
    ? Math.ceil(body.retryAfterSeconds)
    : null;
  throw new EngineApiError(res.status, code, message, body, parseRetryAfter(res) ?? bodyRetry);
}
