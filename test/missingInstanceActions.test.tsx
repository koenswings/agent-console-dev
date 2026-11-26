import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@solidjs/testing-library';
import MobileAppList from '../src/components/MobileAppList';
import { MOCK_IDS, MOCK_STORE } from '../src/mock/mockStore';
import type { Instance, Store } from '../src/types/store';

afterEach(() => cleanup());

const missingStore = (): Store => {
  const inst: Instance = { ...MOCK_STORE.instanceDB[MOCK_IDS.INST_KOLIBRI_ID], status: 'Missing', storedOn: null };
  return {
    ...MOCK_STORE,
    instanceDB: { ...MOCK_STORE.instanceDB, [inst.id]: inst },
  };
};

describe('MobileAppList Missing actions', () => {
  it('does not offer an enabled Start or Stop button for a Missing app', () => {
    render(() => <MobileAppList store={missingStore} />);
    const card = screen.getByText('kolibri').closest('.mobile-app-card') as HTMLElement;
    expect(card).toBeTruthy();
    const start = card.querySelectorAll('.btn--start');
    const stop = card.querySelectorAll('.btn--stop');
    expect([...start, ...stop].every((btn) => (btn as HTMLButtonElement).disabled)).toBe(true);
  });
});
