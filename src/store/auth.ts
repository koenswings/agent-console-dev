/**
 * Client-side authentication and operator management.
 *
 * All operations are local — no API calls. Credentials are stored in the
 * Automerge Store (userDB) and compared/written using bcryptjs in the browser.
 * The operator session is held in memory for the current page only.
 *
 * Auth state is held in a module-level Solid.js signal, reactive across all
 * components that import it.
 */
import { createSignal } from 'solid-js';
import bcrypt from 'bcryptjs';
import { bcryptCompare } from './bcryptCompare';
import type { User, UserID, Store } from '../types/store';
import { IS_EXTENSION } from './context';

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
