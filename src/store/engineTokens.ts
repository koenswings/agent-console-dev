/**
 * Engine session tokens for the open page (agent-engine-dev#582 §5).
 *
 * One token per Engine, held in a signal for this page only: nothing goes to
 * localStorage or chrome.storage, so a reload or a new window means a new
 * sign-in (as agent-console-dev#260). Tokens are dropped on logout, on a 401
 * from that Engine, or when the Engine's session lifetime has passed.
 */
import { createSignal } from 'solid-js';

export interface EngineSession {
  engineId: string;
  token: string;
  operator: { id: string; username: string };
  /** performance.now() value after which the Engine has dropped the session. */
  expiresAt: number;
}

type SessionMap = Readonly<Record<string, EngineSession>>;

const [sessions, setSessions] = createSignal<SessionMap>({});

/** Monotonic clock (ms); wall clocks on school devices are not trusted. */
export const monoNow = (): number => performance.now();

/** All Engine sessions of this page, keyed by Engine id. */
export const engineSessions = sessions;

/** The session for `engineId`, or null. */
export const sessionFor = (engineId: string): EngineSession | null => sessions()[String(engineId)] ?? null;

/** The token for `engineId`, or null. */
export const tokenFor = (engineId: string): string | null => sessionFor(engineId)?.token ?? null;

/** True when the page holds a session for at least one Engine. */
export const hasAnyEngineSession = (): boolean => Object.keys(sessions()).length > 0;

/** Ids of the Engines this page is signed in to. */
export const signedInEngineIds = (): string[] => Object.keys(sessions());

/** The operator name of the page's sessions (they share one sign-in form), or null. */
export const signedInUsername = (): string | null => {
  const first = Object.values(sessions())[0];
  return first ? first.operator.username : null;
};

export const putEngineSession = (
  engineId: string,
  token: string,
  operator: { id: string; username: string },
  expiresInMs: number,
): void => {
  const id = String(engineId);
  setSessions((prev) => ({ ...prev, [id]: { engineId: id, token, operator, expiresAt: monoNow() + expiresInMs } }));
};

/** After a renew: move the end of the session forward. */
export const extendEngineSession = (engineId: string, expiresInMs: number): void => {
  const id = String(engineId);
  setSessions((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], expiresAt: monoNow() + expiresInMs } } : prev));
};

export const dropEngineSession = (engineId: string): void => {
  const id = String(engineId);
  setSessions((prev) => {
    if (!prev[id]) return prev;
    const next = { ...prev };
    delete next[id];
    return next;
  });
};

export const clearEngineSessions = (): void => {
  setSessions({});
};

/** Drop sessions whose lifetime has passed; returns the dropped Engine ids. */
export const dropExpiredEngineSessions = (now: number = monoNow()): string[] => {
  const expired = Object.values(sessions()).filter((s) => s.expiresAt <= now).map((s) => s.engineId);
  if (expired.length > 0) {
    setSessions((prev) => {
      const next = { ...prev };
      for (const id of expired) delete next[id];
      return next;
    });
  }
  return expired;
};
