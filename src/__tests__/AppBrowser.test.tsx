import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import AppBrowser from '../components/AppBrowser';
import type { Store } from '../types/store';

const makeStore = (): Store => ({
  engineDB: {
    'eng-1': {
      id: 'eng-1',
      hostname: 'appdocker01',
      version: '1.0',
      hostOS: 'Linux',
      created: 0,
      lastBooted: 0,
      lastRun: Date.now(),
      lastHalted: null,
      commands: [],
    },
  },
  diskDB: {
    'disk-1': {
      id: 'disk-1',
      name: 'disk-one',
      device: 'sda',
      created: 0,
      lastDocked: 0,
      dockedTo: 'eng-1',
    },
  },
  appDB: {
    'app-1': {
      id: 'app-1',
      name: 'kolibri',
      version: '1.0',
      title: 'Kolibri',
      description: 'Learning platform',
      url: null,
      category: 'education',
      icon: null,
      author: null,
    },
    'app-2': {
      id: 'app-2',
      name: 'nextcloud',
      version: '1.0',
      title: 'Nextcloud',
      description: 'File sharing',
      url: null,
      category: 'office',
      icon: null,
      author: null,
    },
  },
  instanceDB: {
    'inst-1': {
      id: 'inst-1',
      instanceOf: 'app-1',
      name: 'kolibri',
      status: 'Running',
      port: 8080,
      serviceImages: [],
      created: 0,
      lastBackedUp: 0,
      lastStarted: 0,
      storedOn: 'disk-1',
    },
    'inst-2': {
      id: 'inst-2',
      instanceOf: 'app-2',
      name: 'nextcloud',
      status: 'Stopped',
      port: 8081,
      serviceImages: [],
      created: 0,
      lastBackedUp: 0,
      lastStarted: 0,
      storedOn: 'disk-1',
    },
  },
  userDB: {},
});

describe('AppBrowser', () => {
  it('renders app cards for running instances only (Kolibri running, Nextcloud stopped)', () => {
    render(() => <AppBrowser store={() => makeStore()} onLogin={vi.fn()} />);
    expect(screen.getByText('Kolibri')).toBeInTheDocument();
    // Nextcloud is Stopped — filtered out in user mode
    expect(screen.queryByText('Nextcloud')).not.toBeInTheDocument();
  });

  it('shows Open button for running instance', () => {
    render(() => <AppBrowser store={() => makeStore()} onLogin={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
  });

  it('shows empty message when store is null', () => {
    render(() => <AppBrowser store={() => null} onLogin={vi.fn()} />);
    expect(screen.getByText(/No apps available/)).toBeInTheDocument();
  });

  it('shows empty message when instanceDB is empty', () => {
    const store = makeStore();
    store.instanceDB = {};
    render(() => <AppBrowser store={() => store} onLogin={vi.fn()} />);
    expect(screen.getByText(/No apps available/)).toBeInTheDocument();
  });

  it('shows empty message when no instances are Running', () => {
    const store = makeStore();
    store.instanceDB['inst-1'].status = 'Stopped';
    render(() => <AppBrowser store={() => store} onLogin={vi.fn()} />);
    expect(screen.getByText(/No apps available/)).toBeInTheDocument();
  });

  it('calls onLogin when Log in button is clicked', () => {
    const onLogin = vi.fn();
    render(() => <AppBrowser store={() => makeStore()} onLogin={onLogin} />);
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(onLogin).toHaveBeenCalledOnce();
  });

  it('shows Apps heading', () => {
    render(() => <AppBrowser store={() => makeStore()} onLogin={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Apps' })).toBeInTheDocument();
  });
});
