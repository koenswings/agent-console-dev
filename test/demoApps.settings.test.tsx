/** Settings → Demo apps is operators only (Koen, idea#235, 10:15) and capability-gated (engine#369 §1). */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import SettingsPanel from '../src/components/SettingsPanel';
import type { Engine, Store } from '../src/types/store';

vi.mock('../src/store/auth', () => ({
  isOperator: vi.fn(() => false),
  currentUser: vi.fn(() => null),
  changePassword: vi.fn(() => Promise.resolve(true)),
}));
vi.mock('../src/store/storage', () => ({
  csGet: vi.fn(() => Promise.resolve({})),
  csSet: vi.fn(() => Promise.resolve()),
  STORAGE_KEY_MODE: 'displayMode',
  STORAGE_KEY_PREVIEW: 'previewMode',
}));
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no fetch in tests'))));

import { isOperator } from '../src/store/auth';

const T = 1_700_000_000_000;
const store = (caps: string[]): Store => ({
  engineDB: { E1: { id: 'E1', hostname: 'idea04', version: '1', hostOS: 'Linux', created: T, lastBooted: T, lastRun: T, lastHalted: null, commands: [], capabilities: caps, capabilitiesBootedAt: T } as Engine },
  diskDB: {}, appDB: {}, instanceDB: {}, userDB: {}, operationDB: {},
});
const panel = (s: Store) => render(() => (
  <SettingsPanel store={s} connection={null} hostname="idea04.local" preview={false}
    onClose={() => {}} onComplete={() => {}} onConnect={() => {}} onPreviewMode={() => {}} />
));

afterEach(() => cleanup());

describe('Settings → Demo apps tab', () => {
  it('is hidden for a non-operator, even with the capability', () => {
    vi.mocked(isOperator).mockReturnValue(false);
    expect(panel(store(['demoApps'])).queryByTestId('settings-tab-demo')).toBeNull();
  });
  it('is hidden for an operator when no Engine has demoApps', () => {
    vi.mocked(isOperator).mockReturnValue(true);
    expect(panel(store(['removeInstance'])).queryByTestId('settings-tab-demo')).toBeNull();
  });
  it('shows for an operator when an Engine has a fresh demoApps', () => {
    vi.mocked(isOperator).mockReturnValue(true);
    const r = panel(store(['demoApps']));
    r.getByTestId('settings-tab-demo').click();
    expect(r.getByTestId('demo-apps-section')).toBeTruthy();
  });
});
