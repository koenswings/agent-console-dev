// @vitest-environment-options {"url":"http://idea02:8080/"}
import { describe, it, expect, vi } from 'vitest';
import { render } from '@solidjs/testing-library';
import InstanceRow from '../src/components/InstanceRow';
import type { Instance, App, Engine } from '../src/types/store';

// Simulate the Console served by the Engine in production web mode.
vi.mock('../src/store/engine', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/store/engine')>();
  return { ...mod, isProductionWebMode: () => true };
});

const makeEngine = (id: string, hostname: string): Engine => ({
  id, hostname, version: '1.0', hostOS: 'Linux',
  created: 0, lastBooted: 0, lastRun: 0, lastHalted: null, commands: [],
});

const instance: Instance = {
  id: 'inst-1', instanceOf: 'app-1', name: 'kolibri', status: 'Running', port: 8080,
  serviceImages: [], created: 0, lastBackup: null, lastStarted: 0, storedOn: 'disk-1',
  statusCondition: null, currentStep: null, totalSteps: null, stepLabel: null, metrics: null,
};

const app: App = {
  id: 'app-1', name: 'kolibri', version: '1.0', title: 'Kolibri', description: null,
  url: null, category: 'education', icon: null, author: null,
};

describe('InstanceRow Open link over a remote (non-.local) Console host', () => {
  it('uses the page host for the connected engine', () => {
    expect(window.location.hostname).toBe('idea02');
    const { container } = render(() => (
      <InstanceRow instance={() => instance} app={() => app} engine={() => makeEngine('e2', 'idea02')} />
    ));
    expect(container.querySelector('a.btn--open')).toHaveAttribute('href', 'http://idea02:8080');
  });

  it('keeps <hostname>.local for another engine', () => {
    const { container } = render(() => (
      <InstanceRow instance={() => instance} app={() => app} engine={() => makeEngine('e3', 'idea03')} />
    ));
    expect(container.querySelector('a.btn--open')).toHaveAttribute('href', 'http://idea03.local:8080');
  });
});
