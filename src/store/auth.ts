/**
 * Operator sign-in and operator management.
 *
 * Two modes (authMode.ts), chosen by the Engine that serves the page:
 *   - 'engine' (agent-engine-dev#582): operators sign in on the Engines with a
 *     challenge; one form signs in to every Engine that takes signed commands.
 *     Accounts live on each Engine; this page only holds session tokens
 *     (engineTokens.ts). userDB is never read or written.
 *   - 'legacy' (Engines from before #582): credentials in the store's userDB,
 *     checked with bcryptjs in the browser, as before.
 * Either way the session lives in memory for the open page only.
 *
 * Auth state is held in a module-level Solid.js signal, reactive across all
 * components that import it.
 */
import { createSignal } from 'solid-js';
import bcrypt from 'bcryptjs';
import { bcryptCompare } from './bcryptCompare';
import type { User, UserID, Store } from '../types/store';
import { IS_EXTENSION } from './context';
import { authMode, authTransport, pageAuthEngineId, pageAuthInfo, pageHasRelay, refreshPageAuthInfo } from './authMode';
import {
  addOperator,
  authErrorText,
  formatWait,
  changePasswordOn,
  listOperators,
  logoutAll,
  removeOperatorOn,
  setupEngine,
  signInAll,
  type OperatorInfo,
} from './engineAuth';
import { EngineApiError } from './engineApi';
import { clearEngineSessions, sessionFor, signedInEngineIds } from './engineTokens';
import { makePasswordHash } from './loginProof';
import { engineHasCapability } from './commands';

// ---------------------------------------------------------------------------
// Auth state signals
// ---------------------------------------------------------------------------

const [currentUser, setCurrentUser] = createSignal<User | null>(null);

export { currentUser };
export const isOperator = () => currentUser() !== null;

/**
 * True when the page's Engine has no operator yet. Engine mode: its
 * /api/auth/info says setupRequired (a setup code is needed). Legacy: userDB
 * is empty.
 */
export const isFirstTimeSetup = (store: Store | null): boolean => {
  if (!store) return false;
  const m = authMode();
  if (m === 'engine') return pageAuthInfo()?.setupRequired === true;
  if (m === 'probing') return false;
  return Object.keys(store.userDB ?? {}).length === 0;
};

// ---------------------------------------------------------------------------
// Session storage
// ---------------------------------------------------------------------------

/**
 * The operator session lives only in the currentUser signal of this page.
 * Nothing in browser storage can start one: only login() (password checked
 * against userDB) or setAuthenticatedUser() right after creating an operator.
 * A reload or a new Console window therefore needs a new sign-in.
 *
 * SESSION_KEY is the entry earlier Console versions wrote; it is removed on
 * startup and on logout and is never read as a session.
 */
const SESSION_KEY = 'operatorSession';

async function clearStoredSession(): Promise<void> {
  if (IS_EXTENSION) {
    try { await chrome.storage.local.remove(SESSION_KEY); } catch {}
  }
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Set the current user directly (after external verification).
 * Use this when you've already verified the password to avoid running bcrypt twice.
 *
 * Synchronous so callers can use Solid's batch() to co-update other signals
 * (e.g. setShowLogin) atomically in the same reactive flush.
 */
export function setAuthenticatedUser(user: User): void {
  setCurrentUser(user);
}

/**
 * Attempt login. Returns true on success, false on bad credentials.
 * On success, sets the currentUser signal for this page.
 */
export async function login(
  username: string,
  password: string,
  store: Store
): Promise<boolean> {
  const user = Object.values(store.userDB ?? {}).find(
    (u) => u.username === username
  );
  if (!user) return false;

  // Coerce to plain string — Automerge wraps values in ImmutableString objects;
  // bcryptjs throws "Illegal arguments" if it receives a non-string.
  // Use compareSync in a setTimeout(0) — avoids scheduler.postTask quirks in
  // modern browsers that can cause bcrypt.compare() to never resolve.
  const hash = String(user.passwordHash);
  const match = await bcryptCompare(password, hash);
  if (!match) return false;

  setCurrentUser(user);
  return true;
}

/**
 * Log out the current operator. Clears the signal and stored session.
 */
export async function logout(): Promise<void> {
  setCurrentUser(null);
  setEngineIssues([]);
  const t = authTransport();
  if (t && signedInEngineIds().length > 0) await logoutAll(t).catch(() => undefined);
  clearEngineSessions();
  await clearStoredSession();
}

/**
 * Start-up session step, run once the store first arrives.
 * Sessions are not kept across page loads (see Session storage above), so this
 * only removes a stored entry left by an earlier Console version. The Console
 * starts in user mode until an operator signs in.
 */
export async function restoreSession(store: Store | null): Promise<void> {
  if (!store) return;
  await clearStoredSession();
}

/**
 * Create a new operator and write them to the Store via changeDoc.
 * Returns the created User. Throws if username is already taken.
 */
export async function createOperator(
  username: string,
  password: string,
  store: Store,
  changeDoc: (fn: (doc: Store) => void) => void
): Promise<User> {
  const existing = Object.values(store.userDB ?? {}).find(
    (u) => u.username === username
  );
  if (existing) throw new Error(`Username "${username}" is already taken`);

  // Cost 10: ~100ms — secure and non-blocking in the browser.
  // Cost 12 (~1s) caused UI thread blocking on login/setup.
  const passwordHash = await bcrypt.hash(password, 10);
  const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user: User = {
    id,
    username,
    passwordHash,
    role: 'operator',
    created: Date.now(),
  };

  changeDoc((doc) => {
    if (!doc.userDB) (doc as unknown as Record<string, unknown>).userDB = {};
    doc.userDB[id] = user;
  });

  return user;
}

/**
 * Remove an operator from the Store.
 * The caller is responsible for preventing self-removal if desired.
 */
export function removeOperator(
  userId: UserID,
  changeDoc: (fn: (doc: Store) => void) => void
): void {
  changeDoc((doc) => {
    delete doc.userDB[userId];
  });
}

/**
 * Change an operator's password. Validates the current password first.
 * Returns true on success, false if current password is wrong.
 */
export async function changePassword(
  userId: UserID,
  currentPassword: string,
  newPassword: string,
  store: Store,
  changeDoc: (fn: (doc: Store) => void) => void
): Promise<boolean> {
  const user = (store.userDB ?? {})[userId];
  if (!user) return false;

  const match = await bcryptCompare(currentPassword, String(user.passwordHash));
  if (!match) return false;

  const newHash = await bcrypt.hash(newPassword, 10);
  changeDoc((doc) => {
    if (doc.userDB[userId]) {
      doc.userDB[userId].passwordHash = newHash;
    }
  });
  return true;
}

// ---------------------------------------------------------------------------
// Engine sign-in (agent-engine-dev#582), used when authMode() is 'engine'
// ---------------------------------------------------------------------------

/** An Engine this page could not sign in to, with the reason to show. */
export interface EngineIssue {
  engineId: string;
  engineName: string;
  code: string;
  message: string;
}

const [engineIssues, setEngineIssues] = createSignal<EngineIssue[]>([]);

/** Engines the last sign-in could not reach or that need setup (per Engine). */
export { engineIssues };

/** Display name of an Engine: its store hostname, or what it reported. */
export const engineDisplayName = (store: Store | null | undefined, engineId: string): string => {
  const host = store?.engineDB?.[engineId]?.hostname;
  if (host) return String(host);
  if (pageAuthInfo()?.engineId === engineId) return pageAuthInfo()!.engineName;
  return engineId;
};

/**
 * Engines one sign-in covers: the page's Engine first, then every other Engine
 * in the store that takes signed commands this boot. Older Engines get no
 * sign-in (their commands are switched off).
 */
export const signInEngineIds = (store: Store | null | undefined, selfId: string): string[] => {
  // Other Engines are only reachable through the relay.
  if (!pageHasRelay()) return [selfId];
  const others = Object.values(store?.engineDB ?? {})
    .filter((e) => String(e.id) !== selfId
      && (engineHasCapability(e, 'signedCommands1') || engineHasCapability(e, 'engineSignIn1')))
    .map((e) => String(e.id))
    .sort();
  return [selfId, ...others];
};

const userFrom = (operator: { id: string; username: string }): User => ({
  id: operator.id,
  username: operator.username,
  passwordHash: '',
  role: 'operator',
  created: 0,
});

const asApiError = (err: unknown): EngineApiError =>
  err instanceof EngineApiError ? err : new EngineApiError(null, 'UNKNOWN', err instanceof Error ? err.message : String(err));

export type SignInOutcome =
  | { ok: true; user: User; issues: EngineIssue[] }
  | { ok: false; message: string; setupRequired?: boolean };

const STILL_CONNECTING = 'Still connecting to the Engine. Try again in a moment.';

/**
 * Sign in with one form. Engine mode: every Engine of signInEngineIds; the
 * page's Engine must accept, the others are listed in `issues` when they
 * could not be signed in to. Legacy mode: the userDB check, as before.
 * The password is not kept. Legacy mode checks userDB and
 * sets the user itself.
 */
export async function signIn(
  username: string,
  password: string,
  store: Store | null,
  opts: { deferUser?: boolean } = {},
): Promise<SignInOutcome> {
  const m = authMode();
  if (m === 'probing') return { ok: false, message: STILL_CONNECTING };
  if (m === 'legacy') {
    if (!store) return { ok: false, message: STILL_CONNECTING };
    const ok = await login(username, password, store);
    const user = currentUser();
    return ok && user ? { ok: true, user, issues: [] } : { ok: false, message: 'Invalid username or password.' };
  }
  const t = authTransport();
  const self = pageAuthEngineId();
  if (!t || !self) return { ok: false, message: STILL_CONNECTING };

  const results = await signInAll(t, signInEngineIds(store, self), username, password);
  const own = results.find((r) => r.engineId === self);
  if (!own || !own.ok) {
    clearEngineSessions();
    const err = own && !own.ok ? own.error : new EngineApiError(null, 'UNKNOWN', 'Sign-in failed.');
    return { ok: false, message: authErrorText(err, engineDisplayName(store, self)), setupRequired: err.code === 'SETUP_REQUIRED' };
  }
  const issues: EngineIssue[] = results
    .filter((r): r is Extract<typeof r, { ok: false }> => !r.ok)
    .map((r) => ({
      engineId: r.engineId,
      engineName: engineDisplayName(store, r.engineId),
      code: r.error.code,
      message: authErrorText(r.error, engineDisplayName(store, r.engineId)),
    }));
  setEngineIssues(issues);
  const session = sessionFor(self);
  if (!session) return { ok: false, message: 'Sign-in failed.' };
  const user = userFrom(session.operator);
  // deferUser: the caller sets the user itself (setAuthenticatedUser) when
  // flipping it here would unmount the calling form mid-handler.
  setSignedOutNotice(null);
  if (!opts.deferUser) setCurrentUser(user);
  return { ok: true, user, issues };
}

/**
 * First operator on one Engine with its setup code. On the page's Engine this
 * also signs the page in; on another Engine it clears that Engine's issue.
 */
export async function setupWithCode(
  engineId: string,
  setupCode: string,
  username: string,
  password: string,
  store: Store | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const t = authTransport();
  if (authMode() !== 'engine' || !t) return { ok: false, message: STILL_CONNECTING };
  try {
    const grant = await setupEngine(t, engineId, setupCode, username, password);
    if (engineId === pageAuthEngineId()) {
      setCurrentUser(userFrom(grant.operator));
      await refreshPageAuthInfo();
    }
    setEngineIssues((prev) => prev.filter((i) => i.engineId !== engineId));
    return { ok: true };
  } catch (err) {
    const e = asApiError(err);
    // 5 wrong setup codes lock setup for 15 minutes (429 with Retry-After).
    if (e.code === 'LOGIN_RATE_LIMITED') {
      return {
        ok: false,
        message: e.retryAfterS !== null
          ? `Setup is locked after too many wrong codes. Try again in ${formatWait(e.retryAfterS)}.`
          : 'Setup is locked after too many wrong codes. Try again later.',
      };
    }
    return { ok: false, message: authErrorText(e, engineDisplayName(store, engineId)) };
  }
}

const [signedOutNotice, setSignedOutNotice] = createSignal<string | null>(null);
/**
 * Why the page was signed out by an Engine (its session ended: expired, the
 * operator was removed, or the password was changed elsewhere). Shown on the
 * sign-in form; cleared by the next sign-in.
 */
export { signedOutNotice };
export const clearSignedOutNotice = (): void => { setSignedOutNotice(null); };

/**
 * Sessions that ended (any call answered 401 and the token was dropped). When
 * the page's own session ended the page is signed out and asks for a new sign-in.
 */
export async function handleSessionsEnded(engineIds: string[], store: Store | null = null): Promise<void> {
  const self = pageAuthEngineId();
  if (!self || !engineIds.includes(self) || !currentUser()) return;
  setSignedOutNotice(`Your session on ${engineDisplayName(store, self)} ended. Sign in again.`);
  await logout();
}

/** Result of a change applied on every signed-in Engine. */
export type EverywhereResult =
  | { ok: true; failed: EngineIssue[] }
  | { ok: false; message: string };

const issueFor = (store: Store | null, engineId: string, err: unknown): EngineIssue => {
  const e = asApiError(err);
  const name = engineDisplayName(store, engineId);
  return { engineId, engineName: name, code: e.code, message: authErrorText(e, name) };
};

/** Operators of the page's Engine (engine mode), without hashes. */
export async function listPageOperators(): Promise<OperatorInfo[]> {
  const t = authTransport();
  const self = pageAuthEngineId();
  if (!t || !self) return [];
  return listOperators(t, self);
}

/** Add an operator on every Engine this page is signed in to (one hash for all). */
export async function addOperatorEverywhere(username: string, password: string, store: Store | null): Promise<EverywhereResult> {
  const t = authTransport();
  if (!t) return { ok: false, message: STILL_CONNECTING };
  const hash = await makePasswordHash(password);
  const failed: EngineIssue[] = [];
  for (const id of signedInEngineIds()) {
    try {
      await addOperator(t, id, username, hash);
    } catch (err) {
      failed.push(issueFor(store, id, err));
    }
  }
  const self = pageAuthEngineId();
  const own = failed.find((f) => f.engineId === self);
  return own ? { ok: false, message: own.message } : { ok: true, failed };
}

/** Remove the operator `username` on every Engine this page is signed in to. */
export async function removeOperatorEverywhere(username: string, store: Store | null): Promise<EverywhereResult> {
  const t = authTransport();
  if (!t) return { ok: false, message: STILL_CONNECTING };
  const failed: EngineIssue[] = [];
  for (const id of signedInEngineIds()) {
    try {
      const op = (await listOperators(t, id)).find((o) => o.username === username);
      if (op) await removeOperatorOn(t, id, op.id);
    } catch (err) {
      // Already gone on that Engine: nothing to do there.
      if (!(err instanceof EngineApiError && err.code === 'OPERATOR_UNKNOWN')) failed.push(issueFor(store, id, err));
    }
  }
  const self = pageAuthEngineId();
  const own = failed.find((f) => f.engineId === self);
  return own ? { ok: false, message: own.message } : { ok: true, failed };
}

/**
 * Change the signed-in operator's own password on every Engine this page is
 * signed in to. One new hash for all, so a later sign-in needs one bcrypt run.
 * Legacy mode: the userDB change, as before.
 */
export async function changeMyPassword(
  currentPassword: string,
  newPassword: string,
  store: Store | null,
  changeDoc: ((fn: (doc: Store) => void) => void) | null,
): Promise<EverywhereResult> {
  const user = currentUser();
  if (!user) return { ok: false, message: 'Sign in first.' };
  if (authMode() !== 'engine') {
    if (!store || !changeDoc) return { ok: false, message: STILL_CONNECTING };
    return (await changePassword(user.id, currentPassword, newPassword, store, changeDoc))
      ? { ok: true, failed: [] }
      : { ok: false, message: 'Current password is incorrect.' };
  }
  const t = authTransport();
  if (!t) return { ok: false, message: STILL_CONNECTING };
  const hash = await makePasswordHash(newPassword);
  const failed: EngineIssue[] = [];
  for (const id of signedInEngineIds()) {
    try {
      await changePasswordOn(t, id, user.username, currentPassword, hash);
    } catch (err) {
      failed.push(issueFor(store, id, err));
    }
  }
  const self = pageAuthEngineId();
  const own = failed.find((f) => f.engineId === self);
  if (own) return { ok: false, message: own.code === 'LOGIN_FAILED' ? 'Current password is incorrect.' : own.message };
  return { ok: true, failed };
}

/** For tests. */
export const resetEngineIssues = (): void => { setEngineIssues([]); };
