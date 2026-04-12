/**
 * Client-side authentication and operator management.
 *
 * All operations are local — no API calls. Credentials are stored in the
 * Automerge Store (userDB) and compared/written using bcryptjs in the browser.
 *
 * Auth state is held in a module-level Solid.js signal, reactive across all
 * components that import it.
 */
import { createSignal } from 'solid-js';
import bcrypt from 'bcryptjs';
import type { User, UserID, Store } from '../types/store';

async function chromeStorageSet(data: object): Promise<boolean> {
  try {
    await Promise.race([
      chrome.storage.local.set(data),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 200)),
    ]);
    return true;
  } catch { return false; }
}

async function chromeStorageGet(key: string): Promise<Record<string, unknown> | null> {
  try {
    return await Promise.race([
      chrome.storage.local.get(key),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 200)),
    ]) as Record<string, unknown>;
  } catch { return null; }
}

async function chromeStorageRemove(key: string): Promise<void> {
  try {
    await Promise.race([
      chrome.storage.local.remove(key),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 200)),
    ]);
  } catch {}
}

// chrome.runtime.id is only set in real extension contexts.
// chrome.storage.local exists in regular Chrome tabs too but its calls hang.
const hasChromeStorage = () =>
  typeof chrome !== 'undefined' && !!chrome.runtime?.id;

// ---------------------------------------------------------------------------
// Auth state signals
// ---------------------------------------------------------------------------

const [currentUser, setCurrentUser] = createSignal<User | null>(null);

export { currentUser };
export const isOperator = () => currentUser() !== null;

export const isFirstTimeSetup = (store: Store | null): boolean => {
  if (!store) return false;
  return Object.keys(store.userDB ?? {}).length === 0;
};

// ---------------------------------------------------------------------------
// Persistent session storage
// ---------------------------------------------------------------------------

const SESSION_KEY = 'operatorSession';

interface OperatorSession {
  userId: UserID;
  username: string;
}

async function persistSession(user: User): Promise<void> {
  // Coerce Automerge ImmutableString proxies to plain strings before serialising
  const session: OperatorSession = { userId: String(user.id), username: String(user.username) };
  if (hasChromeStorage()) {
    const ok = await chromeStorageSet({ [SESSION_KEY]: session });
    if (ok) return;
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

async function clearPersistedSession(): Promise<void> {
  if (hasChromeStorage()) await chromeStorageRemove(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
}

async function readPersistedSession(): Promise<OperatorSession | null> {
  if (hasChromeStorage()) {
    const result = await chromeStorageGet(SESSION_KEY);
    if (result?.[SESSION_KEY]) return result[SESSION_KEY] as OperatorSession;
  }
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as OperatorSession; } catch { return null; }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Set the current user directly (after external verification) and persist session.
 * Use this when you've already verified the password to avoid running bcrypt twice.
 */
export async function setAuthenticatedUser(user: User): Promise<void> {
  setCurrentUser(user);
  await persistSession(user);
}

/**
 * Attempt login. Returns true on success, false on bad credentials.
 * On success, sets the currentUser signal and persists the session.
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
  const hash = String(user.passwordHash);
  const match = await Promise.race([
    bcrypt.compare(password, hash),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('bcrypt timed out')), 8000)
    ),
  ]);
  if (!match) return false;

  setCurrentUser(user);
  await persistSession(user);
  return true;
}

/**
 * Log out the current operator. Clears the signal and stored session.
 */
export async function logout(): Promise<void> {
  setCurrentUser(null);
  await clearPersistedSession();
}

/**
 * Restore a previously persisted session on page load.
 * Cross-checks the stored userId against the current userDB.
 * Clears the session silently if the operator no longer exists.
 */
export async function restoreSession(store: Store | null): Promise<void> {
  if (!store) return;
  const session = await readPersistedSession();
  if (!session) return;

  const user = (store.userDB ?? {})[session.userId];
  if (user) {
    setCurrentUser(user);
  } else {
    await clearPersistedSession();
  }
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

  const match = await bcrypt.compare(currentPassword, String(user.passwordHash));
  if (!match) return false;

  const newHash = await bcrypt.hash(newPassword, 10);
  changeDoc((doc) => {
    if (doc.userDB[userId]) {
      doc.userDB[userId].passwordHash = newHash;
    }
  });
  return true;
}
