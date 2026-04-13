/**
 * Tests for src/store/auth.ts
 *
 * bcryptjs is mocked to avoid slow hashing in tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock bcryptjs and bcryptCompare to avoid slow hashing in tests
vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(),
    compareSync: vi.fn(),
    hash: vi.fn(),
  },
}));

vi.mock('../store/bcryptCompare', () => ({
  bcryptCompare: vi.fn(),
}));

import bcrypt from 'bcryptjs';
import { bcryptCompare } from '../store/bcryptCompare';
import {
  login,
  logout,
  restoreSession,
  createOperator,
  removeOperator,
  changePassword,
  isFirstTimeSetup,
  currentUser,
} from '../store/auth';
import type { Store, User } from '../types/store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-001',
  username: 'admin',
  passwordHash: '$2b$12$hashedpassword',
  role: 'operator',
  created: Date.now(),
  ...overrides,
});

const makeStore = (users: User[] = []): Store => ({
  engineDB: {},
  diskDB: {},
  appDB: {},
  instanceDB: {},
  userDB: Object.fromEntries(users.map((u) => [u.id, u])),
});

const makeChangeDoc = () => {
  let doc: Store = makeStore();
  const changeDoc = vi.fn((fn: (d: Store) => void) => {
    fn(doc);
  });
  const getDoc = () => doc;
  const setDoc = (d: Store) => { doc = d; };
  return { changeDoc, getDoc, setDoc };
};

beforeEach(async () => {
  vi.clearAllMocks();
  // Ensure we start logged out
  await logout();
});

// ---------------------------------------------------------------------------
// isFirstTimeSetup
// ---------------------------------------------------------------------------

describe('isFirstTimeSetup', () => {
  it('returns true when userDB is empty', () => {
    expect(isFirstTimeSetup(makeStore())).toBe(true);
  });

  it('returns false when there are operators', () => {
    expect(isFirstTimeSetup(makeStore([makeUser()]))).toBe(false);
  });

  it('returns false for null store', () => {
    expect(isFirstTimeSetup(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

describe('login', () => {
  it('succeeds with correct credentials', async () => {
    vi.mocked(bcryptCompare).mockResolvedValue(true as never);
    const store = makeStore([makeUser()]);

    const result = await login('admin', 'correct', store);

    expect(result).toBe(true);
    expect(currentUser()?.username).toBe('admin');
  });

  it('fails with wrong password', async () => {
    vi.mocked(bcryptCompare).mockResolvedValue(false as never);
    const store = makeStore([makeUser()]);

    const result = await login('admin', 'wrong', store);

    expect(result).toBe(false);
    expect(currentUser()).toBeNull();
  });

  it('fails with unknown username', async () => {
    const store = makeStore([makeUser()]);

    const result = await login('nobody', 'anything', store);

    expect(result).toBe(false);
    expect(bcryptCompare).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------

describe('logout', () => {
  it('clears currentUser', async () => {
    vi.mocked(bcryptCompare).mockResolvedValue(true as never);
    const store = makeStore([makeUser()]);
    await login('admin', 'correct', store);
    expect(currentUser()).not.toBeNull();

    await logout();

    expect(currentUser()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// restoreSession
// ---------------------------------------------------------------------------

describe('restoreSession', () => {
  it('does nothing when no session is persisted', async () => {
    const store = makeStore([makeUser()]);
    await restoreSession(store);
    expect(currentUser()).toBeNull();
  });

  it('does nothing for null store', async () => {
    await restoreSession(null);
    expect(currentUser()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createOperator
// ---------------------------------------------------------------------------

describe('createOperator', () => {
  it('creates a new operator and writes to store', async () => {
    vi.mocked(bcrypt.hash).mockResolvedValue('$hashed' as never);
    const store = makeStore();
    const { changeDoc, getDoc } = makeChangeDoc();
    getDoc().userDB = {}; // ensure the doc has a userDB

    const user = await createOperator('newop', 'password123', store, changeDoc);

    expect(user.username).toBe('newop');
    expect(user.role).toBe('operator');
    expect(user.passwordHash).toBe('$hashed');
    expect(changeDoc).toHaveBeenCalledOnce();
  });

  it('throws if username already taken', async () => {
    const store = makeStore([makeUser({ username: 'admin' })]);
    const { changeDoc } = makeChangeDoc();

    await expect(
      createOperator('admin', 'password', store, changeDoc)
    ).rejects.toThrow('already taken');
  });
});

// ---------------------------------------------------------------------------
// removeOperator
// ---------------------------------------------------------------------------

describe('removeOperator', () => {
  it('removes operator from store via changeDoc', () => {
    const store = makeStore([makeUser()]);
    let capturedFn: ((doc: Store) => void) | null = null;
    const changeDoc = vi.fn((fn: (doc: Store) => void) => {
      capturedFn = fn;
    });

    removeOperator('user-001', changeDoc);

    expect(changeDoc).toHaveBeenCalledOnce();
    // Apply the captured mutation to a copy of the store
    const copy = { ...store, userDB: { ...store.userDB } };
    capturedFn!(copy);
    expect(copy.userDB['user-001']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// changePassword
// ---------------------------------------------------------------------------

describe('changePassword', () => {
  it('changes password when current password is correct', async () => {
    vi.mocked(bcryptCompare).mockResolvedValue(true as never);
    vi.mocked(bcrypt.hash).mockResolvedValue('$newhash' as never);
    const store = makeStore([makeUser()]);
    const { changeDoc } = makeChangeDoc();

    const result = await changePassword('user-001', 'oldpw', 'newpw', store, changeDoc);

    expect(result).toBe(true);
    expect(changeDoc).toHaveBeenCalledOnce();
  });

  it('returns false when current password is wrong', async () => {
    vi.mocked(bcryptCompare).mockResolvedValue(false as never);
    const store = makeStore([makeUser()]);
    const { changeDoc } = makeChangeDoc();

    const result = await changePassword('user-001', 'wrong', 'newpw', store, changeDoc);

    expect(result).toBe(false);
    expect(changeDoc).not.toHaveBeenCalled();
  });

  it('returns false for unknown userId', async () => {
    const store = makeStore();
    const { changeDoc } = makeChangeDoc();

    const result = await changePassword('nobody', 'old', 'new', store, changeDoc);

    expect(result).toBe(false);
  });
});
