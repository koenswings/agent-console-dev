/**
 * LoginForm tests
 *
 * Key regression: Solid reactive disposal order.
 * When login succeeds, setAuthenticatedUser() flips isOperator() → the outer
 * <Show when={isOperator()}> in App destroys LoginForm's reactive root.
 * If setAuthenticatedUser is called before setLoading(false), the finally
 * block writes into a disposed signal (silent no-op) and the button stays
 * on "Verifying…" forever. This test suite catches that regression.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import LoginForm from '../components/LoginForm';
import type { Store, User } from '../types/store';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockBcryptCompare = vi.fn<[string, string], Promise<boolean>>();
vi.mock('../store/bcryptCompare', () => ({
  bcryptCompare: (...args: [string, string]) => mockBcryptCompare(...args),
}));

// LoginForm no longer calls setAuthenticatedUser directly — it hands the
// verified user to the parent via onSuccess(user). No auth mock needed.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeUser = (): User => ({
  id: 'user-001',
  username: 'admin',
  passwordHash: '$2b$12$hashedpassword',
  role: 'operator',
  created: Date.now(),
});

const makeStore = (users: User[] = [makeUser()]): Store => ({
  engineDB: {},
  diskDB: {},
  instanceDB: {},
  operationDB: {},
  userDB: Object.fromEntries(users.map((u) => [u.id, u])),
  appDB: {},
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the login form', () => {
    render(() => (
      <LoginForm
        store={makeStore()}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />
    ));
    expect(screen.getByLabelText(/username/i)).toBeTruthy();
    expect(screen.getByLabelText(/password/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /log in/i })).toBeTruthy();
  });

  it('shows "Verifying…" while bcrypt runs', async () => {
    // bcrypt never resolves during this test
    let resolveBcrypt!: (v: boolean) => void;
    mockBcryptCompare.mockReturnValue(new Promise((r) => { resolveBcrypt = r; }));

    render(() => (
      <LoginForm
        store={makeStore()}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />
    ));

    fireEvent.input(screen.getByLabelText(/username/i), { target: { value: 'admin' } });
    fireEvent.input(screen.getByLabelText(/password/i), { target: { value: 'admin911!' } });
    fireEvent.submit(screen.getByRole('button', { name: /log in/i }).closest('form')!);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /verifying/i })).toBeTruthy()
    );

    // Clean up
    resolveBcrypt(false);
  });

  it('shows error on wrong password and button returns to "Log in"', async () => {
    mockBcryptCompare.mockResolvedValue(false);

    render(() => (
      <LoginForm
        store={makeStore()}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />
    ));

    fireEvent.input(screen.getByLabelText(/username/i), { target: { value: 'admin' } });
    fireEvent.input(screen.getByLabelText(/password/i), { target: { value: 'wrongpass' } });
    fireEvent.submit(screen.getByRole('button', { name: /log in/i }).closest('form')!);

    await waitFor(() =>
      expect(screen.getByText(/invalid username or password/i)).toBeTruthy()
    );

    // Button must NOT be stuck on "Verifying…"
    expect(screen.getByRole('button', { name: /log in/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /verifying/i })).toBeNull();
  });

  it('calls onSuccess with the verified User on correct password', async () => {
    mockBcryptCompare.mockResolvedValue(true);
    const onSuccess = vi.fn<[User], void>();

    render(() => (
      <LoginForm
        store={makeStore()}
        onSuccess={onSuccess}
        onCancel={vi.fn()}
      />
    ));

    fireEvent.input(screen.getByLabelText(/username/i), { target: { value: 'admin' } });
    fireEvent.input(screen.getByLabelText(/password/i), { target: { value: 'admin911!' } });
    fireEvent.submit(screen.getByRole('button', { name: /log in/i }).closest('form')!);

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    // Parent receives the user and handles setAuthenticatedUser + setShowLogin
    expect(onSuccess.mock.calls[0][0].username).toBe('admin');
  });

  /**
   * REGRESSION TEST — Solid disposal order bug.
   *
   * LoginForm must NOT call setAuthenticatedUser (a global signal write)
   * internally. If it did, isOperator() would flip synchronously, destroying
   * this component's reactive root before the finally block can run
   * setLoading(false) — leaving the button stuck on "Verifying…".
   *
   * The contract: LoginForm hands the verified user to onSuccess(user).
   * The parent (App) calls setAuthenticatedUser + setShowLogin inside batch().
   */
  it('REGRESSION: LoginForm does not call setAuthenticatedUser — passes user to onSuccess instead', async () => {
    mockBcryptCompare.mockResolvedValue(true);
    const onSuccess = vi.fn<[User], void>();

    render(() => (
      <LoginForm
        store={makeStore()}
        onSuccess={onSuccess}
        onCancel={vi.fn()}
      />
    ));

    fireEvent.input(screen.getByLabelText(/username/i), { target: { value: 'admin' } });
    fireEvent.input(screen.getByLabelText(/password/i), { target: { value: 'admin911!' } });
    fireEvent.submit(screen.getByRole('button', { name: /log in/i }).closest('form')!);

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());

    // onSuccess receives the user object — parent owns the signal writes
    const receivedUser = onSuccess.mock.calls[0][0];
    expect(receivedUser).toBeDefined();
    expect(receivedUser.username).toBe('admin');
  });

  it('shows error on unknown username', async () => {
    render(() => (
      <LoginForm
        store={makeStore()}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />
    ));

    fireEvent.input(screen.getByLabelText(/username/i), { target: { value: 'nobody' } });
    fireEvent.input(screen.getByLabelText(/password/i), { target: { value: 'anything' } });
    fireEvent.submit(screen.getByRole('button', { name: /log in/i }).closest('form')!);

    await waitFor(() =>
      expect(screen.getByText(/invalid username or password/i)).toBeTruthy()
    );

    expect(mockBcryptCompare).not.toHaveBeenCalled();
  });

  it('disables submit when store is null', () => {
    render(() => (
      <LoginForm
        store={null}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />
    ));

    const btn = screen.getByRole('button', { name: /connecting/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});
