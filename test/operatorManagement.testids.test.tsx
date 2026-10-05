/**
 * OperatorManagement must expose the same change-password testids as AccountScreen
 * (Prefer A walk stays on Manage Operators after add/remove — missing testid caused
 * change_password loud-fail with a misleading "must be logged in" message).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import OperatorManagement from '../src/components/OperatorManagement';
import type { Store, User } from '../src/types/store';
import type { StoreConnection } from '../src/mock/mockStore';
import { setAuthenticatedUser } from '../src/store/auth';

const admin: User = {
  id: 'user-admin',
  username: 'admin',
  passwordHash: 'x',
  role: 'operator',
  created: 1,
};
const other: User = {
  id: 'user-other',
  username: 'opwalk1',
  passwordHash: 'y',
  role: 'operator',
  created: 2,
};

const store: Store = {
  engineDB: {},
  diskDB: {},
  appDB: {},
  instanceDB: {},
  userDB: { [admin.id]: admin, [other.id]: other },
  operationDB: {},
};

const mockConnection = (): StoreConnection => {
  const [s] = createSignal<Store | null>(store);
  const [connected] = createSignal(true);
  const [commandLogStore] = createSignal({ traces: {}, recentTraceIds: [] as string[] });
  return {
    store: s,
    connected,
    sendCommand: vi.fn(),
    changeDoc: vi.fn(),
    commandLogStore,
    dispose: vi.fn(),
  };
};

describe('OperatorManagement testids (idea#168 Prefer A)', () => {
  beforeEach(() => {
    setAuthenticatedUser(admin);
  });
  afterEach(() => cleanup());

  it('exposes change-password-form + change-password on Change My Password', () => {
    const { container } = render(() => (
      <OperatorManagement store={store} connection={mockConnection()} />
    ));
    expect(container.querySelector('[data-testid="operator-management"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="change-password-form"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="change-password"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="change-password-current"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="change-password-new"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="change-password-confirm"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="remove-operator-user-admin"]')).toBeDisabled();
    expect(container.querySelector('[data-testid="remove-operator-user-other"]')).not.toBeDisabled();
    expect(
      container.querySelector('[data-testid="operator-row-user-other"]')?.getAttribute('data-username'),
    ).toBe('opwalk1');
  });
});
