import { describe, it, expect } from 'vitest';
import { render } from '@solidjs/testing-library';
import InstanceRow, { isStartDisabled, isStopDisabled } from '../components/InstanceRow';
import { setSendCommandFn } from '../store/commands';
import type { Instance, App, Engine, Status } from '../types/store';

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------
const makeInstance = (status: Status): Instance => ({
  id: 'inst-001',
  instanceOf: 'kolibri-1.0',
  name: 'kolibri',
  status,
  port: 8080,
  serviceImages: [],
  created: Date.now(),
  lastBackedUp: 0,
  lastStarted: Date.now(),
  storedOn: 'DISK001',
});

const mockApp: App = {
  id: 'kolibri-1.0',
  name: 'kolibri',
  version: '1.0',
  title: 'Kolibri Learning Platform',
  description: null,
  url: null,
  category: 'education',
  icon: null,
  author: null,
};

const mockEngine: Engine = {
  id: 'ENGINE_DISK001',
  hostname: 'appdocker01',
  version: '1.0',
  hostOS: 'Linux',
  created: Date.now(),
  lastBooted: Date.now(),
  lastRun: Date.now(),
  lastHalted: null,
  commands: [],
};

// ---------------------------------------------------------------------------
// Pure helpers: isStartDisabled / isStopDisabled
// ---------------------------------------------------------------------------
describe('isStartDisabled', () => {
  it('disables Start for Running', () => expect(isStartDisabled('Running')).toBe(true));
  it('disables Start for Starting', () => expect(isStartDisabled('Starting')).toBe(true));
  it('enables Start for Stopped', () => expect(isStartDisabled('Stopped')).toBe(false));
  it('enables Start for Docked', () => expect(isStartDisabled('Docked')).toBe(false));
  it('enables Start for Error', () => expect(isStartDisabled('Error')).toBe(false));
  it('enables Start for Undocked', () => expect(isStartDisabled('Undocked')).toBe(false));
  it('enables Start for Pauzed', () => expect(isStartDisabled('Pauzed')).toBe(false));
});

describe('isStopDisabled', () => {
  it('disables Stop for Stopped', () => expect(isStopDisabled('Stopped')).toBe(true));
  it('disables Stop for Docked', () => expect(isStopDisabled('Docked')).toBe(true));
  it('disables Stop for Undocked', () => expect(isStopDisabled('Undocked')).toBe(true));
  it('enables Stop for Running', () => expect(isStopDisabled('Running')).toBe(false));
  it('enables Stop for Starting', () => expect(isStopDisabled('Starting')).toBe(false));
  it('enables Stop for Error', () => expect(isStopDisabled('Error')).toBe(false));
  it('enables Stop for Pauzed', () => expect(isStopDisabled('Pauzed')).toBe(false));
});

// ---------------------------------------------------------------------------
// Component rendering
// ---------------------------------------------------------------------------
describe('InstanceRow component', () => {
  it('renders instance name', () => {
    const { container } = render(() => (
      <InstanceRow instance={makeInstance('Running')} app={mockApp} engine={mockEngine} />
    ));
    expect(container.textContent).toContain('kolibri');
  });

  it('renders app title', () => {
    const { container } = render(() => (
      <InstanceRow instance={makeInstance('Running')} app={mockApp} engine={mockEngine} />
    ));
    expect(container.textContent).toContain('Kolibri Learning Platform');
  });

  it('Start button is disabled when status is Running', () => {
    const { getByRole } = render(() => (
      <InstanceRow instance={makeInstance('Running')} app={mockApp} engine={mockEngine} />
    ));
    const startBtn = getByRole('button', { name: /start/i });
    expect(startBtn).toBeDisabled();
  });

  it('Start button is disabled when status is Starting', () => {
    const { getByRole } = render(() => (
      <InstanceRow instance={makeInstance('Starting')} app={mockApp} engine={mockEngine} />
    ));
    expect(getByRole('button', { name: /start/i })).toBeDisabled();
  });

  it('Start button is enabled when status is Stopped', () => {
    const { getByRole } = render(() => (
      <InstanceRow instance={makeInstance('Stopped')} app={mockApp} engine={mockEngine} />
    ));
    expect(getByRole('button', { name: /start/i })).not.toBeDisabled();
  });

  it('Stop button is disabled when status is Stopped', () => {
    const { getByRole } = render(() => (
      <InstanceRow instance={makeInstance('Stopped')} app={mockApp} engine={mockEngine} />
    ));
    expect(getByRole('button', { name: /stop/i })).toBeDisabled();
  });

  it('Stop button is enabled when status is Running', () => {
    const { getByRole } = render(() => (
      <InstanceRow instance={makeInstance('Running')} app={mockApp} engine={mockEngine} />
    ));
    expect(getByRole('button', { name: /stop/i })).not.toBeDisabled();
  });

  it('shows Open link when status is Running', () => {
    const { container } = render(() => (
      <InstanceRow instance={makeInstance('Running')} app={mockApp} engine={mockEngine} />
    ));
    const link = container.querySelector('a.btn--open');
    expect(link).toBeTruthy();
    expect(link).toHaveAttribute('href', 'http://appdocker01.local:8080');
  });

  it('does not show Open link when status is Stopped', () => {
    const { container } = render(() => (
      <InstanceRow instance={makeInstance('Stopped')} app={mockApp} engine={mockEngine} />
    ));
    const link = container.querySelector('a.btn--open');
    expect(link).toBeFalsy();
  });

  it('does not show Open link when status is Docked', () => {
    const { container } = render(() => (
      <InstanceRow instance={makeInstance('Docked')} app={mockApp} engine={mockEngine} />
    ));
    expect(container.querySelector('a.btn--open')).toBeFalsy();
  });
});
