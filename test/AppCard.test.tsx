import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import AppCard from '../src/components/AppCard';
import type { Instance, App } from '../src/types/store';

const baseInstance: Instance = {
  id: 'inst-001',
  instanceOf: 'app-001',
  name: 'Grade 5A and Form 3',
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
  it('renders the instance display name as the title and the app title as a subtitle', () => {
    render(() => (
      <AppCard
        instance={() => baseInstance}
        app={() => baseApp}
        appUrl={() => 'http://appdocker01:8080'}
      />
    ));
    expect(screen.getByText('Grade 5A and Form 3')).toBeInTheDocument();
    expect(screen.getByText('Kolibri Learning Platform')).toBeInTheDocument();
    expect(screen.getByText('Offline learning platform')).toBeInTheDocument();
    expect(document.querySelector('.app-card__title')?.textContent).toBe('Grade 5A and Form 3');
    expect(document.querySelector('.app-card__subtitle')?.textContent).toBe('Kolibri Learning Platform');
  });

  it('falls back to the app title with no subtitle when the name is a generated id', () => {
    const generated = { ...baseInstance, id: 'kolibri-0123456789abcdefghi', name: 'kolibri-0123456789abcdefghi' };
    render(() => (
      <AppCard
        instance={() => generated}
        app={() => baseApp}
        appUrl={() => 'http://appdocker01:8080'}
      />
    ));
    expect(document.querySelector('.app-card__title')?.textContent).toBe('Kolibri Learning Platform');
    expect(document.querySelector('.app-card__subtitle')).toBeNull();
  });

  it('renders category badge', () => {
    render(() => (
      <AppCard
        instance={() => baseInstance}
        app={() => baseApp}
        appUrl={() => 'http://appdocker01:8080'}
      />
    ));
    expect(screen.getByText('education')).toBeInTheDocument();
  });

  it('shows enabled Open button for running instance', () => {
    render(() => (
      <AppCard
        instance={() => baseInstance}
        app={() => baseApp}
        appUrl={() => 'http://appdocker01:8080'}
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
        appUrl={() => 'http://appdocker01:8080'}
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
        appUrl={() => 'http://appdocker01:8080'}
      />
    ));
    expect(container.querySelector('.app-card--unavailable')).toBeInTheDocument();
  });

  it('does not apply unavailable class for running instance', () => {
    const { container } = render(() => (
      <AppCard
        instance={() => baseInstance}
        app={() => baseApp}
        appUrl={() => 'http://appdocker01:8080'}
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
        appUrl={() => 'http://appdocker01:8080'}
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
        appUrl={() => 'http://appdocker01:8080'}
      />
    ));
    expect(screen.getByText('Grade 5A and Form 3')).toBeInTheDocument();
  });
});
