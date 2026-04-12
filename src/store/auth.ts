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
  const session: OperatorSession = { userId: user.id, username: user.username };
  try {
    await chrome.storage.local.set({ [SESSION_KEY]: session });
  } catch {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
}

async function clearPersistedSession(): Promise<void> {
  try {
    await chrome.storage.local.remove(SESSION_KEY);
  } catch {
    localStorage.removeItem(SESSION_KEY);
  }
}

async function readPersistedSession(): Promise<OperatorSession | null> {
  try {
    const result = await chrome.storage.local.get(SESSION_KEY);
    if (result[SESSION_KEY]) return result[SESSION_KEY] as OperatorSession;
  } catch {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      try {
        return JSON.parse(raw) as OperatorSession;
      } catch {
        return null;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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

  // Use callback form — bcryptjs yields between rounds with setImmediate,
  // keeping the UI thread responsive during the ~1s hash comparison.
  const match = await new Promise<boolean>((resolve) => {
    bcrypt.compare(password, user.passwordHash, (_err, result) => resolve(!!result));
  });
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

  const passwordHash = await new Promise<string>((resolve, reject) => {
    bcrypt.hash(password, 12, (err, hash) => err ? reject(err) : resolve(hash));
  });
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

  const match = await new Promise<boolean>((resolve) => {
    bcrypt.compare(currentPassword, user.passwordHash, (_err, result) => resolve(!!result));
  });
  if (!match) return false;

  const newHash = await new Promise<string>((resolve, reject) => {
    bcrypt.hash(newPassword, 12, (err, hash) => err ? reject(err) : resolve(hash));
  });
  changeDoc((doc) => {
    if (doc.userDB[userId]) {
      doc.userDB[userId].passwordHash = newHash;
    }
  });
  return true;
}
