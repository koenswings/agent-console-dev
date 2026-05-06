import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import AppCard from '../components/AppCard';
import type { Instance, App } from '../types/store';

const baseInstance: Instance = {
  id: 'inst-001',
  instanceOf: 'app-001',
  name: 'kolibri',
  status: 'Running',
  port: 8080,
  serviceImages: [],
  created: 0,
  lastBackup: null,
  lastStarted: 0,
  storedOn: 'disk-001',
  statusCondition: null,
  currentStep: null,
  totalSteps: null,
  stepLabel: null,
  metrics: null,
};

const baseApp: App = {
  id: 'app-001',
  name: 'kolibri',
  version: '1.0',
  title: 'Kolibri Learning Platform',
  description: 'Offline learning platform',
  url: null,
  category: 'education',
  icon: null,
  author: 'Learning Equality',
};

describe('AppCard', () => {
  it('renders app title and description', () => {
    render(() => (
      <AppCard
        instance={() => baseInstance}
        app={() => baseApp}
        engineHostname={() => 'appdocker01'}
      />
    ));
    expect(screen.getByText('Kolibri Learning Platform')).toBeInTheDocument();
    expect(screen.getByText('Offline learning platform')).toBeInTheDocument();
  });

  it('renders category badge', () => {
    render(() => (
      <AppCard
        instance={() => baseInstance}
        app={() => baseApp}
        engineHostname={() => 'appdocker01'}
      />
    ));
    expect(screen.getByText('education')).toBeInTheDocument();
  });

  it('shows enabled Open button for running instance', () => {
    render(() => (
      <AppCard
        instance={() => baseInstance}
        app={() => baseApp}
        engineHostname={() => 'appdocker01'}
      />
    ));
    const btn = screen.getByRole('button', { name: 'Open' });
    expect(btn).toBeInTheDocument();
  });

  it('shows "Not available" for stopped instance', () => {
    const stopped = { ...baseInstance, status: 'Stopped' as const };
    render(() => (
      <AppCard
        instance={() => stopped}
        app={() => baseApp}
        engineHostname={() => 'appdocker01'}
      />
    ));
    expect(screen.getByText('Not available')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
  });

  it('applies unavailable class for non-running instance', () => {
    const stopped = { ...baseInstance, status: 'Stopped' as const };
    const { container } = render(() => (
      <AppCard
        instance={() => stopped}
        app={() => baseApp}
        engineHostname={() => 'appdocker01'}
      />
    ));
    expect(container.querySelector('.app-card--unavailable')).toBeInTheDocument();
  });

  it('does not apply unavailable class for running instance', () => {
    const { container } = render(() => (
      <AppCard
        instance={() => baseInstance}
        app={() => baseApp}
        engineHostname={() => 'appdocker01'}
      />
    ));
    expect(container.querySelector('.app-card--unavailable')).not.toBeInTheDocument();
  });

  it('opens correct URL on click', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(() => (
      <AppCard
        instance={() => baseInstance}
        app={() => baseApp}
        engineHostname={() => 'appdocker01'}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(openSpy).toHaveBeenCalledWith(
      'http://appdocker01:8080',
      '_blank',
      'noopener,noreferrer'
    );
    openSpy.mockRestore();
  });

  it('falls back to instance name when app is undefined', () => {
    render(() => (
      <AppCard
        instance={() => baseInstance}
        app={() => undefined}
        engineHostname={() => 'appdocker01'}
      />
    ));
    expect(screen.getByText('kolibri')).toBeInTheDocument();
  });
});
