/**
 * idea#166 — teacher/learner overview and catalog cards are id-keyed.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import AppBrowser from '../src/components/AppBrowser';
import { MOCK_FILES_STORE, FILES_IDS as I } from '../src/mock/filesFixtures';
import type { Store } from '../src/types/store';

afterEach(() => cleanup());

describe('AppBrowser data-testid (idea#166)', () => {
  it('exposes console-overview and instance-<id> cards', () => {
    const [store] = createSignal<Store | null>(MOCK_FILES_STORE);
    const { container } = render(() => <AppBrowser store={store} connected={() => true} />);
    expect(container.querySelector('[data-testid="console-overview"]')).not.toBeNull();
    expect(container.querySelector(`[data-testid="instance-${I.INST_NC_A}"]`)).not.toBeNull();
  });
});
