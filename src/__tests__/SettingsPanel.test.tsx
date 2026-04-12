import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import SettingsPanel from '../components/SettingsPanel';
import type { Store, User } from '../types/store';
import type { StoreConnection } from '../mock/mockStore';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../store/auth', () => ({
  isOperator: vi.fn(() => false),
  currentUser: vi.fn(() => null),
  changePassword: vi.fn(() => Promise.resolve(true)),
}));

// Stub Onboarding to avoid chrome.storage calls
vi.mock('../components/Onboarding', () => ({
  default: () => <div data-testid="onboarding-stub" />,
}));

// Prevent real network probes in tests
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no fetch in tests'))));

import { isOperator, currentUser, changePassword } from '../store/auth';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeStore = (users: User[] = []): Store => ({
  engineDB: {},
  diskDB: {},
  appDB: {},
  instanceDB: {},
  userDB: Object.fromEntries(users.map((u) => [u.id, u])),
  operationDB: {},
});

const makeConnection = (): StoreConnection => ({
  store: () => makeStore(),
  connected: () => true,
  sendCommand: vi.fn(),
  changeDoc: vi.fn((fn) => fn(makeStore())),
});

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-001',
  username: 'admin',
  passwordHash: '$2b$12$hashed',
  role: 'operator',
  created: Date.now(),
  ...overrides,
});

const defaultProps = () => ({
  store: makeStore(),
  connection: makeConnection(),
  hostname: 'appdocker01.local',
  demo: false,
  discovering: false,
  discoveryResults: [],
  onDiscoverySelect: vi.fn(),
  onRescan: vi.fn(),
  onClose: vi.fn(),
  onComplete: vi.fn(),
  onReconnect: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isOperator).mockReturnValue(false);
  vi.mocked(currentUser).mockReturnValue(null);
  vi.mocked(changePassword).mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsPanel', () => {
  it('renders Engine Connection and About tabs in sidebar', () => {
    render(() => <SettingsPanel {...defaultProps()} />);
    const sidebar = document.querySelector('.settings-panel__sidebar')!;
    expect(sidebar.textContent).toContain('Engine Connection');
    expect(sidebar.textContent).toContain('About');
  });

  it('renders three tabs when operator (Engine, Account, About)', () => {
    vi.mocked(isOperator).mockReturnValue(true);
    render(() => <SettingsPanel {...defaultProps()} />);
    const sidebar = document.querySelector('.settings-panel__sidebar')!;
    expect(sidebar.textContent).toContain('Engine Connection');
    expect(sidebar.textContent).toContain('Account');
    expect(sidebar.textContent).toContain('About');
  });

  it('Account tab is hidden when not operator', () => {
    vi.mocked(isOperator).mockReturnValue(false);
    render(() => <SettingsPanel {...defaultProps()} />);
    const sidebar = document.querySelector('.settings-panel__sidebar')!;
    expect(sidebar.textContent).not.toContain('Account');
  });

  it('shows About section content when About tab clicked', () => {
    render(() => <SettingsPanel {...defaultProps()} />);
    fireEvent.click(screen.getByText('About'));
    expect(screen.getByText('IDEA Console')).toBeInTheDocument();
    expect(screen.getByText('Offline web app management for schools')).toBeInTheDocument();
    expect(screen.getByText('Version 0.1.0')).toBeInTheDocument();
  });

  it('shows connected hostname label in engine connection section', () => {
    render(() => <SettingsPanel {...defaultProps()} hostname="appdocker01.local" demo={false} />);
    expect(screen.getByText(/Connected to/)).toBeInTheDocument();
  });

  it('shows demo mode label when demo is true', () => {
    render(() => <SettingsPanel {...defaultProps()} demo={true} hostname="" />);
    expect(screen.getByText(/Demo mode/)).toBeInTheDocument();
  });

  it('shows not connected label when no hostname and not demo', () => {
    render(() => <SettingsPanel {...defaultProps()} demo={false} hostname="" />);
    expect(screen.getByText('Not connected')).toBeInTheDocument();
  });

  it('does not show other engines list when discoveryResults only contains current hostname', () => {
    render(() => (
      <SettingsPanel
        {...defaultProps()}
        hostname="appdocker01.local"
        discoveryResults={[{ hostname: 'appdocker01.local', storeUrl: 'automerge:abc' }]}
      />
    ));
    expect(screen.queryByText('Other engines on the network:')).not.toBeInTheDocument();
  });

  it('shows other engines list when there are different engines in discoveryResults', () => {
    render(() => (
      <SettingsPanel
        {...defaultProps()}
        hostname="appdocker01.local"
        discoveryResults={[
          { hostname: 'appdocker01.local', storeUrl: 'automerge:abc' },
          { hostname: 'appdocker02.local', storeUrl: 'automerge:def' },
        ]}
      />
    ));
    expect(screen.getByText('Other engines on the network:')).toBeInTheDocument();
    expect(screen.getByText('appdocker02.local')).toBeInTheDocument();
  });

  it('shows current hostname in the connected label', () => {
    render(() => <SettingsPanel {...defaultProps()} hostname="appdocker01.local" demo={false} />);
    expect(screen.getByText('appdocker01.local')).toBeInTheDocument();
  });

  it('calls changePassword with correct args on submit', async () => {
    const user = makeUser();
    vi.mocked(isOperator).mockReturnValue(true);
    vi.mocked(currentUser).mockReturnValue(user);
    vi.mocked(changePassword).mockResolvedValue(true);

    const store = makeStore([user]);
    const connection = makeConnection();

    render(() => (
      <SettingsPanel
        {...defaultProps()}
        store={store}
        connection={connection}
      />
    ));

    // Navigate to Account tab
    fireEvent.click(screen.getByText('Account'));

    // Use querySelectorAll to get password inputs by type
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    fireEvent.input(passwordInputs[0], { target: { value: 'oldpass123' } });
    fireEvent.input(passwordInputs[1], { target: { value: 'newpass456' } });
    fireEvent.input(passwordInputs[2], { target: { value: 'newpass456' } });

    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => {
      expect(changePassword).toHaveBeenCalledWith(
        user.id,
        'oldpass123',
        'newpass456',
        store,
        connection.changeDoc,
      );
    });
  });

  it('shows success message after successful password change', async () => {
    const user = makeUser();
    vi.mocked(isOperator).mockReturnValue(true);
    vi.mocked(currentUser).mockReturnValue(user);
    vi.mocked(changePassword).mockResolvedValue(true);

    render(() => <SettingsPanel {...defaultProps()} store={makeStore([user])} />);
    fireEvent.click(screen.getByText('Account'));

    const passwordInputs = document.querySelectorAll('input[type="password"]');
    fireEvent.input(passwordInputs[0], { target: { value: 'oldpass123' } });
    fireEvent.input(passwordInputs[1], { target: { value: 'newpass456' } });
    fireEvent.input(passwordInputs[2], { target: { value: 'newpass456' } });

    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => {
      expect(screen.getByText('Password changed.')).toBeInTheDocument();
    });
  });

  it('shows error message when current password is wrong', async () => {
    const user = makeUser();
    vi.mocked(isOperator).mockReturnValue(true);
    vi.mocked(currentUser).mockReturnValue(user);
    vi.mocked(changePassword).mockResolvedValue(false);

    render(() => <SettingsPanel {...defaultProps()} store={makeStore([user])} />);
    fireEvent.click(screen.getByText('Account'));

    const passwordInputs = document.querySelectorAll('input[type="password"]');
    fireEvent.input(passwordInputs[0], { target: { value: 'wrongpass' } });
    fireEvent.input(passwordInputs[1], { target: { value: 'newpass456' } });
    fireEvent.input(passwordInputs[2], { target: { value: 'newpass456' } });

    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => {
      expect(screen.getByText('Current password is incorrect.')).toBeInTheDocument();
    });
  });

  it('shows error when passwords do not match', async () => {
    vi.mocked(isOperator).mockReturnValue(true);
    vi.mocked(currentUser).mockReturnValue(makeUser());

    render(() => <SettingsPanel {...defaultProps()} />);
    fireEvent.click(screen.getByText('Account'));

    const passwordInputs = document.querySelectorAll('input[type="password"]');
    fireEvent.input(passwordInputs[0], { target: { value: 'oldpass123' } });
    fireEvent.input(passwordInputs[1], { target: { value: 'newpass456' } });
    fireEvent.input(passwordInputs[2], { target: { value: 'different789' } });

    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    });
    expect(changePassword).not.toHaveBeenCalled();
  });
});
