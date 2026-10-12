// @vitest-environment-options {"url":"http://idea02:8080/"}
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@solidjs/testing-library';
import InstanceRow from '../src/components/InstanceRow';
import AppBrowser from '../src/components/AppBrowser';
import type { Instance, App, Engine, Store } from '../src/types/store';

// Simulate the Console served by the Engine in production web mode.
vi.mock('../src/store/engine', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/store/engine')>();
  return { ...mod, isProductionWebMode: () => true };
});

const makeEngine = (id: string, hostname: string, lanAddress?: string | null): Engine => ({
  id, hostname, version: '1.0', hostOS: 'Linux',
  created: 0, lastBooted: 0, lastRun: 0, lastHalted: null, commands: [],
  ...(lanAddress !== undefined ? { lanAddress } : {}),
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

describe('Open link uses the LAN IP from the store (learner devices without mDNS)', () => {
  it('InstanceRow: another engine with lanAddress → its IP, not .local', () => {
    const { container } = render(() => (
      <InstanceRow instance={() => instance} app={() => app} engine={() => makeEngine('e3', 'idea03', '192.0.2.13')} />
    ));
    expect(container.querySelector('a.btn--open')).toHaveAttribute('href', 'http://192.0.2.13:8080');
  });

  it('InstanceRow: same Pi keeps the Console page host even with lanAddress', () => {
    const { container } = render(() => (
      <InstanceRow instance={() => instance} app={() => app} engine={() => makeEngine('e2', 'idea02', '192.0.2.12')} />
    ));
    expect(container.querySelector('a.btn--open')).toHaveAttribute('href', 'http://idea02:8080');
  });

  it('InstanceRow: lanAddress null → .local fallback', () => {
    const { container } = render(() => (
      <InstanceRow instance={() => instance} app={() => app} engine={() => makeEngine('e3', 'idea03', null)} />
    ));
    expect(container.querySelector('a.btn--open')).toHaveAttribute('href', 'http://idea03.local:8080');
  });

  it('AppBrowser (learner overview) AppCard Open: another engine → its LAN IP', () => {
    const store = {
      engineDB: { e3: makeEngine('e3', 'idea03', '192.0.2.13'), e2: makeEngine('e2', 'idea02') },
      diskDB: { 'disk-1': { id: 'disk-1', name: 'd', device: 'sda', created: 0, lastDocked: 0, dockedTo: 'e3', diskTypes: ['app'], backupConfig: null } },
      appDB: { 'app-1': app },
      instanceDB: { 'inst-1': instance },
      userDB: {},
      operationDB: {},
    } as unknown as Store;
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { getByTestId } = render(() => <AppBrowser store={() => store} connected={() => true} />);
    fireEvent.click(getByTestId('instance-inst-1'));
    const btn = document.querySelector('[data-testid="instance-inst-1"] button') as HTMLElement | null;
    if (!open.mock.calls.length && btn) fireEvent.click(btn);
    expect(open).toHaveBeenCalled();
    expect(open.mock.calls[0][0]).toBe('http://192.0.2.13:8080');
    open.mockRestore();
  });
});
